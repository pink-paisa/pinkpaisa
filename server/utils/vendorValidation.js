const requiredVendorFields = [
  "owner_name",
  "mobile",
  "email",
  "password",
  "confirm_password",
  "business_name",
  "shop_name",
  "business_type",
  "gstin",
  "pan",
  "address",
  "city",
  "state",
  "pincode",
  "account_holder_name",
  "account_number",
  "ifsc_code",
  "bank_name",
];

const requiredVendorProductFields = [
  "title",
  "slug",
  "price",
  "featured_image",
];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_REGEX = /^[6-9][0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTruthy(value) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(raw);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateVendorPayload(payload = {}) {
  const errors = {};

  for (const field of requiredVendorFields) {
    if (!String(payload[field] ?? "").trim()) errors[field] = "This field is required";
  }

  if (payload.mobile && !MOBILE_REGEX.test(String(payload.mobile).trim())) errors.mobile = "Enter a valid 10 digit mobile number";
  if (payload.email && !EMAIL_REGEX.test(String(payload.email).trim())) errors.email = "Enter a valid email address";
  const passwordError = getPasswordPolicyError(payload.password);
  if (passwordError) errors.password = passwordError;
  if (payload.password !== payload.confirm_password) errors.confirm_password = "Passwords do not match";
  if (payload.gstin && !GSTIN_REGEX.test(String(payload.gstin).trim().toUpperCase())) errors.gstin = "Enter a valid GSTIN";
  if (payload.pan && !PAN_REGEX.test(String(payload.pan).trim().toUpperCase())) errors.pan = "Enter a valid PAN";
  if (payload.pincode && String(payload.pincode).trim().length !== 6) errors.pincode = "Enter a valid 6 digit pincode";
  if (payload.ifsc_code && !IFSC_REGEX.test(String(payload.ifsc_code).trim().toUpperCase())) errors.ifsc_code = "Enter a valid IFSC code";
  if (payload.account_number && String(payload.account_number).trim().length < 8) errors.account_number = "Enter a valid account number";
  if (!payload.agree_terms) errors.agree_terms = "Please accept the terms";
  if (!payload.confirm_gst) errors.confirm_gst = "Please confirm your GST details";

  return errors;
}

function normalizeVendorProductRow(row = {}) {
  const priceValue = row.price ?? 0;
  const salePriceValue = row.sale_price ?? null;
  const stockQuantityValue = row.stock_quantity ?? 0;
  const sortOrderValue = row.sort_order ?? 0;
  const status = String(row.status ?? "active").trim().toLowerCase() || "active";

  return {
    title: String(row.title ?? "").trim(),
    slug: slugify(row.slug || row.title || ""),
    price: priceValue === "" || priceValue == null ? 0 : Number(priceValue),
    sale_price: salePriceValue === "" || salePriceValue == null ? null : Number(salePriceValue),
    effective_price: salePriceValue === "" || salePriceValue == null ? Number(priceValue || 0) : Number(salePriceValue),
    mrp: row.mrp === "" || row.mrp == null ? null : Number(row.mrp),
    gst_rate_percent: row.gst_rate_percent === "" || row.gst_rate_percent == null ? 0 : Number(row.gst_rate_percent),
    hsn_code: String(row.hsn_code ?? "").trim() || null,
    brand_name: String(row.brand_name ?? "").trim() || null,
    country_of_origin: String(row.country_of_origin ?? "").trim() || "India",
    sku: String(row.sku ?? "").trim() || null,
    stock_quantity: stockQuantityValue === "" || stockQuantityValue == null ? 0 : Number(stockQuantityValue),
    category_id: String(row.category_id ?? "").trim() || null,
    subcategory_id: String(row.subcategory_id ?? "").trim() || null,
    category: String(row.category ?? "").trim() || null,
    subcategory: String(row.subcategory ?? "").trim() || null,
    short_description: String(row.short_description ?? "").trim() || null,
    full_description: String(row.full_description ?? "").trim() || null,
    tags: normalizeList(row.tags),
    weight: String(row.weight ?? "").trim() || null,
    dimensions: String(row.dimensions ?? "").trim() || null,
    seo_meta_title: String(row.seo_meta_title ?? "").trim() || null,
    seo_meta_description: String(row.seo_meta_description ?? "").trim() || null,
    seo_keywords: normalizeList(row.seo_keywords),
    attributes: typeof row.attributes === "object" && row.attributes && !Array.isArray(row.attributes) ? row.attributes : {},
    status: ["active", "draft", "inactive"].includes(status) ? status : "draft",
    returnable: row.returnable == null || row.returnable === "" ? true : normalizeTruthy(row.returnable),
    return_window_days: row.return_window_days === "" || row.return_window_days == null ? 7 : Number(row.return_window_days),
    sort_order: sortOrderValue === "" || sortOrderValue == null ? 0 : Number(sortOrderValue),
    featured_image: String(row.featured_image ?? "").trim() || null,
    additional_images: normalizeList(row.additional_images),
  };
}

function buildVendorProductFieldErrors(row = {}) {
  const errors = {};

  if (!String(row.title ?? "").trim()) errors.title = "Title is required";
  if (!String(row.slug ?? "").trim()) errors.slug = "Slug is required";
  if (!String(row.featured_image ?? "").trim()) errors.featured_image = "Featured image is required";

  if (Number.isNaN(row.price) || Number(row.price) <= 0) errors.price = "Price must be greater than 0";
  if (row.sale_price != null && (Number.isNaN(row.sale_price) || Number(row.sale_price) < 0)) errors.sale_price = "Sale price must be a valid non-negative number";
  if (row.sale_price != null && Number(row.sale_price) > Number(row.price)) errors.sale_price = "Sale price cannot exceed price";
  if (row.mrp != null && (Number.isNaN(row.mrp) || Number(row.mrp) < Number(row.price))) errors.mrp = "MRP must be greater than or equal to price";
  if (row.gst_rate_percent != null && (Number.isNaN(row.gst_rate_percent) || Number(row.gst_rate_percent) < 0 || Number(row.gst_rate_percent) > 50)) errors.gst_rate_percent = "GST rate must be between 0 and 50";
  if (Number.isNaN(row.stock_quantity) || Number(row.stock_quantity) < 0) errors.stock_quantity = "Stock quantity must be a valid non-negative number";
  if (Number.isNaN(row.sort_order)) errors.sort_order = "Sort order must be a number";
  if (Number.isNaN(row.return_window_days) || Number(row.return_window_days) < 0) errors.return_window_days = "Return window days must be a valid non-negative number";

  if (!row.category_id && !row.category) errors.category_id = "Category is required";
  if (!row.subcategory_id && !row.subcategory) errors.subcategory_id = "Subcategory is required";

  return errors;
}

function validateVendorProductRow(row = {}) {
  return Object.values(buildVendorProductFieldErrors(row));
}

module.exports = {
  validateVendorPayload,
  normalizeVendorProductRow,
  validateVendorProductRow,
  buildVendorProductFieldErrors,
  slugify,
};
const { getPasswordPolicyError } = require("./passwordPolicy");
