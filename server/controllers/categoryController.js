const Product = require("../models/Product");
const VendorProduct = require("../models/VendorProduct");
const ProductCategory = require("../models/ProductCategory");
const ProductSubcategory = require("../models/ProductSubcategory");
const {
  ensureUniqueCategorySlug,
  ensureUniqueSubcategorySlug,
  getUncategorizedRefs,
  getCategoryTree,
} = require("../utils/taxonomy");

const toId = (doc) => ({ ...doc, id: String(doc._id) });

async function reassignProductsToUncategorized({ categoryId = null, subcategoryId = null }) {
  const uncategorized = await getUncategorizedRefs();
  const update = {
    category_id: uncategorized.category._id,
    subcategory_id: uncategorized.subcategory._id,
    category: uncategorized.category.name,
    subcategory: uncategorized.subcategory.name,
    is_visible: false,
  };
  const query = categoryId ? { category_id: categoryId } : { subcategory_id: subcategoryId };
  await Promise.all([
    Product.updateMany(query, update),
    VendorProduct.updateMany(query, update),
  ]);
}

const listCategoryTree = async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const includeUncategorized = req.query.include_uncategorized === "true" || Boolean(req.user?.role === "admin");
    const tree = await getCategoryTree({ includeInactive, includeUncategorized });
    res.json(tree);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCategoryAdminSummary = async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const includeUncategorized = req.query.include_uncategorized === "true" || Boolean(req.user?.role === "admin");
    const [tree, productCounts, visibleCounts, vendorCounts, subcategoryProductCounts, subcategoryVisibleCounts, subcategoryVendorCounts] = await Promise.all([
      getCategoryTree({ includeInactive, includeUncategorized }),
      Product.aggregate([{ $group: { _id: "$category_id", count: { $sum: 1 } } }]),
      Product.aggregate([{ $match: { is_visible: true } }, { $group: { _id: "$category_id", count: { $sum: 1 } } }]),
      VendorProduct.aggregate([{ $group: { _id: "$category_id", count: { $sum: 1 } } }]),
      Product.aggregate([{ $group: { _id: "$subcategory_id", count: { $sum: 1 } } }]),
      Product.aggregate([{ $match: { is_visible: true } }, { $group: { _id: "$subcategory_id", count: { $sum: 1 } } }]),
      VendorProduct.aggregate([{ $group: { _id: "$subcategory_id", count: { $sum: 1 } } }]),
    ]);

    const categoryProductMap = new Map(productCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));
    const categoryVisibleMap = new Map(visibleCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));
    const categoryVendorMap = new Map(vendorCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));
    const subcategoryProductMap = new Map(subcategoryProductCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));
    const subcategoryVisibleMap = new Map(subcategoryVisibleCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));
    const subcategoryVendorMap = new Map(subcategoryVendorCounts.map((entry) => [String(entry._id), Number(entry.count || 0)]));

    res.json(tree.map((category) => ({
      ...category,
      product_count: categoryProductMap.get(String(category._id || category.id)) || 0,
      visible_count: categoryVisibleMap.get(String(category._id || category.id)) || 0,
      vendor_count: categoryVendorMap.get(String(category._id || category.id)) || 0,
      subcategories: (category.subcategories || []).map((subcategory) => ({
        ...subcategory,
        product_count: subcategoryProductMap.get(String(subcategory._id || subcategory.id)) || 0,
        visible_count: subcategoryVisibleMap.get(String(subcategory._id || subcategory.id)) || 0,
        vendor_count: subcategoryVendorMap.get(String(subcategory._id || subcategory.id)) || 0,
      })),
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createCategory = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Category name is required" });
    const existing = await ProductCategory.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();
    if (existing) return res.status(409).json({ message: "Category already exists" });
    const category = await ProductCategory.create({
      name,
      slug: await ensureUniqueCategorySlug(name),
      description: req.body.description ? String(req.body.description).trim() : null,
      icon: req.body.icon ? String(req.body.icon).trim() : null,
      image_url: req.body.image_url ? String(req.body.image_url).trim() : null,
      seo_meta_title: req.body.seo_meta_title ? String(req.body.seo_meta_title).trim() : null,
      seo_meta_description: req.body.seo_meta_description ? String(req.body.seo_meta_description).trim() : null,
      is_active: req.body.is_active !== false,
      sort_order: Number(req.body.sort_order) || 0,
    });
    res.status(201).json(toId(category.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const category = await ProductCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    if (category.is_system) return res.status(400).json({ message: "System category cannot be edited" });

    const previousName = category.name;
    if (req.body.name != null) {
      const nextName = String(req.body.name).trim();
      if (!nextName) return res.status(400).json({ message: "Category name is required" });
      category.name = nextName;
      category.slug = await ensureUniqueCategorySlug(nextName, category._id);
    }
    if (req.body.description != null) category.description = String(req.body.description || "").trim() || null;
    if (req.body.icon != null) category.icon = String(req.body.icon || "").trim() || null;
    if (req.body.image_url != null) category.image_url = String(req.body.image_url || "").trim() || null;
    if (req.body.seo_meta_title != null) category.seo_meta_title = String(req.body.seo_meta_title || "").trim() || null;
    if (req.body.seo_meta_description != null) category.seo_meta_description = String(req.body.seo_meta_description || "").trim() || null;
    if (req.body.is_active != null) category.is_active = Boolean(req.body.is_active);
    if (req.body.sort_order != null) category.sort_order = Number(req.body.sort_order) || 0;
    await category.save();

    if (previousName !== category.name) {
      await Promise.all([
        Product.updateMany({ category_id: category._id }, { category: category.name }),
        VendorProduct.updateMany({ category_id: category._id }, { category: category.name }),
      ]);
    }

    res.json(toId(category.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const category = await ProductCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    if (category.is_system) return res.status(400).json({ message: "System category cannot be deleted" });

    const productCount = await Product.countDocuments({ category_id: category._id });
    if (productCount > 0 && req.query.force !== "true") {
      return res.status(409).json({
        message: `${productCount} products use this category. Pass ?force=true to reassign them to Uncategorized.`,
        product_count: productCount,
      });
    }
    const subcategories = await ProductSubcategory.find({ category_id: category._id }).lean();
    await reassignProductsToUncategorized({ categoryId: category._id });
    await ProductSubcategory.deleteMany({ category_id: category._id });
    await ProductCategory.deleteOne({ _id: category._id });

    res.json({ message: "Category deleted", affected_subcategories: subcategories.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createSubcategory = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const categoryId = req.body.category_id;
    if (!name || !categoryId) return res.status(400).json({ message: "Category and subcategory name are required" });

    const category = await ProductCategory.findById(categoryId);
    if (!category) return res.status(404).json({ message: "Parent category not found" });

    const existing = await ProductSubcategory.findOne({ category_id: category._id, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();
    if (existing) return res.status(409).json({ message: "Subcategory already exists in this category" });

    const subcategory = await ProductSubcategory.create({
      category_id: category._id,
      name,
      slug: await ensureUniqueSubcategorySlug(category._id, name),
      description: req.body.description ? String(req.body.description).trim() : null,
      icon: req.body.icon ? String(req.body.icon).trim() : null,
      image_url: req.body.image_url ? String(req.body.image_url).trim() : null,
      seo_meta_title: req.body.seo_meta_title ? String(req.body.seo_meta_title).trim() : null,
      seo_meta_description: req.body.seo_meta_description ? String(req.body.seo_meta_description).trim() : null,
      is_active: req.body.is_active !== false,
      sort_order: Number(req.body.sort_order) || 0,
    });

    res.status(201).json({ ...toId(subcategory.toObject()), category_id: String(subcategory.category_id) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateSubcategory = async (req, res) => {
  try {
    const subcategory = await ProductSubcategory.findById(req.params.id);
    if (!subcategory) return res.status(404).json({ message: "Subcategory not found" });
    if (subcategory.is_system) return res.status(400).json({ message: "System subcategory cannot be edited" });

    const previousName = subcategory.name;
    let nextCategoryId = String(subcategory.category_id);

    if (req.body.category_id) {
      if (String(req.body.category_id) !== String(subcategory.category_id) && req.query.move_products !== "true") {
        return res.status(409).json({ message: "Changing a subcategory's parent category requires ?move_products=true because it moves all linked products." });
      }
      const category = await ProductCategory.findById(req.body.category_id);
      if (!category) return res.status(404).json({ message: "Parent category not found" });
      subcategory.category_id = category._id;
      nextCategoryId = String(category._id);
    }
    if (req.body.name != null) {
      const nextName = String(req.body.name).trim();
      if (!nextName) return res.status(400).json({ message: "Subcategory name is required" });
      subcategory.name = nextName;
    }
    if (req.body.description != null) subcategory.description = String(req.body.description || "").trim() || null;
    if (req.body.icon != null) subcategory.icon = String(req.body.icon || "").trim() || null;
    if (req.body.image_url != null) subcategory.image_url = String(req.body.image_url || "").trim() || null;
    if (req.body.seo_meta_title != null) subcategory.seo_meta_title = String(req.body.seo_meta_title || "").trim() || null;
    if (req.body.seo_meta_description != null) subcategory.seo_meta_description = String(req.body.seo_meta_description || "").trim() || null;
    subcategory.slug = await ensureUniqueSubcategorySlug(nextCategoryId, subcategory.name, subcategory._id);
    if (req.body.is_active != null) subcategory.is_active = Boolean(req.body.is_active);
    if (req.body.sort_order != null) subcategory.sort_order = Number(req.body.sort_order) || 0;
    await subcategory.save();

    const parentCategory = await ProductCategory.findById(subcategory.category_id).lean();
    await Promise.all([
      Product.updateMany({ subcategory_id: subcategory._id }, { category_id: subcategory.category_id, category: parentCategory?.name || null, subcategory: subcategory.name }),
      VendorProduct.updateMany({ subcategory_id: subcategory._id }, { category_id: subcategory.category_id, category: parentCategory?.name || null, subcategory: subcategory.name }),
    ]);

    res.json({ ...toId(subcategory.toObject()), category_id: String(subcategory.category_id), renamed_from: previousName });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteSubcategory = async (req, res) => {
  try {
    const subcategory = await ProductSubcategory.findById(req.params.id);
    if (!subcategory) return res.status(404).json({ message: "Subcategory not found" });
    if (subcategory.is_system) return res.status(400).json({ message: "System subcategory cannot be deleted" });

    const productCount = await Product.countDocuments({ subcategory_id: subcategory._id });
    if (productCount > 0 && req.query.force !== "true") {
      return res.status(409).json({
        message: `${productCount} products use this subcategory. Pass ?force=true to reassign them to Uncategorized.`,
        product_count: productCount,
      });
    }
    await reassignProductsToUncategorized({ subcategoryId: subcategory._id });
    await ProductSubcategory.deleteOne({ _id: subcategory._id });

    res.json({ message: "Subcategory deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listCategoryTree,
  getCategoryAdminSummary,
  createCategory,
  updateCategory,
  deleteCategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
