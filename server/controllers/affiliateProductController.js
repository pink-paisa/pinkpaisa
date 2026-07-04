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
const { getUncategorizedRefs, resolveTaxonomySelection } = require("../utils/taxonomy");
const { ensureUniqueProductSlug } = require("../utils/productSlug");

const APPROVED_AFFILIATE_DATA_SOURCES = new Set(["creators_api", "pa_api"]);
const AFFILIATE_STATUSES = new Set(["draft", "active", "inactive"]);

const toFlat = (doc) => ({
  ...doc,
  id: doc._id.toString(),
  category_id: doc.category_id?.toString?.() || doc.category_id || null,
  subcategory_id: doc.subcategory_id?.toString?.() || doc.subcategory_id || null,
});

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

async function buildAffiliatePayload(item, existing = null) {
  const source = {
    ...(existing ? existing.toObject() : {}),
    ...item,
  };
  const title = normalizeString(source.title || source.short_title) || "Affiliate Product";
  const requestedSlug = normalizeString(source.slug || title || source.external_id || "affiliate-product");
  const slug = await ensureUniqueProductSlug(requestedSlug, existing?._id || null);
  const affiliateUrl = normalizeString(source.affiliate_url || source.source_url);
  const validation = validateAmazonAffiliateUrl(affiliateUrl, {
    marketplace: normalizeMarketplace(source.affiliate_marketplace || source.marketplace),
    requireConfiguredTag: true,
  });
  const dataSource = normalizeString(source.affiliate_data_source || source.source_platform) || "manual";
  const image = canUseAffiliateImage(dataSource) ? normalizeString(source.image_url || source.featured_image) : null;
  const imageItems = image ? [{ url: image, alt: title, position: 0 }] : [];
  const taxonomy = await resolveAffiliateTaxonomy(source, existing);
  const requestedStatus = AFFILIATE_STATUSES.has(String(source.status || "")) ? String(source.status) : existing?.status || "draft";
  const complianceStatus = existing?.affiliate_compliance_status === "paused"
    ? "paused"
    : buildComplianceStatus(validation.flags);
  const visible = requestedStatus === "active"
    && complianceStatus === "compliant"
    && !taxonomy.isUncategorized
    && parseBoolean(source.is_visible, Boolean(existing?.is_visible));

  return {
    title,
    slug,
    short_description: normalizeString(source.short_description || source.short_title || source.description),
    full_description: normalizeString(source.full_description || source.description),
    category_id: taxonomy.categoryDoc._id,
    subcategory_id: taxonomy.subcategoryDoc._id,
    category: taxonomy.categoryDoc.name,
    subcategory: taxonomy.subcategoryDoc.name,
    images: image ? [image] : [],
    image_items: imageItems,
    featured_image: image,
    price: 0,
    sale_price: null,
    effective_price: 0,
    mrp: null,
    cost_price: 0,
    gst_rate_percent: 0,
    brand_name: normalizeString(source.brand_name || source.brand),
    country_of_origin: normalizeString(source.country_of_origin) || (validation.marketplace === "amazon_us" ? "United States" : "India"),
    sku: normalizeString(source.sku) || (validation.asin ? `AMZ-${validation.asin}` : null),
    stock_quantity: 0,
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
    vendor_product_id: null,
    is_affiliate: true,
    affiliate_url: validation.normalizedUrl,
    affiliate_external_id: normalizeString(source.external_id || source.affiliate_external_id) || validation.asin,
    affiliate_source_platform: normalizeString(source.affiliate_source_platform || source.source_platform) || "manual",
    affiliate_payload: source.raw || source.affiliate_payload || item,
    affiliate_asin: validation.asin,
    affiliate_marketplace: validation.marketplace,
    affiliate_tag: validation.affiliateTag,
    affiliate_data_source: dataSource,
    affiliate_data_last_refreshed_at: APPROVED_AFFILIATE_DATA_SOURCES.has(dataSource) ? new Date() : null,
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
  const uniquenessErrors = await validateAffiliateUniqueness({
    asin: validation.asin,
    marketplace: validation.marketplace,
    slug: product.slug,
  }, product._id);
  Object.assign(fieldErrors, uniquenessErrors);
  if (Object.keys(fieldErrors).length) throw fieldError("Affiliate product is not publishable", fieldErrors);
  return validation;
}

const listAffiliateProducts = async (_req, res) => {
  try {
    const products = await Product.find({ is_affiliate: true, source_type: "admin" })
      .sort({ affiliate_sort_order: 1, createdAt: -1 })
      .lean();
    res.json(products.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
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

    const parsed = await parseAffiliateExcelBuffer(req.file.buffer, { fileName: req.file.originalname });
    if (!parsed.items.length) {
      return res.status(400).json({
        message: "No valid affiliate products found in the uploaded Excel file",
        created: 0,
        updated: 0,
        skipped: parsed.errors.length,
        total: await Product.countDocuments({ is_affiliate: true, source_type: "admin" }),
        items: [],
        errors: parsed.errors,
        meta: parsed.meta,
      });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const importErrors = [...parsed.errors];

    for (const item of parsed.items) {
      try {
        const existing = await findExistingAffiliateProduct(item);
        const nextPayload = await buildAffiliatePayload({ ...item, status: "draft", is_visible: false }, existing);
        const uniquenessErrors = await validateAffiliateUniqueness(nextPayload, existing?._id || null);
        if (Object.keys(uniquenessErrors).length) throw fieldError("Validation failed", uniquenessErrors);
        if (existing) {
          Object.assign(existing, nextPayload, { status: "draft", is_visible: false });
          await existing.save();
          updatedCount += 1;
        } else {
          await Product.create({ ...nextPayload, status: "draft", is_visible: false });
          createdCount += 1;
        }
      } catch (error) {
        importErrors.push({
          row: item.row_number || null,
          title: item.title || null,
          sku: item.sku || null,
          errors: error.field_errors ? Object.values(error.field_errors) : [error.message || "Could not import this row"],
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
      meta: parsed.meta,
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

const publishAffiliateProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, is_affiliate: true, source_type: "admin" });
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

module.exports = {
  listAffiliateProducts,
  createAffiliateProduct,
  updateAffiliateProduct,
  deleteAffiliateProduct,
  uploadAffiliateProducts,
  assignAffiliateCategory,
  publishAffiliateProduct,
  unpublishAffiliateProduct,
  pauseAffiliateProduct,
  featureAffiliateProduct,
  sortAffiliateProduct,
  validateAffiliateProduct,
  checkAffiliateProductLinkForAdmin,
  backfillAffiliateCompliance,
  buildAffiliatePayload,
  findExistingAffiliateProduct,
};
