const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const VendorUploadLog = require("../models/VendorUploadLog");
const { publishVendorProduct, unpublishVendorProduct } = require("../utils/vendorProductSync");
const { enqueueApprovedProductCampaign } = require("../services/marketingAgentOrchestrator");
const logger = require("../utils/logger");
const {
  buildVendorProductFieldErrors,
  normalizeVendorProductRow,
  validateVendorProductRow,
} = require("../utils/vendorValidation");
const { resolveTaxonomySelection } = require("../utils/taxonomy");
const { ingestVendorImage, validateRemoteImageUrl } = require("../utils/vendorMedia");
const { DEFAULT_VENDOR_UPLOAD_LIMIT } = require("./vendorController");

const LIMIT_REACHED_MESSAGE = "You have reached your upload limit. Contact admin for more slots.";
const CATEGORY_RESTRICTION_MESSAGE = "Category mismatch: this category is not assigned to your vendor account.";
const IMPORT_MODES = ["create_only", "upsert"];
const TRIVIAL_VENDOR_EDIT_FIELDS = new Set([
  "price",
  "sale_price",
  "mrp",
  "gst_rate_percent",
  "stock_quantity",
  "status",
  "featured_image",
  "additional_images",
]);

const toView = (doc) => ({
  ...doc,
  id: doc._id.toString(),
  vendor_id: doc.vendor_id?._id?.toString?.() || doc.vendor_id?.toString?.() || doc.vendor_id,
  category_id: doc.category_id?._id?.toString?.() || doc.category_id?.toString?.() || doc.category_id || null,
  subcategory_id: doc.subcategory_id?._id?.toString?.() || doc.subcategory_id?.toString?.() || doc.subcategory_id || null,
  vendor: doc.vendor_id && typeof doc.vendor_id === "object" ? {
    id: doc.vendor_id._id?.toString?.() || doc.vendor_id.id,
    owner_name: doc.vendor_id.owner_name,
    business_name: doc.vendor_id.business_name,
    shop_name: doc.vendor_id.shop_name,
    email: doc.vendor_id.email,
  } : undefined,
  images: [doc.featured_image, ...(doc.additional_images || [])].filter(Boolean),
});

function resolveImportMode(value) {
  return IMPORT_MODES.includes(String(value || "").trim()) ? String(value || "").trim() : "create_only";
}

function getAssignedCategoryIds(vendorDoc) {
  return (vendorDoc?.assigned_category_ids || []).map((item) => item?._id?.toString?.() || item?.toString?.() || item).filter(Boolean);
}
function isVendorCategoryAllowed(vendorDoc, categoryId) {
  const assignedIds = getAssignedCategoryIds(vendorDoc);
  if (!assignedIds.length) return true;
  return assignedIds.includes(String(categoryId));
}

async function applyTaxonomy(normalized, { allowUncategorized = false, vendorDoc = null } = {}) {
  const taxonomy = await resolveTaxonomySelection({
    category_id: normalized.category_id,
    subcategory_id: normalized.subcategory_id,
    category: normalized.category,
    subcategory: normalized.subcategory,
    allowUncategorized,
  });
  if (!allowUncategorized && vendorDoc && !isVendorCategoryAllowed(vendorDoc, taxonomy.categoryDoc._id)) throw new Error(CATEGORY_RESTRICTION_MESSAGE);
  return {
    ...normalized,
    category_id: taxonomy.categoryDoc._id,
    subcategory_id: taxonomy.subcategoryDoc._id,
    category: taxonomy.categoryDoc.name,
    subcategory: taxonomy.subcategoryDoc.name,
    is_visible: !taxonomy.isUncategorized,
    featured: false,
    bestseller: false,
    return_liability: "vendor",
  };
}

async function ensureUniqueProductFields({ vendorId, sku, slug, excludeId = null }) {
  if (sku) {
    const existingSku = await VendorProduct.findOne({ vendor_id: vendorId, sku, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (existingSku) return "SKU already exists for this vendor";
  }
  if (slug) {
    const existingSlug = await VendorProduct.findOne({ vendor_id: vendorId, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (existingSlug) return "Slug already exists for this vendor";
  }
  return null;
}

async function findVendorProductByIdentity({ vendorId, sku, slug, excludeId = null }) {
  const or = [];
  if (sku) or.push({ sku });
  if (slug) or.push({ slug });
  if (!or.length) return null;
  return VendorProduct.findOne({
    vendor_id: vendorId,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: or,
  });
}

async function validateImageFields(normalized) {
  const errors = [];
  const featuredImageError = await validateRemoteImageUrl(normalized.featured_image);
  if (featuredImageError) errors.push(`featured image: ${featuredImageError}`);
  for (const imageUrl of normalized.additional_images || []) {
    const imageError = await validateRemoteImageUrl(imageUrl);
    if (imageError) errors.push(`additional image: ${imageError}`);
  }
  return errors;
}

function buildImageFieldErrors(errors = []) {
  const fieldErrors = {};
  const additionalImageErrors = [];

  for (const errorMessage of errors) {
    const normalizedMessage = String(errorMessage || "").trim();
    if (!normalizedMessage) continue;

    if (normalizedMessage.toLowerCase().startsWith("featured image:")) {
      fieldErrors.featured_image = normalizedMessage.replace(/^featured image:\s*/i, "") || normalizedMessage;
      continue;
    }

    if (normalizedMessage.toLowerCase().startsWith("additional image:")) {
      additionalImageErrors.push(normalizedMessage.replace(/^additional image:\s*/i, "") || normalizedMessage);
      continue;
    }
  }

  if (additionalImageErrors.length) {
    fieldErrors.additional_images = additionalImageErrors.join(" ");
  }

  return fieldErrors;
}

function buildUniquenessFieldErrors(message = "") {
  if (/sku/i.test(message)) return { sku: message };
  if (/slug/i.test(message)) return { slug: message };
  return {};
}

function buildDuplicateKeyFieldErrors(error) {
  const duplicateField = Object.keys(error?.keyPattern || {})[0] || Object.keys(error?.keyValue || {})[0] || "";
  if (duplicateField === "sku") {
    return { sku: "SKU already exists for this vendor" };
  }
  if (duplicateField === "slug") {
    return { slug: "Slug already exists for this vendor" };
  }
  return {};
}

async function ingestProductMedia(normalized) {
  return {
    ...normalized,
    effective_price: normalized.sale_price != null ? Number(normalized.sale_price) : Number(normalized.price || 0),
    featured_image: await ingestVendorImage(normalized.featured_image),
    additional_images: (await Promise.all((normalized.additional_images || []).map((imageUrl) => ingestVendorImage(imageUrl)))).filter(Boolean),
  };
}

async function applyVendorProductPayload(existing, normalizedWithTaxonomy, { preserveApproval = false } = {}) {
  const payloadWithManagedMedia = await ingestProductMedia(normalizedWithTaxonomy);
  if (!existing) return payloadWithManagedMedia;

  const needsReview = !preserveApproval && (existing.approval_status === "approved" || existing.approval_status === "rejected");
  Object.assign(existing, payloadWithManagedMedia, { featured: existing.featured || false, bestseller: existing.bestseller || false });
  existing.upload_status = "processed";
  if (needsReview) {
    existing.approval_status = "pending_approval";
    existing.approved_at = null;
    existing.published_product_id = null;
    existing.rejection_reason = null;
    existing.rejection_note = null;
    existing.resubmission_count = Number(existing.resubmission_count || 0) + 1;
    await unpublishVendorProduct(existing._id);
  }
  return existing;
}

function isTrivialApprovedEdit(existing, rawBody = {}) {
  if (!existing || existing.approval_status !== "approved") return false;
  const requestedKeys = Object.keys(rawBody || {}).filter((key) => rawBody[key] !== undefined);
  return requestedKeys.length > 0 && requestedKeys.every((key) => TRIVIAL_VENDOR_EDIT_FIELDS.has(key));
}

async function getVendorUsage(vendorId) {
  const [vendor, currentUploadedCount] = await Promise.all([
    Vendor.findById(vendorId).lean(),
    VendorProduct.countDocuments({ vendor_id: vendorId }),
  ]);
  const limit = vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT;
  return { vendor, currentUploadedCount, maxProductsAllowed: limit, remainingSlots: Math.max(limit - currentUploadedCount, 0) };
}

async function buildImportAnalysis({ vendorId, rows, mode = "create_only" }) {
  const usage = await getVendorUsage(vendorId);
  const allowedInsertions = usage.remainingSlots;
  const createdPayloads = [];
  const errors = [];
  const previewRows = [];
  const seenSkus = new Set();
  const seenSlugs = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const normalized = normalizeVendorProductRow(rows[index]);
    const rowErrors = validateVendorProductRow(normalized);
    let normalizedWithTaxonomy = normalized;
    let action = "create";
    let existingProduct = null;
    if (!rowErrors.length) {
      try { normalizedWithTaxonomy = await applyTaxonomy(normalized, { vendorDoc: usage.vendor }); } catch (error) { rowErrors.push(error.message); }
    }
    const normalizedSku = normalizedWithTaxonomy.sku ? String(normalizedWithTaxonomy.sku).trim().toLowerCase() : "";
    const normalizedSlug = normalizedWithTaxonomy.slug ? String(normalizedWithTaxonomy.slug).trim().toLowerCase() : "";
    if (normalizedSku) { if (seenSkus.has(normalizedSku)) rowErrors.push("Duplicate SKU found in uploaded file"); else seenSkus.add(normalizedSku); }
    if (normalizedSlug) { if (seenSlugs.has(normalizedSlug)) rowErrors.push("Duplicate slug found in uploaded file"); else seenSlugs.add(normalizedSlug); }
    if (!rowErrors.length) {
      existingProduct = await findVendorProductByIdentity({ vendorId, sku: normalizedWithTaxonomy.sku, slug: normalizedWithTaxonomy.slug });
      if (existingProduct) {
        if (mode === "upsert") action = "update";
        else rowErrors.push("SKU or slug already exists for this vendor");
      }
    }
    if (!rowErrors.length) {
      const imageErrors = await validateImageFields(normalizedWithTaxonomy);
      rowErrors.push(...imageErrors);
    }
    if (!rowErrors.length && action === "create" && createdPayloads.filter((entry) => entry.action === "create").length >= allowedInsertions) rowErrors.push(LIMIT_REACHED_MESSAGE);
    if (rowErrors.length) {
      const failure = { row: index + 2, title: normalizedWithTaxonomy.title || null, sku: normalizedWithTaxonomy.sku, errors: rowErrors, row_data: rows[index] };
      errors.push(failure);
      previewRows.push({ row: failure.row, title: failure.title, sku: failure.sku, category: normalizedWithTaxonomy.category || null, subcategory: normalizedWithTaxonomy.subcategory || null, action, status: "invalid", errors: rowErrors });
      continue;
    }
    const payload = {
      ...normalizedWithTaxonomy,
      vendor_id: vendorId,
      approval_status: "pending_approval",
      upload_status: "uploaded",
      approved_at: null,
      published_product_id: null,
      rejection_reason: null,
      rejection_note: null,
    };
    createdPayloads.push({ row: index + 2, payload, title: payload.title, sku: payload.sku, action, existingProductId: existingProduct?._id || null, row_data: rows[index] });
    previewRows.push({ row: index + 2, title: payload.title, sku: payload.sku, category: payload.category || null, subcategory: payload.subcategory || null, action, status: "valid", errors: [] });
  }

  return {
    usage,
    createdPayloads,
    errors,
    previewRows,
    summary: { total_rows: rows.length, valid_rows: createdPayloads.length, invalid_rows: errors.length, max_products_allowed: usage.maxProductsAllowed, current_uploaded_count: usage.currentUploadedCount, remaining_slots: usage.remainingSlots, import_mode: mode },
  };
}

const getVendorProductStats = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const products = await VendorProduct.find({ vendor_id: vendorId }).lean();
    const vendor = await Vendor.findById(vendorId).lean();
    const limit = vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT;
    res.json({
      total_uploaded_products: products.length,
      active_products: products.filter((p) => p.approval_status === "approved").length,
      out_of_stock_products: products.filter((p) => Number(p.stock_quantity) <= 0).length,
      featured_products: products.filter((p) => Boolean(p.featured)).length,
      bestseller_products: products.filter((p) => Boolean(p.bestseller)).length,
      pending_approval_products: products.filter((p) => p.approval_status === "pending_approval").length,
      rejected_products: products.filter((p) => p.approval_status === "rejected").length,
      approved_products: products.filter((p) => p.approval_status === "approved").length,
      max_products_allowed: limit,
      remaining_slots: Math.max(limit - products.length, 0),
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const listVendorProducts = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const approvalStatus = String(req.query.approval_status || req.query.status || "all");
    const query = { vendor_id: vendorId };
    if (approvalStatus !== "all") query.approval_status = approvalStatus;
    if (search) query.$or = [{ title: { $regex: search, $options: "i" } }, { sku: { $regex: search, $options: "i" } }, { category: { $regex: search, $options: "i" } }, { subcategory: { $regex: search, $options: "i" } }];
    const [items, total, usage] = await Promise.all([
      VendorProduct.find(query).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorProduct.countDocuments(query),
      getVendorUsage(vendorId),
    ]);
    res.json({ items: items.map(toView), pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }, usage: { current_uploaded_count: usage.currentUploadedCount, max_products_allowed: usage.maxProductsAllowed, remaining_slots: usage.remainingSlots } });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getVendorProduct = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const product = await VendorProduct.findOne({ _id: req.params.id, vendor_id: vendorId }).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(toView(product));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const createVendorProduct = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const usage = await getVendorUsage(vendorId);
    if (usage.remainingSlots <= 0) return res.status(403).json({ message: LIMIT_REACHED_MESSAGE, status: "limit_reached" });
    const normalized = normalizeVendorProductRow(req.body);
    const errors = validateVendorProductRow(normalized);
    if (errors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors,
        field_errors: buildVendorProductFieldErrors(normalized),
      });
    }
    const normalizedWithTaxonomy = await applyTaxonomy(normalized, { vendorDoc: usage.vendor });
    const imageErrors = await validateImageFields(normalizedWithTaxonomy);
    if (imageErrors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors: imageErrors,
        field_errors: buildImageFieldErrors(imageErrors),
      });
    }
    const uniquenessError = await ensureUniqueProductFields({ vendorId, sku: normalizedWithTaxonomy.sku, slug: normalizedWithTaxonomy.slug });
    if (uniquenessError) {
      return res.status(409).json({
        message: uniquenessError,
        field_errors: buildUniquenessFieldErrors(uniquenessError),
      });
    }
    const product = await VendorProduct.create({ ...(await ingestProductMedia(normalizedWithTaxonomy)), vendor_id: vendorId, approval_status: "pending_approval", upload_status: "uploaded", approved_at: null, published_product_id: null, rejection_reason: null, rejection_note: null });
    res.status(201).json(toView(product.toObject()));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message: "A product with this SKU or slug already exists for your account",
        field_errors: buildDuplicateKeyFieldErrors(err),
      });
    }
    res.status(400).json({ message: err.message });
  }
};

const updateVendorProduct = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const [existing, usage] = await Promise.all([VendorProduct.findOne({ _id: req.params.id, vendor_id: vendorId }), getVendorUsage(vendorId)]);
    if (!existing) return res.status(404).json({ message: "Product not found" });
    const normalized = normalizeVendorProductRow({ ...existing.toObject(), ...req.body, featured: false, bestseller: false });
    const errors = validateVendorProductRow(normalized);
    if (errors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors,
        field_errors: buildVendorProductFieldErrors(normalized),
      });
    }
    const normalizedWithTaxonomy = await applyTaxonomy(normalized, { vendorDoc: usage.vendor });
    const imageErrors = await validateImageFields(normalizedWithTaxonomy);
    if (imageErrors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors: imageErrors,
        field_errors: buildImageFieldErrors(imageErrors),
      });
    }
    const uniquenessError = await ensureUniqueProductFields({ vendorId, sku: normalizedWithTaxonomy.sku, slug: normalizedWithTaxonomy.slug, excludeId: existing._id });
    if (uniquenessError) {
      return res.status(409).json({
        message: uniquenessError,
        field_errors: buildUniquenessFieldErrors(uniquenessError),
      });
    }
    const preserveApproval = isTrivialApprovedEdit(existing, req.body);
    await applyVendorProductPayload(existing, normalizedWithTaxonomy, { preserveApproval });
    await existing.save();
    if (preserveApproval) {
      const publicProduct = await publishVendorProduct(existing);
      existing.published_product_id = publicProduct._id;
      await existing.save();
    }
    res.json(toView(existing.toObject()));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message: "A product with this SKU or slug already exists for your account",
        field_errors: buildDuplicateKeyFieldErrors(err),
      });
    }
    res.status(400).json({ message: err.message });
  }
};

const deleteVendorProduct = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const product = await VendorProduct.findOneAndDelete({ _id: req.params.id, vendor_id: vendorId });
    if (!product) return res.status(404).json({ message: "Product not found" });
    await unpublishVendorProduct(product._id);
    res.json({ message: "Product deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const patchVendorProductStock = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const product = await VendorProduct.findOne({ _id: req.params.id, vendor_id: vendorId });
    if (!product) return res.status(404).json({ message: "Product not found" });

    const hasSet = req.body.set !== undefined && req.body.set !== null && req.body.set !== "";
    const hasDelta = req.body.delta !== undefined && req.body.delta !== null && req.body.delta !== "";
    if (!hasSet && !hasDelta) return res.status(400).json({ message: "Either set or delta is required" });

    const nextStock = hasSet ? Number(req.body.set) : Number(product.stock_quantity || 0) + Number(req.body.delta || 0);
    if (!Number.isFinite(nextStock) || nextStock < 0) {
      return res.status(400).json({ message: "Stock quantity must be a valid non-negative number" });
    }

    product.stock_quantity = nextStock;
    await product.save();

    if (product.approval_status === "approved") {
      const publicProduct = await publishVendorProduct(product);
      product.published_product_id = publicProduct._id;
      await product.save();
    }

    res.json(toView(product.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const previewVendorProductsImport = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const mode = resolveImportMode(req.body.mode);
    if (!rows.length) return res.status(400).json({ message: "No product rows received" });
    const analysis = await buildImportAnalysis({ vendorId, rows, mode });
    res.json({ summary: analysis.summary, preview_rows: analysis.previewRows, has_valid_rows: analysis.createdPayloads.length > 0 });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const importVendorProducts = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const fileName = req.body.file_name || "vendor-upload";
    const mode = resolveImportMode(req.body.mode);
    if (!rows.length) return res.status(400).json({ message: "No product rows received" });
    const analysis = await buildImportAnalysis({ vendorId, rows, mode });
    const runtimeErrors = [];
    const inserted = [];
    for (const entry of analysis.createdPayloads) {
      try {
        if (entry.action === "update" && entry.existingProductId) {
          const existing = await VendorProduct.findOne({ _id: entry.existingProductId, vendor_id: vendorId });
          if (!existing) throw new Error("Existing product could not be found for update");
          await applyVendorProductPayload(existing, entry.payload);
          await existing.save();
          inserted.push(toView(existing.toObject()));
        } else {
          const doc = await VendorProduct.create({ ...(await ingestProductMedia(entry.payload)) });
          inserted.push(toView(doc.toObject()));
        }
      } catch (error) {
        runtimeErrors.push({ row: entry.row, title: entry.title || null, sku: entry.sku, errors: [error.message || "Could not import this row"], row_data: entry.row_data });
      }
    }
    const errors = [...analysis.errors, ...runtimeErrors];
    const usageAfter = await getVendorUsage(vendorId);
    const summary = { total_rows: rows.length, success_rows: inserted.length, failed_rows: errors.length, upload_status: errors.length === 0 ? "completed" : inserted.length ? "partial" : "failed", file_name: fileName, errors, max_products_allowed: usageAfter.maxProductsAllowed, current_uploaded_count: usageAfter.currentUploadedCount, remaining_slots: usageAfter.remainingSlots };
    const log = await VendorUploadLog.create({ vendor_id: vendorId, file_name: fileName, total_rows: summary.total_rows, success_rows: summary.success_rows, failed_rows: summary.failed_rows, upload_status: summary.upload_status, error_json: errors });
    res.status(201).json({ summary, imported_products: inserted, upload_log: { ...log.toObject(), id: log._id.toString(), vendor_id: vendorId.toString?.() || vendorId } });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const listVendorUploadLogs = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const logs = await VendorUploadLog.find({ vendor_id: vendorId }).sort({ created_at: -1 }).lean();
    res.json(logs.map((log) => ({ ...log, id: log._id.toString(), vendor_id: log.vendor_id.toString() })));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const listVendorProductsForAdmin = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const approvalStatus = String(req.query.approval_status || "all");
    const vendorId = String(req.query.vendor_id || "all");
    const query = {};
    if (approvalStatus !== "all") query.approval_status = approvalStatus;
    if (vendorId !== "all") query.vendor_id = vendorId;
    if (search) query.$or = [{ title: { $regex: search, $options: "i" } }, { sku: { $regex: search, $options: "i" } }, { category: { $regex: search, $options: "i" } }, { subcategory: { $regex: search, $options: "i" } }];
    const [items, total, counts, vendors] = await Promise.all([
      VendorProduct.find(query).populate("vendor_id", "owner_name business_name shop_name email").sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorProduct.countDocuments(query),
      VendorProduct.aggregate([{ $group: { _id: "$approval_status", count: { $sum: 1 } } }]),
      Vendor.find().select("owner_name business_name shop_name email max_products_allowed").sort({ created_at: -1 }).lean(),
    ]);
    const countMap = { pending_approval: 0, approved: 0, rejected: 0 };
    for (const entry of counts) countMap[entry._id] = entry.count;
    res.json({ items: items.map(toView), pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }, counts: countMap, vendors: vendors.map((vendor) => ({ id: vendor._id.toString(), owner_name: vendor.owner_name, business_name: vendor.business_name, shop_name: vendor.shop_name, email: vendor.email, max_products_allowed: vendor.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT })) });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getVendorProductForAdmin = async (req, res) => {
  try {
    const product = await VendorProduct.findById(req.params.id).populate("vendor_id", "owner_name business_name shop_name email mobile gstin max_products_allowed status").lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(toView(product));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateVendorProductApproval = async (req, res) => {
  try {
    const { approval_status, rejection_reason, rejection_note } = req.body;
    if (!["pending_approval", "approved", "rejected"].includes(approval_status)) return res.status(400).json({ message: "Invalid approval status" });
    if (approval_status === "rejected" && !String(rejection_reason || "").trim()) return res.status(400).json({ message: "Rejection reason is required" });
    const product = await VendorProduct.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.body.category_id || req.body.subcategory_id || req.body.category || req.body.subcategory) {
      const normalizedWithTaxonomy = await applyTaxonomy({ ...product.toObject(), ...req.body }, { allowUncategorized: true });
      Object.assign(product, normalizedWithTaxonomy);
    }
    if (req.body.featured != null) product.featured = Boolean(req.body.featured);
    if (req.body.bestseller != null) product.bestseller = Boolean(req.body.bestseller);
    product.approval_status = approval_status;
    product.approved_at = approval_status === "approved" ? new Date() : null;
    product.rejection_reason = approval_status === "rejected" ? String(rejection_reason || "").trim() : null;
    product.rejection_note = approval_status === "rejected" ? String(rejection_note || "").trim() || null : null;
    product.is_visible = product.category !== "Uncategorized" && product.subcategory !== "Uncategorized";
    if (approval_status === "approved") {
      const publicProduct = await publishVendorProduct(product);
      product.published_product_id = publicProduct._id;
    } else {
      await unpublishVendorProduct(product._id);
      product.published_product_id = null;
    }
    await product.save();
    const saved = await VendorProduct.findById(product._id).populate("vendor_id", "owner_name business_name shop_name email").lean();
    if (approval_status === "approved" && saved?.published_product_id) {
      enqueueApprovedProductCampaign({
        vendorProductId: saved._id,
        publicProductId: saved.published_product_id,
        approvedAt: saved.approved_at,
      }).catch((error) => logger.error({ err: error }, "marketing campaign enqueue failed"));
    }
    res.json({ message: approval_status === "approved" ? "Vendor product approved" : approval_status === "rejected" ? "Vendor product rejected" : "Vendor product moved to pending approval", product: toView(saved) });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = {
  getVendorProductStats,
  listVendorProducts,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  patchVendorProductStock,
  deleteVendorProduct,
  previewVendorProductsImport,
  importVendorProducts,
  listVendorUploadLogs,
  listVendorProductsForAdmin,
  getVendorProductForAdmin,
  updateVendorProductApproval,
};
