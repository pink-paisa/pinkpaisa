const ProductCategory = require("../models/ProductCategory");
const ProductSubcategory = require("../models/ProductSubcategory");

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueCategorySlug(baseSlug, excludeId = null) {
  const safeBase = slugify(baseSlug || "category") || "category";
  let candidate = safeBase;
  let counter = 2;
  while (true) {
    const existing = await ProductCategory.findOne({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (!existing) return candidate;
    candidate = `${safeBase}-${counter}`;
    counter += 1;
  }
}

async function ensureUniqueSubcategorySlug(categoryId, baseSlug, excludeId = null) {
  const safeBase = slugify(baseSlug || "subcategory") || "subcategory";
  let candidate = safeBase;
  let counter = 2;
  while (true) {
    const existing = await ProductSubcategory.findOne({ category_id: categoryId, slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (!existing) return candidate;
    candidate = `${safeBase}-${counter}`;
    counter += 1;
  }
}

async function getUncategorizedRefs() {
  let category = await ProductCategory.findOne({ slug: "uncategorized" });
  if (!category) {
    category = await ProductCategory.create({ name: "Uncategorized", slug: "uncategorized", is_active: false, is_system: true, sort_order: 9999 });
  }

  let subcategory = await ProductSubcategory.findOne({ category_id: category._id, slug: "uncategorized" });
  if (!subcategory) {
    subcategory = await ProductSubcategory.create({ category_id: category._id, name: "Uncategorized", slug: "uncategorized", is_active: false, is_system: true, sort_order: 9999 });
  }

  return { category, subcategory };
}

async function resolveTaxonomySelection({ category_id, subcategory_id, category, subcategory, allowUncategorized = false }) {
  const uncategorized = await getUncategorizedRefs();

  let resolvedCategory = null;
  let resolvedSubcategory = null;

  if (category_id) {
    resolvedCategory = await ProductCategory.findById(category_id);
  } else if (category) {
    resolvedCategory = await ProductCategory.findOne({ name: new RegExp(`^${String(category).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  }

  if (subcategory_id) {
    resolvedSubcategory = await ProductSubcategory.findById(subcategory_id);
  }

  if (!resolvedCategory && !allowUncategorized) {
    throw new Error("Valid category is required");
  }

  if (!resolvedCategory && allowUncategorized) {
    return { categoryDoc: uncategorized.category, subcategoryDoc: uncategorized.subcategory, isUncategorized: true };
  }

  if (!resolvedSubcategory && subcategory) {
    resolvedSubcategory = await ProductSubcategory.findOne({
      category_id: resolvedCategory._id,
      name: new RegExp(`^${String(subcategory).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
  }

  if (!resolvedSubcategory || String(resolvedSubcategory.category_id) !== String(resolvedCategory._id)) {
    if (allowUncategorized) {
      return { categoryDoc: uncategorized.category, subcategoryDoc: uncategorized.subcategory, isUncategorized: true };
    }
    throw new Error("Valid subcategory is required for the selected category");
  }

  const isUncategorized = String(resolvedCategory._id) === String(uncategorized.category._id) || String(resolvedSubcategory._id) === String(uncategorized.subcategory._id);
  return { categoryDoc: resolvedCategory, subcategoryDoc: resolvedSubcategory, isUncategorized };
}

async function getCategoryTree({ includeInactive = false, includeUncategorized = true } = {}) {
  const categoryQuery = includeInactive ? {} : { is_active: true };
  const categories = await ProductCategory.find(categoryQuery).sort({ sort_order: 1, name: 1 }).lean();
  const subcategories = await ProductSubcategory.find(includeInactive ? {} : { is_active: true }).sort({ sort_order: 1, name: 1 }).lean();

  const grouped = new Map();
  for (const category of categories) {
    if (!includeUncategorized && category.slug === "uncategorized") continue;
    grouped.set(String(category._id), { ...category, id: String(category._id), subcategories: [] });
  }

  for (const subcategory of subcategories) {
    const categoryId = String(subcategory.category_id);
    const entry = grouped.get(categoryId);
    if (!entry) continue;
    if (!includeUncategorized && subcategory.slug === "uncategorized") continue;
    entry.subcategories.push({ ...subcategory, id: String(subcategory._id), category_id: categoryId });
  }

  return Array.from(grouped.values());
}

module.exports = {
  slugify,
  ensureUniqueCategorySlug,
  ensureUniqueSubcategorySlug,
  getUncategorizedRefs,
  resolveTaxonomySelection,
  getCategoryTree,
};
