const Product = require("../models/Product");
const { parseAffiliateExcelBuffer } = require("../services/affiliateExcelCatalog");
const {
  buildComplianceStatus,
  validateAmazonAffiliateUrl,
} = require("../services/amazonAffiliateCompliance");
const {
  checkAffiliateProductLink,
  persistAffiliateLinkCheck,
} = require("../services/affiliateLinkChecker");
const {
  refreshAffiliateProductFromCreatorsApi,
  refreshAffiliateProductsFromCreatorsApi,
} = require("../services/amazonCreatorsApiService");
const {
  buildImagePayload,
  normalizeManualAffiliateImageUrl,
} = require("../services/affiliateImagePolicy");
const { getUncategorizedRefs, resolveTaxonomySelection } = require("../utils/taxonomy");
const { ensureUniqueProductSlug } = require("../utils/productSlug");

const APPROVED_AFFILIATE_DATA_SOURCES = new Set(["creators_api", "pa_api"]);
const ADMIN_MUTABLE_AFFILIATE_DATA_SOURCES = new Set(["manual", "excel-upload", "unknown"]);
const AFFILIATE_STATUSES = new Set(["draft", "active", "inactive"]);

const toFlat = (doc) => ({
  ...doc,
  id: doc._id.toString(),
  category_id: doc.category_id?.toString?.() || doc.category_id || null,
  subcategory_id: doc.subcategory_id?.toString?.() || doc.subcategory_id || null,
});

const AFFILIATE_LIST_DEFAULT_LIMIT = 25;
const AFFILIATE_LIST_MAX_LIMIT = 100;
const AFFILIATE_QUICK_FILTERS = ["all", "needs_review", "published", "draft", "paused", "uncategorized", "missing_image", "link_issue"];

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseListPagination(query = {}) {
  const page = Math.max(parseInt(String(query.page || "1"), 10) || 1, 1);
  const requestedLimit = parseInt(String(query.limit || AFFILIATE_LIST_DEFAULT_LIMIT), 10) || AFFILIATE_LIST_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requestedLimit, 1), AFFILIATE_LIST_MAX_LIMIT);
  return { page, limit };
}

function wantsPaginatedAffiliateList(query = {}) {
  return ["page", "limit", "search", "quick_filter", "category_id", "subcategory_id"].some((key) =>
    Object.prototype.hasOwnProperty.call(query, key)
  );
}

function buildAffiliateListBaseQuery(query = {}) {
  const filter = { is_affiliate: true, source_type: "admin" };
  const categoryId = normalizeString(query.category_id);
  const subcategoryId = normalizeString(query.subcategory_id);
  const search = normalizeString(query.search);

  if (categoryId && categoryId !== "all") filter.category_id = categoryId;
  if (subcategoryId && subcategoryId !== "all") filter.subcategory_id = subcategoryId;
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { title: regex },
      { sku: regex },
      { category: regex },
      { subcategory: regex },
      { brand_name: regex },
      { affiliate_external_id: regex },
      { affiliate_asin: regex },
      { affiliate_marketplace: regex },
      { campaign_label: regex },
    ];
  }

  return filter;
}

function applyAffiliateQuickFilter(filter = {}, quickFilter = "all") {
  const nextFilter = { ...filter };
  if (quickFilter === "needs_review") nextFilter.affiliate_compliance_status = { $ne: "compliant" };
  if (quickFilter === "published") {
    nextFilter.status = "active";
    nextFilter.is_visible = true;
  }
  if (quickFilter === "draft") nextFilter.status = "draft";
  if (quickFilter === "paused") {
    nextFilter.$and = [
      ...(Array.isArray(nextFilter.$and) ? nextFilter.$and : []),
      { $or: [{ status: "inactive" }, { affiliate_compliance_status: "paused" }] },
    ];
  }
  if (quickFilter === "uncategorized") {
    nextFilter.$and = [
      ...(Array.isArray(nextFilter.$and) ? nextFilter.$and : []),
      { $or: [{ category: /^uncategorized$/i }, { subcategory: /^uncategorized$/i }] },
    ];
  }
  if (quickFilter === "missing_image") {
    nextFilter.$and = [
      ...(Array.isArray(nextFilter.$and) ? nextFilter.$and : []),
      { $or: [{ featured_image: null }, { featured_image: "" }, { featured_image: { $exists: false } }] },
    ];
  }
  if (quickFilter === "link_issue") nextFilter.affiliate_link_check_status = { $in: ["unchecked", "failed", "invalid", null] };
  return nextFilter;
}

function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMarketplace(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
  if (["amazon_in", "in", "india", "amazonindia"].includes(normalized)) return "amazon_in";
  if (["amazon_com", "amazon_us", "us", "usa", "united_states", "amazon"].includes(normalized)) return "amazon_us";
  return normalized || null;
}

function parseCurrencyNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function fieldError(message, fieldErrors = {}) {
  const err = new Error(message);
  err.statusCode = 400;
  err.field_errors = fieldErrors;
  return err;
}

function isUncategorized(product = {}) {
  return String(product.category || "").toLowerCase() === "uncategorized"
    || String(product.subcategory || "").toLowerCase() === "uncategorized";
}

function canUseAffiliateImage(source) {
  return APPROVED_AFFILIATE_DATA_SOURCES.has(String(source || ""));
}

function normalizeAdminAffiliateDataSource(source = {}, existing = null) {
  const requested = normalizeString(source.affiliate_data_source || source.source_platform);
  if (ADMIN_MUTABLE_AFFILIATE_DATA_SOURCES.has(String(requested || ""))) return requested;
  if (existing && APPROVED_AFFILIATE_DATA_SOURCES.has(String(existing.affiliate_data_source || ""))) {
    return existing.affiliate_data_source;
  }
  return "manual";
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveManualAffiliateImageUrl(source = {}) {
  const payload = normalizePlainObject(source.affiliate_payload);
  const rawPayload = normalizePlainObject(payload.raw);
  const firstImageItem = Array.isArray(source.image_items)
    ? source.image_items.find((item) => normalizeString(typeof item === "string" ? item : item?.url))
    : null;
  const firstImage = Array.isArray(source.images)
    ? source.images.find((image) => normalizeString(image))
    : null;

  return normalizeString(
    source.image_url
    || source.manual_image_url
    || source.featured_image
    || (typeof firstImageItem === "string" ? firstImageItem : firstImageItem?.url)
    || firstImage
    || payload.image_url
    || payload.manual_image_url
    || payload.featured_image
    || rawPayload.image_url
    || rawPayload.manual_image_url
    || rawPayload.featured_image
  );
}

function buildAffiliatePayloadSnapshot(item = {}, source = {}, imageUrl = null, dataSource = "manual") {
  const existingPayload = normalizePlainObject(source.affiliate_payload);
  const incomingPayload = normalizePlainObject(item);
  const rawPayload = normalizePlainObject(source.raw);
  const existingRawPayload = normalizePlainObject(existingPayload.raw);
  const manualDataSource = !APPROVED_AFFILIATE_DATA_SOURCES.has(String(dataSource || ""));
  const hasImageInput = ["image_url", "manual_image_url", "featured_image", "images", "image_items"]
    .some((key) => Object.prototype.hasOwnProperty.call(incomingPayload, key));

  const payload = {
    ...existingPayload,
    ...incomingPayload,
  };

  if (Object.keys(rawPayload).length) {
    payload.raw = {
      ...existingRawPayload,
      ...rawPayload,
    };
  }

  if (manualDataSource && (imageUrl || hasImageInput)) {
    payload.image_url = imageUrl || "";
    payload.manual_image_url = imageUrl || "";
  }

  return payload;
}

function buildPreservedApiContent(existing = null, dataSource = "manual") {
  if (!existing || !APPROVED_AFFILIATE_DATA_SOURCES.has(String(dataSource || ""))) {
    return {
      images: [],
      image_items: [],
      featured_image: null,
      price: 0,
      sale_price: null,
      effective_price: 0,
      mrp: null,
      stock_quantity: 0,
      affiliate_data_last_refreshed_at: null,
      affiliate_data_expires_at: null,
      affiliate_api_error: null,
    };
  }

  return {
    images: Array.isArray(existing.images) ? existing.images : [],
    image_items: Array.isArray(existing.image_items) ? existing.image_items : [],
    featured_image: normalizeString(existing.featured_image),
    price: normalizeNumber(existing.price, 0),
    sale_price: existing.sale_price == null ? null : normalizeNumber(existing.sale_price, null),
    effective_price: normalizeNumber(existing.effective_price, normalizeNumber(existing.sale_price ?? existing.price, 0)),
    mrp: existing.mrp == null ? null : normalizeNumber(existing.mrp, null),
    stock_quantity: normalizeNumber(existing.stock_quantity, 0),
    affiliate_data_last_refreshed_at: existing.affiliate_data_last_refreshed_at || null,
    affiliate_data_expires_at: existing.affiliate_data_expires_at || null,
    affiliate_api_error: existing.affiliate_api_error || null,
  };
}

function buildAffiliateImageContent(source = {}, existing = null, dataSource = "manual", title = "Affiliate product") {
  if (APPROVED_AFFILIATE_DATA_SOURCES.has(String(dataSource || ""))) {
    return buildPreservedApiContent(existing, dataSource);
  }

  try {
    const manualImageUrl = normalizeManualAffiliateImageUrl(resolveManualAffiliateImageUrl(source));
    return {
      ...buildImagePayload(manualImageUrl, title),
      price: 0,
      sale_price: null,
      effective_price: 0,
      mrp: null,
      stock_quantity: 0,
      affiliate_data_last_refreshed_at: null,
      affiliate_data_expires_at: null,
      affiliate_api_error: null,
    };
  } catch (error) {
    throw fieldError(error.message, { image_url: error.message });
  }
}

function buildRequiredAffiliateFieldErrors(payload = {}, raw = {}) {
  const fieldErrors = {};
  const dataSource = String(payload.affiliate_data_source || "manual");
  const manualDataSource = !APPROVED_AFFILIATE_DATA_SOURCES.has(dataSource);

  if (!normalizeString(raw.title || payload.title)) fieldErrors.title = "Title is required";
  if (!normalizeString(payload.affiliate_url)) fieldErrors.affiliate_url = "Affiliate URL with tag is required";
  if (!normalizeString(payload.affiliate_marketplace)) fieldErrors.affiliate_marketplace = "Marketplace is required";
  if (!normalizeString(payload.affiliate_asin)) fieldErrors.affiliate_asin = "ASIN is required";
  if (!payload.category_id || String(payload.category || "").toLowerCase() === "uncategorized") {
    fieldErrors.category_id = "Category is required";
  }
  if (!payload.subcategory_id || String(payload.subcategory || "").toLowerCase() === "uncategorized") {
    fieldErrors.subcategory_id = "Subcategory is required";
  }
  if (!normalizeString(raw.short_description || raw.description || payload.short_description)) {
    fieldErrors.short_description = "Short description is required";
  }
  if (!Array.isArray(payload.pros) || !payload.pros.length) fieldErrors.pros = "At least one pro is required";
  if (!Array.isArray(payload.cons) || !payload.cons.length) fieldErrors.cons = "At least one con is required";
  if (!normalizeString(payload.seo_title || payload.seo_meta_title)) fieldErrors.seo_title = "SEO title is required";
  if (!normalizeString(payload.seo_description || payload.seo_meta_description)) {
    fieldErrors.seo_description = "SEO description is required";
  }

  return fieldErrors;
}

async function validateAffiliateUniqueness(source = {}, existingProductId = null) {
  const asin = source.asin || source.affiliate_asin;
  const marketplace = source.marketplace || source.affiliate_marketplace;
  const slug = source.slug;
  const fieldErrors = {};
  const exclude = existingProductId ? { _id: { $ne: existingProductId } } : {};

  if (slug) {
    const duplicateSlug = await Product.findOne({ slug, ...exclude }).select("_id").lean();
    if (duplicateSlug) fieldErrors.slug = "Slug already exists";
  }

  if (asin && marketplace) {
    const duplicateAsin = await Product.findOne({
      is_affiliate: true,
      affiliate_marketplace: marketplace,
      affiliate_asin: asin,
      ...exclude,
    }).select("_id").lean();
    if (duplicateAsin) fieldErrors.affiliate_asin = "ASIN already exists for this marketplace";
  }

  return fieldErrors;
}

async function resolveAffiliateTaxonomy(source = {}, existing = null) {
  const hasTaxonomyInput = source.category_id || source.subcategory_id || source.category || source.subcategory;
  if (!hasTaxonomyInput && existing) {
    return {
      categoryDoc: { _id: existing.category_id, name: existing.category || "Uncategorized" },
      subcategoryDoc: { _id: existing.subcategory_id, name: existing.subcategory || "Uncategorized" },
      isUncategorized: isUncategorized(existing),
    };
  }

  if (!hasTaxonomyInput) {
    const uncategorized = await getUncategorizedRefs();
    return {
      categoryDoc: uncategorized.category,
      subcategoryDoc: uncategorized.subcategory,
      isUncategorized: true,
    };
  }

  return resolveTaxonomySelection({
    category_id: source.category_id,
    subcategory_id: source.subcategory_id,
    category: source.category,
    subcategory: source.subcategory,
    allowUncategorized: true,
  });
}

async function findExistingAffiliateProduct(item) {
  const sourceUrl = item.affiliate_url || item.source_url;
  const validation = validateAmazonAffiliateUrl(sourceUrl, {
    marketplace: normalizeMarketplace(item.affiliate_marketplace || item.marketplace),
    requireConfiguredTag: false,
  });
  const baseFilter = { is_affiliate: true, source_type: "admin" };

  if (validation.asin && validation.marketplace) {
    const byAsin = await Product.findOne({
      ...baseFilter,
      affiliate_marketplace: validation.marketplace,
      affiliate_asin: validation.asin,
    });
    if (byAsin) return byAsin;
  }

  if (item.external_id) {
    const byExternalId = await Product.findOne({ ...baseFilter, affiliate_external_id: String(item.external_id) });
    if (byExternalId) return byExternalId;
  }
  if (sourceUrl) {
    const byUrl = await Product.findOne({ ...baseFilter, affiliate_url: String(sourceUrl) });
    if (byUrl) return byUrl;
  }
  if (item.slug) {
    const bySlug = await Product.findOne({ ...baseFilter, slug: String(item.slug) });
    if (bySlug) return bySlug;
  }
  return null;
}

function normalizeImportError(error) {
  if (error?.field_errors && typeof error.field_errors === "object") {
    return Object.values(error.field_errors).filter(Boolean);
  }
  return [error?.message || "Could not import this row"];
}

function buildInvalidImportPreviewRow(errorRow = {}) {
  return {
    row: errorRow.row || null,
    title: errorRow.title || null,
    sku: errorRow.sku || null,
    asin: errorRow.asin || errorRow.affiliate_asin || null,
    marketplace: errorRow.marketplace || errorRow.affiliate_marketplace || null,
    category: errorRow.category || null,
    subcategory: errorRow.subcategory || null,
    image_url: errorRow.image_url || null,
    action: null,
    status: "invalid",
    errors: Array.isArray(errorRow.errors) ? errorRow.errors : [String(errorRow.errors || "Invalid row")],
  };
}

function buildValidImportPreviewRow({ item, payload, action }) {
  return {
    row: item.row_number || null,
    title: payload.title || item.title || null,
    sku: payload.sku || item.sku || null,
    asin: payload.affiliate_asin || item.affiliate_asin || null,
    marketplace: payload.affiliate_marketplace || item.affiliate_marketplace || null,
    category: payload.category || item.category || null,
    subcategory: payload.subcategory || item.subcategory || null,
    image_url: payload.featured_image || item.image_url || null,
    action,
    status: "valid",
    errors: [],
  };
}

async function assertImportTaxonomyIsValid(item) {
  try {
    const taxonomy = await resolveTaxonomySelection({
      category_id: item.category_id,
      subcategory_id: item.subcategory_id,
      category: item.category,
      subcategory: item.subcategory,
      allowUncategorized: false,
    });
    if (taxonomy.isUncategorized) {
      throw fieldError("Invalid taxonomy", {
        category_id: "Category is required",
        subcategory_id: "Subcategory is required",
      });
    }
  } catch (error) {
    if (error.field_errors) throw error;
    const message = error.message || "Valid category and subcategory are required";
    if (message.toLowerCase().includes("subcategory")) {
      throw fieldError("Invalid taxonomy", { subcategory_id: message });
    }
    throw fieldError("Invalid taxonomy", { category_id: message });
  }
}

function summarizeImportPreview(previewRows, validRows, parsed) {
  const createCount = validRows.filter((row) => row.action === "create").length;
  const updateCount = validRows.filter((row) => row.action === "update").length;
  const invalidRows = previewRows.filter((row) => row.status === "invalid").length;

  return {
    total_rows: parsed.meta?.total_rows ?? previewRows.length,
    valid_rows: validRows.length,
    invalid_rows: invalidRows,
    create_count: createCount,
    update_count: updateCount,
  };
}

async function analyzeAffiliateExcelImportBuffer(buffer, { fileName = null } = {}) {
  const parsed = await parseAffiliateExcelBuffer(buffer, { fileName });
  const previewRows = parsed.errors.map(buildInvalidImportPreviewRow);
  const validRows = [];
  const seenAsins = new Set();

  for (const item of parsed.items) {
    try {
      const marketplace = normalizeMarketplace(item.affiliate_marketplace || item.marketplace);
      const asin = normalizeString(item.affiliate_asin || item.asin);
      const asinKey = asin && marketplace ? `${marketplace}:${asin}` : null;

      if (asinKey) {
        if (seenAsins.has(asinKey)) {
          throw fieldError("Duplicate ASIN in workbook", {
            affiliate_asin: `Duplicate ASIN ${asin} for ${marketplace} appears more than once in this file`,
          });
        }
        seenAsins.add(asinKey);
      }

      await assertImportTaxonomyIsValid(item);
      const existing = await findExistingAffiliateProduct(item);
      const nextPayload = await buildAffiliatePayload({ ...item, status: "draft", is_visible: false }, existing);
      if (Array.isArray(nextPayload.affiliate_compliance_flags) && nextPayload.affiliate_compliance_flags.length) {
        throw fieldError("Affiliate URL is not compliant", {
          affiliate_url: `Fix compliance flags: ${nextPayload.affiliate_compliance_flags.join(", ")}`,
        });
      }
      const uniquenessErrors = await validateAffiliateUniqueness(nextPayload, existing?._id || null);
      if (Object.keys(uniquenessErrors).length) throw fieldError("Validation failed", uniquenessErrors);

      const action = existing ? "update" : "create";
      validRows.push({ item, payload: nextPayload, existing, action });
      previewRows.push(buildValidImportPreviewRow({ item, payload: nextPayload, action }));
    } catch (error) {
      previewRows.push(buildInvalidImportPreviewRow({
        row: item.row_number || null,
        title: item.title || null,
        sku: item.sku || null,
        asin: item.affiliate_asin || null,
        marketplace: item.affiliate_marketplace || item.marketplace || null,
        category: item.category || null,
        subcategory: item.subcategory || null,
        image_url: item.image_url || null,
        errors: normalizeImportError(error),
      }));
    }
  }

  return {
    parsed,
    validRows,
    previewRows,
    summary: summarizeImportPreview(previewRows, validRows, parsed),
    meta: parsed.meta,
  };
}

async function buildAffiliatePayload(item, existing = null) {
  const source = {
    ...(existing ? existing.toObject() : {}),
    ...item,
  };
  const rawTitle = normalizeString(source.title || source.short_title);
  const rawShortDescription = normalizeString(source.short_description || source.description);
  const title = rawTitle || "Affiliate Product";
  const requestedSlug = normalizeString(source.slug || title || source.external_id || "affiliate-product");
  const slug = await ensureUniqueProductSlug(requestedSlug, existing?._id || null);
  const affiliateUrl = normalizeString(source.affiliate_url || source.source_url);
  const validation = validateAmazonAffiliateUrl(affiliateUrl, {
    marketplace: normalizeMarketplace(source.affiliate_marketplace || source.marketplace),
    requireConfiguredTag: true,
  });
  const dataSource = normalizeAdminAffiliateDataSource(source, existing);
  const apiContent = buildAffiliateImageContent(source, existing, dataSource, title);
  const affiliatePayload = buildAffiliatePayloadSnapshot(item, source, apiContent.featured_image, dataSource);
  const taxonomy = await resolveAffiliateTaxonomy(source, existing);
  const requestedStatus = AFFILIATE_STATUSES.has(String(source.status || "")) ? String(source.status) : existing?.status || "draft";
  const complianceStatus = existing?.affiliate_compliance_status === "paused"
    ? "paused"
    : buildComplianceStatus(validation.flags);
  const visible = requestedStatus === "active"
    && complianceStatus === "compliant"
    && !taxonomy.isUncategorized
    && parseBoolean(source.is_visible, Boolean(existing?.is_visible));

  const payload = {
    title,
    slug,
    short_description: rawShortDescription || normalizeString(source.short_title),
    full_description: normalizeString(source.full_description || source.description),
    category_id: taxonomy.categoryDoc._id,
    subcategory_id: taxonomy.subcategoryDoc._id,
    category: taxonomy.categoryDoc.name,
    subcategory: taxonomy.subcategoryDoc.name,
    images: apiContent.images,
    image_items: apiContent.image_items,
    featured_image: apiContent.featured_image,
    price: apiContent.price,
    sale_price: apiContent.sale_price,
    effective_price: apiContent.effective_price,
    mrp: apiContent.mrp,
    cost_price: 0,
    gst_rate_percent: 0,
    brand_name: normalizeString(source.brand_name || source.brand),
    country_of_origin: normalizeString(source.country_of_origin) || (validation.marketplace === "amazon_us" ? "United States" : "India"),
    sku: normalizeString(source.sku) || (validation.asin ? `AMZ-${validation.asin}` : null),
    stock_quantity: apiContent.stock_quantity,
    tags: normalizeStringList(source.tags).length ? normalizeStringList(source.tags) : ["Affiliate"],
    weight: null,
    dimensions: normalizeString(source.dimensions),
    seo_meta_title: normalizeString(source.seo_meta_title || source.seo_title),
    seo_meta_description: normalizeString(source.seo_meta_description || source.seo_description),
    seo_keywords: normalizeStringList(source.seo_keywords),
    attributes: {
      ...(existing?.attributes && typeof existing.attributes === "object" ? existing.attributes : {}),
      affiliate_currency: validation.marketplace === "amazon_us" ? "USD" : "INR",
      imported_price_observed: parseCurrencyNumber(source.list_price ?? source.price, 0) || null,
      imported_sale_price_observed: parseCurrencyNumber(source.sale_price, 0) || null,
      imported_rating_observed: normalizeString(source.rating_text),
    },
    status: requestedStatus === "active" && complianceStatus !== "compliant" ? "draft" : requestedStatus,
    is_visible: visible,
    returnable: false,
    return_window_days: 0,
    return_liability: "pinkpaisa",
    featured: parseBoolean(source.featured, Boolean(existing?.featured)),
    bestseller: parseBoolean(source.bestseller, Boolean(existing?.bestseller)),
    sort_order: normalizeNumber(source.sort_order, existing?.sort_order ?? 9999),
    source_type: "admin",
    vendor_id: null,
    is_affiliate: true,
    affiliate_url: validation.normalizedUrl,
    affiliate_external_id: normalizeString(source.external_id || source.affiliate_external_id) || validation.asin,
    affiliate_source_platform: normalizeString(source.affiliate_source_platform || source.source_platform) || "manual",
    affiliate_payload: affiliatePayload,
    affiliate_asin: validation.asin,
    affiliate_marketplace: validation.marketplace,
    affiliate_tag: validation.affiliateTag,
    affiliate_data_source: dataSource,
    affiliate_data_last_refreshed_at: apiContent.affiliate_data_last_refreshed_at,
    affiliate_data_expires_at: apiContent.affiliate_data_expires_at,
    affiliate_api_error: apiContent.affiliate_api_error,
    affiliate_compliance_status: complianceStatus,
    affiliate_compliance_flags: validation.flags,
    buying_intent: normalizeString(source.buying_intent),
    campaign_label: normalizeString(source.campaign_label),
    pros: normalizeStringList(source.pros),
    cons: normalizeStringList(source.cons),
    seo_title: normalizeString(source.seo_title || source.seo_meta_title),
    seo_description: normalizeString(source.seo_description || source.seo_meta_description),
    is_featured_affiliate: parseBoolean(source.is_featured_affiliate, Boolean(existing?.is_featured_affiliate)),
    affiliate_sort_order: normalizeNumber(source.affiliate_sort_order, existing?.affiliate_sort_order ?? 0),
    affiliate_is_instagram_pick: parseBoolean(source.affiliate_is_instagram_pick, Boolean(existing?.affiliate_is_instagram_pick)),
  };
  const requiredErrors = buildRequiredAffiliateFieldErrors(payload, {
    title: rawTitle,
    short_description: rawShortDescription,
    description: normalizeString(source.description),
  });
  if (Object.keys(requiredErrors).length) {
    throw fieldError("Missing required affiliate product fields", requiredErrors);
  }
  return payload;
}

async function assertPublishable(product) {
  if (!product) throw fieldError("Affiliate product not found");
  const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
    marketplace: product.affiliate_marketplace,
    requireConfiguredTag: true,
  });
  const fieldErrors = {};
  if (!validation.isValid) fieldErrors.affiliate_url = `Fix compliance flags: ${validation.flags.join(", ")}`;
  if (isUncategorized(product)) fieldErrors.category_id = "Assign a category and subcategory before publishing";
  Object.assign(fieldErrors, buildRequiredAffiliateFieldErrors(product, {
    title: product.title,
    short_description: product.short_description,
  }));
  const uniquenessErrors = await validateAffiliateUniqueness({
    asin: validation.asin,
    marketplace: validation.marketplace,
    slug: product.slug,
  }, product._id);
  Object.assign(fieldErrors, uniquenessErrors);
  if (Object.keys(fieldErrors).length) throw fieldError("Affiliate product is not publishable", fieldErrors);
  return validation;
}

const listAffiliateProducts = async (req, res) => {
  try {
    if (!wantsPaginatedAffiliateList(req.query || {})) {
      const products = await Product.find({ is_affiliate: true, source_type: "admin" })
        .sort({ affiliate_sort_order: 1, createdAt: -1 })
        .lean();
      return res.json(products.map(toFlat));
    }

    const { page, limit } = parseListPagination(req.query);
    const baseQuery = buildAffiliateListBaseQuery(req.query);
    const quickFilter = AFFILIATE_QUICK_FILTERS.includes(String(req.query.quick_filter || "")) ? String(req.query.quick_filter) : "all";
    const listQuery = applyAffiliateQuickFilter(baseQuery, quickFilter);

    const [products, total, countValues] = await Promise.all([
      Product.find(listQuery)
      .sort({ affiliate_sort_order: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(listQuery),
      Promise.all(
        AFFILIATE_QUICK_FILTERS.map((filter) => Product.countDocuments(applyAffiliateQuickFilter(baseQuery, filter)))
      ),
    ]);

    const counts = Object.fromEntries(AFFILIATE_QUICK_FILTERS.map((filter, index) => [filter, countValues[index] || 0]));
    return res.json({
      items: products.map(toFlat),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
      },
      counts,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createAffiliateProduct = async (req, res) => {
  try {
    const payload = await buildAffiliatePayload(req.body);
    const uniquenessErrors = await validateAffiliateUniqueness(payload);
    if (Object.keys(uniquenessErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: uniquenessErrors });
    }
    const product = await Product.create(payload);
    res.status(201).json(toFlat(product.toObject()));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const updateAffiliateProduct = async (req, res) => {
  try {
    const existing = await Product.findOne({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
    if (!existing) return res.status(404).json({ message: "Affiliate product not found" });
    const payload = await buildAffiliatePayload(req.body, existing);
    const uniquenessErrors = await validateAffiliateUniqueness(payload, existing._id);
    if (Object.keys(uniquenessErrors).length) {
      return res.status(400).json({ message: "Validation failed", field_errors: uniquenessErrors });
    }
    Object.assign(existing, payload);
    await existing.save();
    res.json(toFlat(existing.toObject()));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const deleteAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    res.json({ message: "Affiliate product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const uploadAffiliateProducts = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Upload an Excel file using multipart/form-data field name: file" });
    }

    const analysis = await analyzeAffiliateExcelImportBuffer(req.file.buffer, { fileName: req.file.originalname });
    if (!analysis.validRows.length) {
      return res.status(400).json({
        message: "No valid affiliate products found in the uploaded Excel file",
        created: 0,
        updated: 0,
        skipped: analysis.summary.invalid_rows,
        total: await Product.countDocuments({ is_affiliate: true, source_type: "admin" }),
        items: [],
        errors: analysis.previewRows.filter((row) => row.status === "invalid"),
        meta: analysis.meta,
        summary: analysis.summary,
      });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const importErrors = analysis.previewRows.filter((row) => row.status === "invalid");

    for (const row of analysis.validRows) {
      try {
        if (row.existing) {
          Object.assign(row.existing, row.payload, { status: "draft", is_visible: false });
          await row.existing.save();
          updatedCount += 1;
        } else {
          await Product.create({ ...row.payload, status: "draft", is_visible: false });
          createdCount += 1;
        }
      } catch (error) {
        importErrors.push({
          row: row.item.row_number || null,
          title: row.item.title || null,
          sku: row.item.sku || null,
          asin: row.item.affiliate_asin || null,
          marketplace: row.item.affiliate_marketplace || row.item.marketplace || null,
          category: row.item.category || null,
          subcategory: row.item.subcategory || null,
          image_url: row.item.image_url || null,
          action: row.action,
          status: "invalid",
          errors: normalizeImportError(error),
        });
      }
    }

    const products = await Product.find({ is_affiliate: true, source_type: "admin" }).sort({ createdAt: -1 }).lean();
    res.status(201).json({
      message: "Affiliate products uploaded for review",
      created: createdCount,
      updated: updatedCount,
      skipped: importErrors.length,
      total: products.length,
      items: products.map(toFlat),
      errors: importErrors,
      meta: analysis.meta,
      summary: {
        ...analysis.summary,
        valid_rows: createdCount + updatedCount,
        invalid_rows: importErrors.length,
        create_count: createdCount,
        update_count: updatedCount,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const previewAffiliateProducts = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Upload an Excel file using multipart/form-data field name: file" });
    }

    const analysis = await analyzeAffiliateExcelImportBuffer(req.file.buffer, { fileName: req.file.originalname });
    res.json({
      message: "Affiliate product upload preview ready",
      summary: analysis.summary,
      preview_rows: analysis.previewRows,
      has_valid_rows: analysis.validRows.length > 0,
      meta: analysis.meta,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const assignAffiliateCategory = async (req, res) => {
  try {
    const productIds = Array.isArray(req.body.product_ids) ? req.body.product_ids.filter(Boolean) : [];
    if (productIds.length === 0) return res.status(400).json({ message: "Select at least one affiliate product" });

    const taxonomy = await resolveTaxonomySelection({
      category_id: req.body.category_id,
      subcategory_id: req.body.subcategory_id,
      category: req.body.category,
      subcategory: req.body.subcategory,
      allowUncategorized: false,
    });

    await Product.updateMany(
      { _id: { $in: productIds }, is_affiliate: true, source_type: "admin" },
      {
        $set: {
          category_id: taxonomy.categoryDoc._id,
          subcategory_id: taxonomy.subcategoryDoc._id,
          category: taxonomy.categoryDoc.name,
          subcategory: taxonomy.subcategoryDoc.name,
        },
      }
    );

    const products = await Product.find({ _id: { $in: productIds }, is_affiliate: true, source_type: "admin" }).lean();
    res.json({
      message: "Affiliate products assigned. Publish separately after compliance review.",
      items: products.map(toFlat),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const AFFILIATE_BULK_ACTIONS = new Set([
  "validate_compliance",
  "check_link",
  "publish",
  "unpublish",
  "pause",
  "feature",
  "unfeature",
  "instagram_pick",
  "instagram_unpick",
  "refresh_api",
  "assign_category",
  "delete",
]);

function normalizeBulkProductIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
}

function serializeBulkResult({ id, action, ok, message, product = null, extra = {} }) {
  const flattened = product ? toFlat(product.toObject ? product.toObject() : product) : null;
  return {
    id: id ? String(id) : (flattened?.id || null),
    action,
    ok: Boolean(ok),
    message: message || null,
    product: flattened,
    ...extra,
  };
}

async function validateAffiliateProductDocument(product) {
  const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
    marketplace: product.affiliate_marketplace,
    requireConfiguredTag: true,
  });
  product.affiliate_asin = validation.asin;
  product.affiliate_marketplace = validation.marketplace;
  product.affiliate_tag = validation.affiliateTag;
  product.affiliate_compliance_flags = validation.flags;
  product.affiliate_compliance_status = validation.isValid ? "compliant" : "needs_review";
  if (!validation.isValid) {
    product.status = "draft";
    product.is_visible = false;
  }
  await product.save();
  return { product, validation };
}

async function publishAffiliateProductDocument(product) {
  const validation = await assertPublishable(product);
  Object.assign(product, {
    status: "active",
    is_visible: true,
    affiliate_asin: validation.asin,
    affiliate_marketplace: validation.marketplace,
    affiliate_tag: validation.affiliateTag,
    affiliate_compliance_status: "compliant",
    affiliate_compliance_flags: [],
  });
  await product.save();
  return { product, validation };
}

async function applyAffiliateBulkAction(product, action, payload = {}) {
  if (!product) return serializeBulkResult({ action, ok: false, message: "Affiliate product not found" });

  if (action === "validate_compliance") {
    const result = await validateAffiliateProductDocument(product);
    return serializeBulkResult({
      id: product._id,
      action,
      ok: result.validation.isValid,
      message: result.validation.isValid ? "Compliance valid" : `Needs review: ${result.validation.flags.join(", ")}`,
      product,
      extra: { validation: result.validation },
    });
  }

  if (action === "check_link") {
    const result = await checkAffiliateProductLink(product);
    await persistAffiliateLinkCheck(product, result);
    return serializeBulkResult({
      id: product._id,
      action,
      ok: Boolean(result.ok),
      message: result.message || (result.ok ? "Amazon link reachable" : "Amazon link check failed"),
      product,
      extra: { link_check: result },
    });
  }

  if (action === "publish") {
    await publishAffiliateProductDocument(product);
    return serializeBulkResult({ id: product._id, action, ok: true, message: "Published", product });
  }

  if (action === "unpublish") {
    product.status = "draft";
    product.is_visible = false;
    await product.save();
    return serializeBulkResult({ id: product._id, action, ok: true, message: "Unpublished", product });
  }

  if (action === "pause") {
    product.status = "inactive";
    product.is_visible = false;
    product.affiliate_compliance_status = "paused";
    product.affiliate_compliance_flags = ["admin_paused"];
    await product.save();
    return serializeBulkResult({ id: product._id, action, ok: true, message: "Paused", product });
  }

  if (action === "feature" || action === "unfeature") {
    const featured = action === "feature";
    product.is_featured_affiliate = featured;
    product.featured = featured;
    await product.save();
    return serializeBulkResult({ id: product._id, action, ok: true, message: featured ? "Featured" : "Unfeatured", product });
  }

  if (action === "instagram_pick" || action === "instagram_unpick") {
    const picked = action === "instagram_pick";
    product.affiliate_is_instagram_pick = picked;
    await product.save();
    return serializeBulkResult({ id: product._id, action, ok: true, message: picked ? "Added to Instagram picks" : "Removed from Instagram picks", product });
  }

  if (action === "refresh_api") {
    const result = await refreshAffiliateProductFromCreatorsApi(product);
    const serialized = serializeRefreshResult(result);
    return {
      id: String(product._id),
      action,
      ok: Boolean(serialized.ok),
      message: serialized.message || (serialized.ok ? "Creators API refreshed" : "Creators API refresh failed"),
      product: serialized.product || toFlat(product.toObject ? product.toObject() : product),
      refresh: serialized,
    };
  }

  if (action === "assign_category") {
    const taxonomy = payload.taxonomy;
    if (!taxonomy) throw fieldError("Select category and subcategory");
    product.category_id = taxonomy.categoryDoc._id;
    product.subcategory_id = taxonomy.subcategoryDoc._id;
    product.category = taxonomy.categoryDoc.name;
    product.subcategory = taxonomy.subcategoryDoc.name;
    await product.save();
    return serializeBulkResult({ id: product._id, action, ok: true, message: "Category assigned", product });
  }

  if (action === "delete") {
    if (product.status === "active" || product.is_visible) {
      return serializeBulkResult({ id: product._id, action, ok: false, message: "Unpublish before deleting", product });
    }
    await Product.deleteOne({ _id: product._id, is_affiliate: true, source_type: "admin" });
    return serializeBulkResult({ id: product._id, action, ok: true, message: "Deleted" });
  }

  return serializeBulkResult({ id: product._id, action, ok: false, message: "Unsupported bulk action", product });
}

async function performAffiliateBulkAction({ productIds, action, payload = {} }) {
  const ids = normalizeBulkProductIds(productIds);
  if (!ids.length) throw fieldError("Select at least one affiliate product");
  if (!AFFILIATE_BULK_ACTIONS.has(action)) throw fieldError("Unsupported bulk action");
  if (ids.length > 100) throw fieldError("Select 100 or fewer affiliate products at a time");

  const actionPayload = { ...payload };
  if (action === "assign_category") {
    actionPayload.taxonomy = await resolveTaxonomySelection({
      category_id: payload.category_id,
      subcategory_id: payload.subcategory_id,
      category: payload.category,
      subcategory: payload.subcategory,
      allowUncategorized: false,
    });
  }

  const results = [];
  for (const id of ids) {
    try {
      const product = await Product.findOne({ _id: id, is_affiliate: true, source_type: "admin" });
      if (!product) {
        results.push(serializeBulkResult({ id, action, ok: false, message: "Affiliate product not found" }));
        continue;
      }
      results.push(await applyAffiliateBulkAction(product, action, actionPayload));
    } catch (err) {
      results.push(serializeBulkResult({
        id,
        action,
        ok: false,
        message: err.message || "Bulk action failed",
        extra: { field_errors: err.field_errors },
      }));
    }
  }

  const succeeded = results.filter((result) => result.ok).length;
  return {
    requested: ids.length,
    succeeded,
    failed: ids.length - succeeded,
    results,
  };
}

const bulkAffiliateProductAction = async (req, res) => {
  try {
    const summary = await performAffiliateBulkAction({
      productIds: req.body?.product_ids,
      action: req.body?.action,
      payload: req.body?.payload || {},
    });
    res.json({
      message: `Bulk action complete. ${summary.succeeded} succeeded, ${summary.failed} failed.`,
      ...summary,
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const publishAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
    await publishAffiliateProductDocument(product);
    res.json(toFlat(product.toObject()));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message, field_errors: err.field_errors });
  }
};

const unpublishAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, is_affiliate: true, source_type: "admin" },
      { $set: { status: "draft", is_visible: false } },
      { new: true }
    ).lean();
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    res.json(toFlat(product));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const pauseAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, is_affiliate: true, source_type: "admin" },
      {
        $set: {
          status: "inactive",
          is_visible: false,
          affiliate_compliance_status: "paused",
          affiliate_compliance_flags: ["admin_paused"],
        },
      },
      { new: true }
    ).lean();
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    res.json(toFlat(product));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const featureAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, is_affiliate: true, source_type: "admin" },
      {
        $set: {
          is_featured_affiliate: Boolean(req.body.is_featured_affiliate),
          featured: Boolean(req.body.is_featured_affiliate),
          affiliate_is_instagram_pick: parseBoolean(req.body.affiliate_is_instagram_pick, false),
        },
      },
      { new: true }
    ).lean();
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    res.json(toFlat(product));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const sortAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, is_affiliate: true, source_type: "admin" },
      {
        $set: {
          affiliate_sort_order: normalizeNumber(req.body.affiliate_sort_order, 0),
          sort_order: normalizeNumber(req.body.sort_order, normalizeNumber(req.body.affiliate_sort_order, 0)),
        },
      },
      { new: true }
    ).lean();
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    res.json(toFlat(product));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const validateAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    const { validation } = await validateAffiliateProductDocument(product);
    res.json({ product: toFlat(product.toObject()), validation });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const checkAffiliateProductLinkForAdmin = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });
    const result = await checkAffiliateProductLink(product);
    await persistAffiliateLinkCheck(product, result);
    res.json({ product: toFlat(product.toObject()), result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

function serializeRefreshResult(result) {
  const product = result.product?.toObject ? result.product.toObject() : result.product;
  return {
    ok: Boolean(result.ok),
    status: result.status || (result.ok ? "refreshed" : "failed"),
    message: result.message || null,
    product: product ? toFlat(product) : null,
  };
}

const refreshAffiliateProductApiData = async (req, res) => {
  try {
    const result = await refreshAffiliateProductFromCreatorsApi(req.params.id);
    const serialized = serializeRefreshResult(result);
    res.status(result.ok ? 200 : 400).json(serialized);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const refreshAffiliateProductsApiData = async (req, res) => {
  try {
    const productIds = Array.isArray(req.body?.product_ids) ? req.body.product_ids.filter(Boolean) : [];
    const limit = Number.isFinite(Number(req.body?.limit)) ? Number(req.body.limit) : undefined;
    const summary = await refreshAffiliateProductsFromCreatorsApi({ productIds, limit });
    const skipped = Boolean(summary.skipped);
    res.status(skipped || (summary.failed > 0 && summary.refreshed === 0) ? 400 : 200).json({
      message: summary.message || `Creators API refresh complete. Refreshed ${summary.refreshed}, failed ${summary.failed}.`,
      skipped,
      status: summary.status || (skipped ? "not_ready" : "complete"),
      reason: summary.reason || null,
      requested: summary.requested,
      refreshed: summary.refreshed,
      failed: summary.failed,
      results: (summary.results || []).map(serializeRefreshResult),
      readiness: summary.readiness || null,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const backfillAffiliateCompliance = async (_req, res) => {
  try {
    const products = await Product.find({ is_affiliate: true, source_type: "admin" });
    let reviewed = 0;
    let unpublished = 0;
    for (const product of products) {
      const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
        marketplace: product.affiliate_marketplace,
        requireConfiguredTag: true,
      });
      product.affiliate_asin = validation.asin;
      product.affiliate_marketplace = validation.marketplace;
      product.affiliate_tag = validation.affiliateTag;
      product.affiliate_compliance_flags = validation.flags;
      product.affiliate_compliance_status = validation.isValid ? "needs_review" : "needs_review";
      if (product.is_visible || product.status === "active") {
        product.status = "draft";
        product.is_visible = false;
        unpublished += 1;
      }
      await product.save();
      reviewed += 1;
    }
    res.json({ message: "Affiliate compliance backfill completed", reviewed, unpublished });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

function getAffiliatePayloadImageUrl(product = {}) {
  if (!product.affiliate_payload || typeof product.affiliate_payload !== "object") return null;
  return normalizeString(
    product.affiliate_payload.image_url
    || product.affiliate_payload.manual_image_url
    || product.affiliate_payload.featured_image
    || product.affiliate_payload.raw?.image_url
  );
}

const backfillAffiliateImages = async (_req, res) => {
  try {
    const products = await Product.find({
      is_affiliate: true,
      source_type: "admin",
      $or: [
        { featured_image: { $exists: false } },
        { featured_image: null },
        { featured_image: "" },
      ],
      affiliate_payload: { $ne: null },
    });
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const product of products) {
      const payloadImageUrl = getAffiliatePayloadImageUrl(product);
      if (!payloadImageUrl) {
        skipped += 1;
        continue;
      }

      try {
        const imageUrl = normalizeManualAffiliateImageUrl(payloadImageUrl);
        const imagePayload = buildImagePayload(imageUrl, product.title);
        product.images = imagePayload.images;
        product.image_items = imagePayload.image_items;
        product.featured_image = imagePayload.featured_image;
        await product.save();
        updated += 1;
      } catch (error) {
        skipped += 1;
        errors.push({
          id: product._id.toString(),
          title: product.title,
          error: error.message,
        });
      }
    }

    res.json({
      message: `Affiliate image backfill completed. Updated ${updated}, skipped ${skipped}.`,
      updated,
      skipped,
      errors,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  listAffiliateProducts,
  createAffiliateProduct,
  updateAffiliateProduct,
  deleteAffiliateProduct,
  previewAffiliateProducts,
  uploadAffiliateProducts,
  assignAffiliateCategory,
  bulkAffiliateProductAction,
  publishAffiliateProduct,
  unpublishAffiliateProduct,
  pauseAffiliateProduct,
  featureAffiliateProduct,
  sortAffiliateProduct,
  validateAffiliateProduct,
  checkAffiliateProductLinkForAdmin,
  refreshAffiliateProductApiData,
  refreshAffiliateProductsApiData,
  backfillAffiliateCompliance,
  backfillAffiliateImages,
  buildAffiliatePayload,
  findExistingAffiliateProduct,
  _private: {
    analyzeAffiliateExcelImportBuffer,
    buildPreservedApiContent,
    buildAffiliateImageContent,
    buildAffiliatePayloadSnapshot,
    buildRequiredAffiliateFieldErrors,
    normalizeAdminAffiliateDataSource,
    performAffiliateBulkAction,
    resolveManualAffiliateImageUrl,
  },
};
