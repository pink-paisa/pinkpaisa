const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const ProductSubcategory = require("../models/ProductSubcategory");
const Vendor = require("../models/Vendor");
const VirtualProduct = require("../models/VirtualProduct");
const { applyQueryParams } = require("./orderController");
const { resolveTaxonomySelection } = require("../utils/taxonomy");
const { ensureUniqueProductSlug } = require("../utils/productSlug");
const logger = require("../utils/logger");
const { enqueueAdminProductCampaign } = require("../services/marketingAgentOrchestrator");
const { ingestVendorImage, validateRemoteImageUrl } = require("../utils/vendorMedia");
const { filterManualAffiliateImages } = require("../services/affiliateImagePolicy");

const SORT_PRESETS = {
  popular: { is_affiliate: 1, sort_order: 1, createdAt: -1 },
  newest: { createdAt: -1 },
  price_asc: { effective_price: 1, createdAt: -1 },
  price_desc: { effective_price: -1, createdAt: -1 },
};

const APPROVED_AFFILIATE_DATA_SOURCES = new Set(["creators_api", "pa_api"]);

const BULK_MUTABLE_FIELDS = new Set([
  "is_visible",
  "status",
  "featured",
  "bestseller",
  "sort_order",
  "sale_price",
  "stock_quantity",
]);

const LARGE_PRICE_BOUNDARY = 1000000000;

const toObjectIdString = (value) => value?._id?.toString?.() || value?.toString?.() || value || null;

const normalizeString = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeStringArrayQuery = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeNullableNumber = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeAttributes = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
};

const normalizeImageItems = ({ imageItems = [], imageUrls = [], featuredImage = null }) => {
  const fallbackUrls = [
    normalizeString(featuredImage),
    ...normalizeStringList(imageUrls),
  ].filter(Boolean);

  const rawItems = Array.isArray(imageItems) && imageItems.length ? imageItems : fallbackUrls.map((url, index) => ({ url, position: index }));
  const seen = new Set();

  return rawItems
    .map((item, index) => {
      if (typeof item === "string") {
        return { url: normalizeString(item), alt: null, position: index };
      }
      const url = normalizeString(item?.url);
      return {
        url,
        alt: normalizeString(item?.alt),
        position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index,
      };
    })
    .filter((item) => item.url)
    .sort((left, right) => left.position - right.position)
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .map((item, index) => ({ ...item, position: index }));
};

const buildLegacyImages = (imageItems = [], featuredImage = null) => {
  const orderedUrls = imageItems.map((item) => item.url).filter(Boolean);
  const normalizedFeatured = normalizeString(featuredImage);
  if (normalizedFeatured && !orderedUrls.includes(normalizedFeatured)) {
    return [normalizedFeatured, ...orderedUrls];
  }
  return orderedUrls;
};

const getAffiliatePayloadImage = (doc = {}) => {
  if (!doc.is_affiliate || !doc.affiliate_payload || typeof doc.affiliate_payload !== "object") return null;
  return normalizeString(
    doc.affiliate_payload.image_url
    || doc.affiliate_payload.manual_image_url
    || doc.affiliate_payload.featured_image
    || doc.affiliate_payload.raw?.image_url
  );
};

const normalizeStoredImageItems = (doc = {}) => normalizeImageItems({
  imageItems: Array.isArray(doc.image_items) ? doc.image_items : [],
  imageUrls: [
    ...(Array.isArray(doc.images) ? doc.images : []),
    getAffiliatePayloadImage(doc),
  ].filter(Boolean),
  featuredImage: doc.featured_image || getAffiliatePayloadImage(doc),
});

const computeEffectivePrice = (price, salePrice) => {
  if ((price == null || price === "") && (salePrice == null || salePrice === "")) return null;
  const normalizedPrice = normalizeNumber(price, 0);
  const normalizedSalePrice = normalizeNullableNumber(salePrice);
  return normalizedSalePrice != null ? normalizedSalePrice : normalizedPrice;
};

const parseBooleanFilter = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};

const buildSourceTypeQuery = (sourceType) => {
  if (sourceType === "admin") {
    return { $or: [{ source_type: "admin" }, { source_type: { $exists: false } }, { source_type: null }] };
  }
  if (sourceType === "vendor") {
    return { source_type: "vendor" };
  }
  return null;
};

const buildAffiliateQuery = (isAffiliate) => {
  if (isAffiliate === true) return { is_affiliate: true };
  if (isAffiliate === false) {
    return { $or: [{ is_affiliate: false }, { is_affiliate: { $exists: false } }, { is_affiliate: null }] };
  }
  return null;
};

const buildPublicAffiliateComplianceQuery = () => ({
  $or: [
    { is_affiliate: { $ne: true } },
    {
      is_affiliate: true,
      affiliate_compliance_status: "compliant",
    },
  ],
});

const isAdminFullViewRequest = (req = {}) => (
  req.query?.all === "true" && req.user?.role === "admin"
);

const sanitizePublicAttributes = (attributes) => {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return attributes;

  const blockedKeys = new Set([
    "affiliate_rating_text",
    "affiliate_rating_value",
    "affiliate_discount_percent",
    "affiliate_review_text",
    "affiliate_availability_text",
    "amazon_price",
    "amazon_sale_price",
    "amazon_rating",
    "amazon_reviews",
    "imported_price_observed",
    "imported_sale_price_observed",
    "imported_rating_observed",
    "imported_review_observed",
    "imported_availability_observed",
  ]);

  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return false;
      if (blockedKeys.has(normalizedKey)) return false;
      if (normalizedKey.startsWith("imported_")) return false;
      return true;
    }),
  );
};

const canShowAffiliateProductAdvertisingContent = (doc = {}) => {
  if (!Boolean(doc.is_affiliate) || !APPROVED_AFFILIATE_DATA_SOURCES.has(String(doc.affiliate_data_source || ""))) {
    return false;
  }
  if (!doc.affiliate_data_expires_at) return false;
  const expiresAt = new Date(doc.affiliate_data_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

const isEligibleForAdminCampaignQueue = (product = {}) => (
  (product.source_type || "admin") === "admin"
  && !product.is_affiliate
  && product.status === "active"
  && Boolean(product.is_visible)
);

const toFlat = (doc, { publicView = false } = {}) => {
  const imageItems = normalizeStoredImageItems(doc);
  const hasFreshAffiliateApiData = canShowAffiliateProductAdvertisingContent(doc);
  const storedPriceStatus = doc.price_status || (doc.is_affiliate ? "unavailable" : "verified");
  const priceStatus = doc.is_affiliate && storedPriceStatus === "verified" && !hasFreshAffiliateApiData
    ? "stale"
    : storedPriceStatus;
  const flat = {
    ...doc,
    id: doc._id.toString(),
    category_id: toObjectIdString(doc.category_id),
    subcategory_id: toObjectIdString(doc.subcategory_id),
    vendor_id: toObjectIdString(doc.vendor_id),
    vendor_product_id: toObjectIdString(doc.vendor_product_id),
    images: buildLegacyImages(imageItems, doc.featured_image),
    image_items: imageItems,
    featured_image: normalizeString(doc.featured_image) || imageItems[0]?.url || null,
    effective_price: computeEffectivePrice(doc.price, doc.sale_price),
    price_status: priceStatus,
  };
  flat.price_available = flat.is_affiliate
    ? flat.price_status === "verified" && hasFreshAffiliateApiData && Number(flat.price || 0) > 0
    : Number(flat.price || 0) > 0;

  if (publicView) {
    delete flat.cost_price;
    delete flat.affiliate_tag;
    delete flat.affiliate_payload;
    delete flat.affiliate_original_url;
    delete flat.affiliate_canonical_url;
    delete flat.affiliate_campaign_asset_url;
    delete flat.affiliate_campaign_usage_rights;
    delete flat.affiliate_image_provenance;
    delete flat.price_verified_at;
    delete flat.__v;
    if (flat.attributes && typeof flat.attributes === "object") {
      flat.attributes = sanitizePublicAttributes(flat.attributes);
    }
  }

  if (publicView && flat.is_affiliate && !canShowAffiliateProductAdvertisingContent(flat)) {
    if (APPROVED_AFFILIATE_DATA_SOURCES.has(String(flat.affiliate_data_source || ""))) {
      flat.images = [];
      flat.image_items = [];
      flat.featured_image = null;
    } else {
      const manualImages = filterManualAffiliateImages(flat);
      flat.images = manualImages.images;
      flat.image_items = manualImages.image_items;
      flat.featured_image = manualImages.featured_image;
    }
    flat.price = null;
    flat.sale_price = null;
    flat.mrp = null;
    flat.effective_price = null;
    flat.price_available = false;
    flat.stock_quantity = 0;
  }

  if (publicView && flat.is_affiliate && !flat.price_available) {
    flat.price = null;
    flat.sale_price = null;
    flat.mrp = null;
    flat.effective_price = null;
  }

  return flat;
};

const buildProductFilter = async (req) => {
  const filterClauses = [];
  const adminFullView = isAdminFullViewRequest(req);

  const sourceTypeFilter = buildSourceTypeQuery(String(req.query.source_type || ""));
  if (sourceTypeFilter) filterClauses.push(sourceTypeFilter);

  const affiliateFilter = parseBooleanFilter(req.query.is_affiliate);
  const affiliateQuery = buildAffiliateQuery(affiliateFilter);
  if (affiliateQuery) filterClauses.push(affiliateQuery);

  if (req.query.status) filterClauses.push({ status: req.query.status });
  else if (!adminFullView) filterClauses.push({ status: "active" });

  if (!adminFullView) {
    filterClauses.push({
      is_visible: true,
      category: { $ne: "Uncategorized" },
      subcategory: { $ne: "Uncategorized" },
    });
    filterClauses.push(buildPublicAffiliateComplianceQuery());
  }

  let resolvedCategory = null;
  let resolvedSubcategory = null;

  if (req.query.category_id) {
    resolvedCategory = { _id: req.query.category_id };
  } else if (req.query.category_slug) {
    resolvedCategory = await ProductCategory.findOne({ slug: String(req.query.category_slug).trim() }).lean();
    if (!resolvedCategory) return { empty: true, filter: {}, searchRequested: false };
  }

  if (req.query.subcategory_id) {
    resolvedSubcategory = { _id: req.query.subcategory_id, category_id: resolvedCategory?._id };
  } else if (req.query.subcategory_slug) {
    const subcategoryQuery = { slug: String(req.query.subcategory_slug).trim() };
    if (resolvedCategory?._id) subcategoryQuery.category_id = resolvedCategory._id;
    resolvedSubcategory = await ProductSubcategory.findOne(subcategoryQuery).lean();
    if (!resolvedSubcategory) return { empty: true, filter: {}, searchRequested: false };
  }

  if (resolvedCategory?._id) filterClauses.push({ category_id: resolvedCategory._id });
  else if (req.query.category_id) filterClauses.push({ category_id: req.query.category_id });
  else if (req.query.category) filterClauses.push({ category: req.query.category });

  if (resolvedSubcategory?._id) filterClauses.push({ subcategory_id: resolvedSubcategory._id });
  else if (req.query.subcategory_id) filterClauses.push({ subcategory_id: req.query.subcategory_id });
  else if (req.query.subcategory) filterClauses.push({ subcategory: req.query.subcategory });

  const minPrice = normalizeNullableNumber(req.query.min_price);
  const maxPrice = normalizeNullableNumber(req.query.max_price);
  if (minPrice != null || maxPrice != null) {
    const priceFilter = {};
    if (minPrice != null) priceFilter.$gte = minPrice;
    if (maxPrice != null) priceFilter.$lte = maxPrice;
    filterClauses.push({ effective_price: priceFilter });
  }

  if (parseBooleanFilter(req.query.in_stock) === true) {
    filterClauses.push({ stock_quantity: { $gt: 0 } });
  }

  if (parseBooleanFilter(req.query.on_sale) === true) {
    filterClauses.push({ sale_price: { $ne: null }, $expr: { $lt: ["$sale_price", "$price"] } });
  }

  const brands = normalizeStringArrayQuery(req.query.brand);
  if (brands.length) {
    filterClauses.push({ brand_name: { $in: brands } });
  }

  if (parseBooleanFilter(req.query.featured) === true) {
    filterClauses.push({ featured: true });
  }

  if (parseBooleanFilter(req.query.affiliate_instagram_pick) === true) {
    filterClauses.push({ affiliate_is_instagram_pick: true });
  }

  if (req.query.campaign_label) {
    filterClauses.push({ campaign_label: String(req.query.campaign_label).trim() });
  }

  if (parseBooleanFilter(req.query.bestseller) === true) {
    filterClauses.push({ bestseller: true });
  }

  const searchQuery = String(req.query.search || "").trim();
  const searchRequested = Boolean(searchQuery);
  if (searchRequested) {
    filterClauses.push({ $text: { $search: searchQuery } });
  }

  return {
    empty: false,
    filter: filterClauses.length ? { $and: filterClauses } : {},
    searchRequested,
  };
};

const buildPassthroughQuery = (query = {}) => {
  const passthroughQuery = { ...query };
  delete passthroughQuery.all;
  delete passthroughQuery.source_type;
  delete passthroughQuery.status;
  delete passthroughQuery.category_id;
  delete passthroughQuery.subcategory_id;
  delete passthroughQuery.category;
  delete passthroughQuery.subcategory;
  delete passthroughQuery.category_slug;
  delete passthroughQuery.subcategory_slug;
  delete passthroughQuery.is_affiliate;
  delete passthroughQuery.search;
  delete passthroughQuery.include_meta;
  delete passthroughQuery.include;
  delete passthroughQuery.sort;
  delete passthroughQuery.min_price;
  delete passthroughQuery.max_price;
  delete passthroughQuery.in_stock;
  delete passthroughQuery.on_sale;
  delete passthroughQuery.brand;
  delete passthroughQuery.featured;
  delete passthroughQuery.affiliate_instagram_pick;
  delete passthroughQuery.campaign_label;
  delete passthroughQuery.bestseller;
  return passthroughQuery;
};

const buildSortQuery = ({ searchRequested, presetKey, customSortApplied }) => {
  if (customSortApplied) return null;
  if (presetKey && SORT_PRESETS[presetKey]) return SORT_PRESETS[presetKey];
  if (searchRequested) return { score: { $meta: "textScore" }, sort_order: 1, createdAt: -1 };
  return SORT_PRESETS.popular;
};

const validateProductPayload = (payload = {}) => {
  const fieldErrors = {};

  if (!normalizeString(payload.title)) fieldErrors.title = "Title is required";
  if (!normalizeString(payload.slug) && !normalizeString(payload.title)) fieldErrors.slug = "Slug is required";
  if (!normalizeString(payload.featured_image)) fieldErrors.featured_image = "Featured image is required";
  if (normalizeNumber(payload.price, NaN) <= 0 || Number.isNaN(normalizeNumber(payload.price, NaN))) fieldErrors.price = "Price must be greater than 0";
  if (payload.sale_price != null && normalizeNumber(payload.sale_price, NaN) < 0) fieldErrors.sale_price = "Sale price must be a valid non-negative number";
  if (payload.sale_price != null && normalizeNumber(payload.sale_price, 0) > normalizeNumber(payload.price, 0)) fieldErrors.sale_price = "Sale price cannot exceed price";
  if (payload.cost_price != null && (normalizeNumber(payload.cost_price, NaN) < 0 || Number.isNaN(normalizeNumber(payload.cost_price, NaN)))) fieldErrors.cost_price = "Cost price must be a valid non-negative number";
  if (payload.mrp != null && normalizeNumber(payload.mrp, 0) > 0 && normalizeNumber(payload.price, 0) > normalizeNumber(payload.mrp, 0)) fieldErrors.mrp = "MRP must be greater than or equal to price";
  if (payload.stock_quantity != null && (normalizeNumber(payload.stock_quantity, NaN) < 0 || Number.isNaN(normalizeNumber(payload.stock_quantity, NaN)))) fieldErrors.stock_quantity = "Stock quantity must be a valid non-negative number";
  if (!payload.category_id && !payload.category) fieldErrors.category_id = "Category is required";
  if (!payload.subcategory_id && !payload.subcategory) fieldErrors.subcategory_id = "Subcategory is required";
  if (payload.weight != null && payload.weight !== "" && (normalizeNumber(payload.weight, NaN) < 0 || Number.isNaN(normalizeNumber(payload.weight, NaN)))) fieldErrors.weight = "Weight must be a valid non-negative number";
  if (payload.sort_order != null && payload.sort_order !== "" && (normalizeNumber(payload.sort_order, NaN) < 0 || Number.isNaN(normalizeNumber(payload.sort_order, NaN)))) fieldErrors.sort_order = "Sort order must be a valid non-negative number";
  if (payload.return_window_days != null && payload.return_window_days !== "" && (normalizeNumber(payload.return_window_days, NaN) < 0 || Number.isNaN(normalizeNumber(payload.return_window_days, NaN)))) fieldErrors.return_window_days = "Return window days must be a valid non-negative number";
  if (payload.gst_rate_percent != null) {
    const gstRate = normalizeNumber(payload.gst_rate_percent, NaN);
    if (Number.isNaN(gstRate) || gstRate < 0 || gstRate > 50) fieldErrors.gst_rate_percent = "GST rate must be between 0 and 50";
  }
  if (typeof payload.attributes === "string" && payload.attributes.trim()) {
    try {
      const parsed = JSON.parse(payload.attributes);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fieldErrors.attributes = "Attributes must be a JSON object";
    } catch {
      fieldErrors.attributes = "Attributes must be valid JSON";
    }
  }

  return fieldErrors;
};

const validateProductMedia = async (featuredImage, images = []) => {
  const fieldErrors = {};
  const featuredImageError = await validateRemoteImageUrl(featuredImage);
  if (featuredImageError) fieldErrors.featured_image = featuredImageError;

  for (const imageUrl of images) {
    const imageError = await validateRemoteImageUrl(imageUrl);
    if (imageError) {
      fieldErrors.images = imageError;
      break;
    }
  }

  return fieldErrors;
};

const validateAdminProductUniqueness = async (payload = {}, existingProductId = null) => {
  const fieldErrors = {};
  const normalizedSku = normalizeString(payload.sku);
  if (!normalizedSku) return fieldErrors;

  const filterClauses = [
    buildSourceTypeQuery("admin"),
    buildAffiliateQuery(false),
    { sku: normalizedSku },
  ];
  if (existingProductId) filterClauses.push({ _id: { $ne: existingProductId } });

  const duplicateSkuProduct = await Product.findOne({ $and: filterClauses }).select("_id").lean();
  if (duplicateSkuProduct) fieldErrors.sku = "SKU already exists for another admin product";

  return fieldErrors;
};

const ingestProductMedia = async ({ featuredImage, imageUrls = [], imageItems = [] }) => {
  const nextFeaturedImage = await ingestVendorImage(featuredImage);
  const nextImages = (await Promise.all(imageUrls.map((url) => ingestVendorImage(url)))).filter(Boolean);
  const normalizedItems = normalizeImageItems({
    imageItems,
    imageUrls: nextImages,
    featuredImage: nextFeaturedImage,
  });

  return {
    featured_image: nextFeaturedImage,
    images: buildLegacyImages(normalizedItems, nextFeaturedImage),
    image_items: normalizedItems,
  };
};

const buildProductPayload = async (body = {}, existingProduct = null) => {
  const nextSource = {
    ...(existingProduct ? existingProduct.toObject() : {}),
    ...body,
  };

  const taxonomy = await resolveTaxonomySelection({
    category_id: nextSource.category_id,
    subcategory_id: nextSource.subcategory_id,
    category: nextSource.category,
    subcategory: nextSource.subcategory,
    allowUncategorized: true,
  });

  const requestedSlug = String(nextSource.slug || nextSource.title || existingProduct?.slug || "product").trim();
  const slug = await ensureUniqueProductSlug(requestedSlug, existingProduct?._id || null);
  const price = normalizeNumber(nextSource.price, 0);
  const salePrice = normalizeNullableNumber(nextSource.sale_price);
  const imageItems = normalizeImageItems({
    imageItems: nextSource.image_items,
    imageUrls: nextSource.images || nextSource.additional_images,
    featuredImage: nextSource.featured_image,
  });
  const featuredImage = normalizeString(nextSource.featured_image) || imageItems[0]?.url || null;
  const requestedVisible = nextSource.is_visible != null ? Boolean(nextSource.is_visible) : !taxonomy.isUncategorized;
  const isVisible = taxonomy.isUncategorized ? false : requestedVisible;

  return {
    title: normalizeString(nextSource.title) || "Untitled product",
    slug,
    short_description: normalizeString(nextSource.short_description),
    full_description: normalizeString(nextSource.full_description),
    category_id: taxonomy.categoryDoc._id,
    subcategory_id: taxonomy.subcategoryDoc._id,
    category: taxonomy.categoryDoc.name,
    subcategory: taxonomy.subcategoryDoc.name,
    images: buildLegacyImages(imageItems, featuredImage),
    image_items: imageItems,
    featured_image: featuredImage,
    price,
    sale_price: salePrice,
    effective_price: computeEffectivePrice(price, salePrice),
    mrp: normalizeNullableNumber(nextSource.mrp),
    cost_price: normalizeNumber(nextSource.cost_price, 0),
    gst_rate_percent: normalizeNumber(nextSource.gst_rate_percent, 0),
    hsn_code: normalizeString(nextSource.hsn_code),
    brand_name: normalizeString(nextSource.brand_name),
    country_of_origin: normalizeString(nextSource.country_of_origin) || "India",
    sku: normalizeString(nextSource.sku),
    stock_quantity: normalizeNumber(nextSource.stock_quantity, 0),
    tags: normalizeStringList(nextSource.tags),
    weight: normalizeNullableNumber(nextSource.weight),
    dimensions: normalizeString(nextSource.dimensions),
    seo_meta_title: normalizeString(nextSource.seo_meta_title),
    seo_meta_description: normalizeString(nextSource.seo_meta_description),
    seo_keywords: normalizeStringList(nextSource.seo_keywords),
    attributes: normalizeAttributes(nextSource.attributes),
    status: ["active", "inactive", "draft"].includes(String(nextSource.status || "").trim()) ? String(nextSource.status).trim() : "active",
    is_visible: isVisible,
    returnable: nextSource.returnable !== false,
    return_window_days: normalizeNumber(nextSource.return_window_days, 7),
    return_liability: nextSource.return_liability === "pinkpaisa" ? "pinkpaisa" : "vendor",
    featured: Boolean(nextSource.featured),
    bestseller: Boolean(nextSource.bestseller),
    sort_order: normalizeNumber(nextSource.sort_order, 0),
    source_type: "admin",
    vendor_id: null,
    vendor_product_id: null,
    is_affiliate: false,
    affiliate_url: null,
    affiliate_external_id: null,
    affiliate_source_platform: null,
    affiliate_payload: null,
  };
};

const queueAdminCampaignIfNeeded = async (product, queuedAt = null) => {
  if (!isEligibleForAdminCampaignQueue(product)) return;
  try {
    await enqueueAdminProductCampaign({ productId: product._id, queuedAt: queuedAt || product.createdAt || new Date() });
  } catch (queueError) {
    logger.error({ productId: product._id, err: queueError }, "admin campaign enqueue failed");
  }
};

const getProducts = async (req, res) => {
  try {
    const { empty, filter, searchRequested } = await buildProductFilter(req);
    const publicView = !isAdminFullViewRequest(req);
    if (empty) {
      return res.json(req.query.include_meta === "true" ? { items: [], total: 0, page: 1, pageSize: 0, totalPages: 0 } : []);
    }

    const passthroughQuery = buildPassthroughQuery(req.query);

    const requestedLimit = Math.max(parseInt(String(req.query._limit || "0"), 10) || 0, 0);
    const requestedPage = Math.max(parseInt(String(req.query._page || "1"), 10) || 1, 1);
    let effectivePage = requestedPage;
    let total = null;

    if (req.query.include_meta === "true") {
      total = await Product.countDocuments(filter);
      if (requestedLimit > 0 && Number(total || 0) > 0) {
        const maxPage = Math.max(Math.ceil(Number(total || 0) / requestedLimit), 1);
        effectivePage = Math.min(requestedPage, maxPage);
        passthroughQuery._page = String(effectivePage);
      }
    }

    let q = Product.find(filter);
    q = applyQueryParams(q, { ...req, query: passthroughQuery });

    if (searchRequested) {
      q = q.select({ score: { $meta: "textScore" } });
    }

    const presetKey = String(req.query.sort || "").trim().toLowerCase();
    const sortQuery = buildSortQuery({
      searchRequested,
      presetKey,
      customSortApplied: Boolean(req.query._sort),
    });
    if (sortQuery) q = q.sort(sortQuery);

    const products = await q.lean();

    if (req.query.include_meta === "true") {
      const pageSize = Math.max(parseInt(String(req.query._limit || "0"), 10) || products.length || 0, 0);
      const totalPages = pageSize > 0 ? Math.ceil(Number(total || 0) / pageSize) : 1;
      return res.json({
        items: products.map((product) => toFlat(product, { publicView })),
        total: Number(total || 0),
        page: effectivePage,
        pageSize,
        totalPages,
      });
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(products.map((product) => toFlat(product, { publicView })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProductsFacets = async (req, res) => {
  try {
    const { empty, filter } = await buildProductFilter(req);
    if (empty) {
      return res.json({ categories: [], subcategories: [], brands: [], price_buckets: [] });
    }

    const [facets] = await Product.aggregate([
      { $match: filter },
      {
        $facet: {
          categories: [
            { $group: { _id: { id: "$category_id", name: "$category" }, count: { $sum: 1 } } },
            { $sort: { "_id.name": 1 } },
          ],
          subcategories: [
            { $group: { _id: { id: "$subcategory_id", name: "$subcategory" }, count: { $sum: 1 } } },
            { $sort: { "_id.name": 1 } },
          ],
          brands: [
            { $match: { brand_name: { $nin: [null, ""] } } },
            { $group: { _id: "$brand_name", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          price_buckets: [
            { $match: { effective_price: { $type: "number" } } },
            {
              $bucket: {
                groupBy: "$effective_price",
                boundaries: [0, 500, 1000, 2500, 5000, 10000, LARGE_PRICE_BOUNDARY],
                default: LARGE_PRICE_BOUNDARY,
                output: { count: { $sum: 1 } },
              },
            },
          ],
        },
      },
    ]);

    const boundaries = [0, 500, 1000, 2500, 5000, 10000, LARGE_PRICE_BOUNDARY];
    const priceBuckets = (facets?.price_buckets || [])
      .map((bucket) => {
        const bucketIndex = boundaries.indexOf(bucket._id);
        const nextBoundary = bucket._id === LARGE_PRICE_BOUNDARY ? null : boundaries[bucketIndex + 1] ?? null;
        return {
          min: bucket._id === LARGE_PRICE_BOUNDARY ? 10000 : bucket._id,
          max: nextBoundary,
          count: bucket.count,
        };
      })
      .filter((bucket) => bucket.count > 0);

    res.json({
      categories: (facets?.categories || []).map((entry) => ({
        id: toObjectIdString(entry._id.id),
        name: entry._id.name,
        count: entry.count,
      })),
      subcategories: (facets?.subcategories || []).map((entry) => ({
        id: toObjectIdString(entry._id.id),
        name: entry._id.name,
        count: entry.count,
      })),
      brands: (facets?.brands || []).map((entry) => ({
        name: entry._id,
        count: entry.count,
      })),
      price_buckets: priceBuckets,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProduct = async (req, res) => {
  try {
    let product = null;
    if (req.params.slug.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(req.params.slug).lean();
    }
    if (!product) product = await Product.findOne({ slug: req.params.slug }).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    const publicView = !isAdminFullViewRequest(req);
    if (publicView && (!product.is_visible || product.category === "Uncategorized" || product.subcategory === "Uncategorized" || product.status !== "active")) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (publicView && product.is_affiliate && product.affiliate_compliance_status !== "compliant") {
      return res.status(404).json({ message: "Product not found" });
    }

    const flatProduct = toFlat(product, { publicView });
    const includeParts = new Set(String(req.query.include || "").split(",").map((part) => part.trim()).filter(Boolean));
    const extras = {};

    if (includeParts.has("related")) {
      const related = await Product.find({
        _id: { $ne: product._id },
        subcategory_id: product.subcategory_id,
        is_visible: true,
        status: "active",
        ...buildPublicAffiliateComplianceQuery(),
      })
        .sort({ sort_order: 1, createdAt: -1 })
        .limit(8)
        .lean();
      extras.related_products = related.map((entry) => toFlat(entry, { publicView }));
    }

    if (includeParts.has("vendor") && product.vendor_id) {
      const vendor = await Vendor.findById(product.vendor_id).select("shop_name business_name owner_name").lean();
      if (vendor) {
        extras.vendor_summary = {
          id: vendor._id.toString(),
          shop_name: vendor.shop_name || vendor.business_name || vendor.owner_name,
          business_name: vendor.business_name || null,
          owner_name: vendor.owner_name || null,
        };
      }
    }

    if (includeParts.has("breadcrumb")) {
      const breadcrumb = [{ name: "Home", href: "/" }];
      if (product.category && product.category !== "Uncategorized") {
        breadcrumb.push({
          name: product.category,
          href: `/products?category=${encodeURIComponent(String(product.category || ""))}`,
        });
      }
      if (product.subcategory && product.subcategory !== "Uncategorized") {
        breadcrumb.push({
          name: product.subcategory,
          href: `/products?category=${encodeURIComponent(String(product.category || ""))}&subcategory=${encodeURIComponent(String(product.subcategory || ""))}`,
        });
      }
      breadcrumb.push({ name: product.title, href: `/product/${product.slug}` });
      extras.breadcrumb = breadcrumb;
    }

    res.json({ ...flatProduct, ...extras });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProductSuggestions = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (query.length < 2) {
      return res.json({ products: [], categories: [] });
    }

    const [products, categories] = await Promise.all([
      Product.find({
        $text: { $search: query },
        is_visible: true,
        status: "active",
        ...buildPublicAffiliateComplianceQuery(),
      })
        .select({ title: 1, slug: 1, is_affiliate: 1, affiliate_data_source: 1, featured_image: 1, image_items: 1, images: 1, price: 1, sale_price: 1, score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" }, createdAt: -1 })
        .limit(6)
        .lean(),
      ProductCategory.find({ name: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), is_active: true })
        .select("name slug")
        .sort({ sort_order: 1, name: 1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      products: products.map((product) => {
        const flat = toFlat(product, { publicView: true });
        return {
          id: flat.id,
          slug: flat.slug,
          title: flat.title,
          featured_image: flat.featured_image || null,
          price: flat.sale_price ?? flat.price,
        };
      }),
      categories: categories.map((category) => ({
        id: category._id.toString(),
        slug: category.slug,
        name: category.name,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const validateCartProducts = async (req, res) => {
  try {
    const requestItems = Array.isArray(req.body.items) ? req.body.items : [];
    const uniqueIds = [...new Set(requestItems.map((item) => String(item?.id || "").trim()).filter(Boolean))];
    if (!uniqueIds.length) return res.json({ items: [], notices: [] });

    const [products, virtualProducts] = await Promise.all([
      Product.find({ _id: { $in: uniqueIds } }).lean(),
      VirtualProduct.find({ _id: { $in: uniqueIds } }).lean(),
    ]);

    const physicalMap = new Map(products.map((product) => [product._id.toString(), product]));
    const virtualMap = new Map(virtualProducts.map((product) => [product._id.toString(), product]));
    const notices = [];
    const validatedItems = [];

    for (const item of requestItems) {
      const id = String(item?.id || "").trim();
      const requestedQuantity = Math.max(Number(item?.quantity || 1), 1);
      if (!id) continue;

      const physical = physicalMap.get(id);
      if (physical) {
        if (physical.is_affiliate) {
          notices.push(`${physical.title} opens on Amazon and was removed from your cart.`);
          continue;
        }
        if (!physical.is_visible || physical.status !== "active" || physical.category === "Uncategorized" || physical.subcategory === "Uncategorized") {
          notices.push(`${physical.title} is no longer available and was removed from your cart.`);
          continue;
        }

        if (Number(physical.stock_quantity || 0) <= 0) {
          notices.push(`${physical.title} is now out of stock and was removed from your cart.`);
          continue;
        }

        const nextQuantity = Math.min(requestedQuantity, Number(physical.stock_quantity || 0));
        const nextPrice = physical.sale_price ?? physical.price;
        if (Number(item?.price) !== Number(nextPrice)) {
          notices.push(`${physical.title} had a price update in your cart.`);
        }
        if (nextQuantity !== requestedQuantity) {
          notices.push(`${physical.title} quantity was adjusted to ${nextQuantity} based on current stock.`);
        }

        validatedItems.push({
          id,
          title: physical.title,
          price: Number(nextPrice),
          priceMax: Number(physical.price),
          format: "Physical Product",
          quantity: nextQuantity,
          image_url: physical.featured_image || null,
          slug: physical.slug,
          stock_quantity_at_add: Number(physical.stock_quantity || 0),
        });
        continue;
      }

      const virtual = virtualMap.get(id);
      if (virtual) {
        validatedItems.push({
          id,
          title: virtual.title,
          price: Number(virtual.price || 0),
          priceMax: Number(virtual.price_max ?? virtual.price ?? 0),
          format: virtual.format || "Virtual Program",
          quantity: requestedQuantity,
          image_url: null,
          slug: virtual.slug,
          stock_quantity_at_add: null,
        });
        continue;
      }

      notices.push(`An item in your cart is no longer available and was removed.`);
    }

    res.json({ items: validatedItems, notices });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const createProduct = async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      const products = [];
      for (const row of req.body) {
        const fieldErrors = validateProductPayload(row);
        if (Object.keys(fieldErrors).length) {
          const error = new Error("Validation failed");
          error.statusCode = 400;
          error.field_errors = fieldErrors;
          throw error;
        }
        const payload = await buildProductPayload(row);
        const uniquenessErrors = await validateAdminProductUniqueness(payload);
        if (Object.keys(uniquenessErrors).length) {
          const error = new Error("Validation failed");
          error.statusCode = 400;
          error.field_errors = uniquenessErrors;
          throw error;
        }
        const mediaErrors = await validateProductMedia(payload.featured_image, payload.images);
        if (Object.keys(mediaErrors).length) {
          const error = new Error(Object.values(mediaErrors)[0]);
          error.statusCode = 400;
          error.field_errors = mediaErrors;
          throw error;
        }
        const mediaPayload = await ingestProductMedia({
          featuredImage: payload.featured_image,
          imageUrls: payload.images,
          imageItems: payload.image_items,
        });
        const product = await Product.create({ ...payload, ...mediaPayload });
        products.push(product);
      }
      await Promise.all(products.map((product) => queueAdminCampaignIfNeeded(product)));
      return res.status(201).json(products.map((product) => toFlat(product.toObject())));
    }

    const fieldErrors = validateProductPayload(req.body);
    if (Object.keys(fieldErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: fieldErrors });
    }

    const payload = await buildProductPayload(req.body);
    const uniquenessErrors = await validateAdminProductUniqueness(payload);
    if (Object.keys(uniquenessErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: uniquenessErrors });
    }
    const mediaErrors = await validateProductMedia(payload.featured_image, payload.images);
    if (Object.keys(mediaErrors).length) {
      return res.status(400).json({ message: Object.values(mediaErrors)[0], field_errors: mediaErrors });
    }
    const mediaPayload = await ingestProductMedia({
      featuredImage: payload.featured_image,
      imageUrls: payload.images,
      imageItems: payload.image_items,
    });
    const product = await Product.create({ ...payload, ...mediaPayload });
    await queueAdminCampaignIfNeeded(product);
    res.status(201).json(toFlat(product.toObject()));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const updateProduct = async (req, res) => {
  try {
    const adminNonAffiliateFilter = {
      $and: [
        { _id: req.params.id },
        buildSourceTypeQuery("admin"),
        buildAffiliateQuery(false),
      ],
    };
    const existing = await Product.findOne(adminNonAffiliateFilter);
    if (!existing) return res.status(404).json({ message: "Product not found" });

    const fieldErrors = validateProductPayload({ ...existing.toObject(), ...req.body });
    if (Object.keys(fieldErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: fieldErrors });
    }

    const wasEligibleForCampaignQueue = isEligibleForAdminCampaignQueue(existing);
    const payload = await buildProductPayload(req.body, existing);
    const uniquenessErrors = await validateAdminProductUniqueness(payload, existing._id);
    if (Object.keys(uniquenessErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: uniquenessErrors });
    }
    const mediaErrors = await validateProductMedia(payload.featured_image, payload.images);
    if (Object.keys(mediaErrors).length) {
      return res.status(400).json({ message: Object.values(mediaErrors)[0], field_errors: mediaErrors });
    }
    const mediaPayload = await ingestProductMedia({
      featuredImage: payload.featured_image,
      imageUrls: payload.images,
      imageItems: payload.image_items,
    });
    const product = await Product.findOneAndUpdate(adminNonAffiliateFilter, { ...payload, ...mediaPayload }, { new: true }).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!wasEligibleForAdminCampaignQueue && isEligibleForAdminCampaignQueue(product)) {
      await queueAdminCampaignIfNeeded(product, new Date());
    }
    res.json(toFlat(product));
  } catch (err) {
    res.status(400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const bulkImportProducts = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const mode = String(req.body.mode || "create_only").trim() === "upsert" ? "upsert" : "create_only";
    if (!rows.length) return res.status(400).json({ message: "No product rows received" });

    const imported = [];
    const errors = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const normalizedRow = {
        ...row,
        category: row.category_name || row.category,
        subcategory: row.subcategory_name || row.subcategory,
        images: normalizeStringList(row.additional_images || row.images),
        seo_keywords: normalizeStringList(row.seo_keywords),
        tags: normalizeStringList(row.tags),
      };

      const fieldErrors = validateProductPayload(normalizedRow);
      if (Object.keys(fieldErrors).length) {
        errors.push({
          row: index + 2,
          title: normalizeString(normalizedRow.title),
          sku: normalizeString(normalizedRow.sku),
          errors: Object.values(fieldErrors),
          field_errors: fieldErrors,
        });
        continue;
      }

      try {
        const existing = mode === "upsert"
          ? await Product.findOne({
            $and: [
              buildSourceTypeQuery("admin"),
              buildAffiliateQuery(false),
              {
                $or: [
                  normalizedRow.sku ? { sku: normalizeString(normalizedRow.sku) } : null,
                  normalizedRow.slug ? { slug: String(normalizedRow.slug).trim() } : null,
                ].filter(Boolean),
              },
            ],
          })
          : null;

        const payload = await buildProductPayload(normalizedRow, existing);
        const uniquenessErrors = await validateAdminProductUniqueness(payload, existing?._id || null);
        if (Object.keys(uniquenessErrors).length) {
          errors.push({
            row: index + 2,
            title: normalizeString(normalizedRow.title),
            sku: normalizeString(normalizedRow.sku),
            errors: Object.values(uniquenessErrors),
            field_errors: uniquenessErrors,
          });
          continue;
        }
        const mediaErrors = await validateProductMedia(payload.featured_image, payload.images);
        if (Object.keys(mediaErrors).length) {
          errors.push({
            row: index + 2,
            title: normalizeString(normalizedRow.title),
            sku: normalizeString(normalizedRow.sku),
            errors: Object.values(mediaErrors),
            field_errors: mediaErrors,
          });
          continue;
        }

        const mediaPayload = await ingestProductMedia({
          featuredImage: payload.featured_image,
          imageUrls: payload.images,
          imageItems: payload.image_items,
        });

        const product = existing
          ? await Product.findByIdAndUpdate(existing._id, { ...payload, ...mediaPayload }, { new: true })
          : await Product.create({ ...payload, ...mediaPayload });

        imported.push(toFlat(product.toObject ? product.toObject() : product));
        await queueAdminCampaignIfNeeded(product, new Date());
      } catch (error) {
        errors.push({
          row: index + 2,
          title: normalizeString(normalizedRow.title),
          sku: normalizeString(normalizedRow.sku),
          errors: [error.message || "Could not import this row"],
        });
      }
    }

    res.status(201).json({
      summary: {
        total_rows: rows.length,
        success_rows: imported.length,
        failed_rows: errors.length,
        import_mode: mode,
      },
      imported_products: imported,
      errors,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const bulkUpdateProducts = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const update = req.body.$set && typeof req.body.$set === "object" ? req.body.$set : null;
    if (!ids.length || !update) return res.status(400).json({ message: "ids and $set are required" });

    const sanitizedUpdate = {};
    for (const [key, value] of Object.entries(update)) {
      if (!BULK_MUTABLE_FIELDS.has(key)) continue;
      if (key === "sale_price") {
        sanitizedUpdate.sale_price = normalizeNullableNumber(value);
        continue;
      }
      if (key === "stock_quantity" || key === "sort_order") {
        sanitizedUpdate[key] = normalizeNumber(value, 0);
        continue;
      }
      sanitizedUpdate[key] = key === "status" ? String(value || "draft").trim() : Boolean(value);
    }

    if (!Object.keys(sanitizedUpdate).length) {
      return res.status(400).json({ message: "No allowed fields were provided for bulk update" });
    }

    const products = await Product.find({
      _id: { $in: ids },
      $and: [buildSourceTypeQuery("admin"), buildAffiliateQuery(false)],
    });

    for (const product of products) {
      Object.assign(product, sanitizedUpdate);
      if (sanitizedUpdate.sale_price !== undefined) {
        product.effective_price = computeEffectivePrice(product.price, sanitizedUpdate.sale_price);
      }
      if (product.category === "Uncategorized" || product.subcategory === "Uncategorized") {
        product.is_visible = false;
      }
      await product.save();
    }

    res.json({ message: "Products updated", updated_count: products.length });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const bulkDeleteProducts = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ message: "ids are required" });

    const result = await Product.deleteMany({
      _id: { $in: ids },
      $and: [buildSourceTypeQuery("admin"), buildAffiliateQuery(false)],
    });

    res.json({ message: "Products deleted", deleted_count: Number(result.deletedCount || 0) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const adminNonAffiliateFilter = {
      $and: [
        { _id: req.params.id },
        buildSourceTypeQuery("admin"),
        buildAffiliateQuery(false),
      ],
    };
    const product = await Product.findOneAndDelete(adminNonAffiliateFilter);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getProducts,
  getProductsFacets,
  getProductSuggestions,
  getProduct,
  validateCartProducts,
  createProduct,
  updateProduct,
  bulkImportProducts,
  bulkUpdateProducts,
  bulkDeleteProducts,
  deleteProduct,
  _private: {
    buildProductFilter,
    isAdminFullViewRequest,
    sanitizePublicAttributes,
    toFlat,
  },
};
