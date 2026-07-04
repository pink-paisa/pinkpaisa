const Product = require("../models/Product");
const Vendor = require("../models/Vendor");

function parseWeight(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]+/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function slugify(value = "") {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniquePublicSlug(baseSlug, excludeId = null) {
  const safeBase = String(baseSlug || "product").trim() || "product";
  let candidate = safeBase;
  let counter = 2;
  while (true) {
    const existing = await Product.findOne({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (!existing) return candidate;
    candidate = `${safeBase}-${counter}`;
    counter += 1;
  }
}

async function buildStableVendorPublicSlug(vendorProduct, excludeId = null) {
  const vendor = await Vendor.findById(vendorProduct.vendor_id).select("shop_name business_name owner_name").lean();
  const vendorLabel = vendor?.shop_name || vendor?.business_name || vendor?.owner_name || "vendor";
  const vendorSlug = slugify(vendorLabel) || "vendor";
  const productSlug = slugify(vendorProduct.slug || vendorProduct.title || "product") || "product";
  return ensureUniquePublicSlug(`${vendorSlug}-${productSlug}`, excludeId);
}

async function publishVendorProduct(vendorProduct) {
  const isVisible = Boolean(vendorProduct.is_visible) && vendorProduct.category !== "Uncategorized" && vendorProduct.subcategory !== "Uncategorized";
  let existing = null;
  if (vendorProduct.published_product_id) existing = await Product.findById(vendorProduct.published_product_id);
  if (!existing) existing = await Product.findOne({ vendor_product_id: vendorProduct._id });
  const slug = await buildStableVendorPublicSlug(vendorProduct, existing?._id || null);
  const legacyImages = [vendorProduct.featured_image, ...(vendorProduct.additional_images || [])].filter(Boolean);
  const imageItems = legacyImages.map((url, index) => ({ url, alt: null, position: index }));
  const effectivePrice = vendorProduct.sale_price != null ? Number(vendorProduct.sale_price) : Number(vendorProduct.price || 0);

  const productData = {
    title: vendorProduct.title,
    short_description: vendorProduct.short_description,
    full_description: vendorProduct.full_description,
    category_id: vendorProduct.category_id || null,
    subcategory_id: vendorProduct.subcategory_id || null,
    category: vendorProduct.category || "Uncategorized",
    subcategory: vendorProduct.subcategory || "Uncategorized",
    images: legacyImages,
    image_items: imageItems,
    featured_image: vendorProduct.featured_image,
    price: vendorProduct.price,
    sale_price: vendorProduct.sale_price,
    effective_price: effectivePrice,
    mrp: vendorProduct.mrp ?? null,
    gst_rate_percent: Number(vendorProduct.gst_rate_percent || 0),
    hsn_code: vendorProduct.hsn_code || null,
    brand_name: vendorProduct.brand_name || null,
    country_of_origin: vendorProduct.country_of_origin || "India",
    sku: vendorProduct.sku,
    stock_quantity: vendorProduct.stock_quantity,
    tags: vendorProduct.tags || [],
    weight: parseWeight(vendorProduct.weight),
    dimensions: vendorProduct.dimensions,
    seo_meta_title: vendorProduct.seo_meta_title || null,
    seo_meta_description: vendorProduct.seo_meta_description || null,
    seo_keywords: vendorProduct.seo_keywords || [],
    attributes: vendorProduct.attributes || {},
    status: isVisible ? (vendorProduct.status === "inactive" ? "inactive" : "active") : "draft",
    is_visible: isVisible,
    returnable: vendorProduct.returnable !== false,
    return_window_days: Number(vendorProduct.return_window_days || 7),
    return_liability: vendorProduct.return_liability || "vendor",
    featured: existing?.featured || false,
    bestseller: existing?.bestseller || false,
    sort_order: vendorProduct.sort_order || 0,
    source_type: "vendor",
    vendor_id: vendorProduct.vendor_id,
    vendor_product_id: vendorProduct._id,
  };

  if (existing) {
    Object.assign(existing, productData, { slug });
    await existing.save();
    return existing;
  }
  return Product.create({ ...productData, slug });
}

async function unpublishVendorProduct(vendorProductId) {
  if (!vendorProductId) return;
  await Product.updateMany(
    { vendor_product_id: vendorProductId, source_type: "vendor" },
    { is_visible: false, status: "draft" }
  );
}

module.exports = { publishVendorProduct, unpublishVendorProduct };
