const ProductCategory = require("../models/ProductCategory");
const ProductSubcategory = require("../models/ProductSubcategory");
const { getUncategorizedRefs, ensureUniqueCategorySlug, ensureUniqueSubcategorySlug } = require("./taxonomy");

const DEFAULT_TREE = [
  {
    name: "Shop By Concern",
    subcategories: ["Acne & Pigmentation", "Hairfall & Thinning", "Ageing Skin", "Weight Management", "PCOS/PCOD", "Calm & Sleep", "Dehydration", "Gut Health"],
  },
  {
    name: "Daily Nutrition",
    subcategories: ["Multivitamins", "Prebiotics & Probiotics", "Omega 3 & Fish Oil", "Calcium & Vitamin D", "Immunity Boosters & Vitamin C", "Eye Care (Lutein)", "Other Daily Supplements"],
  },
  {
    name: "Fitness & Recovery",
    subcategories: ["Whey Protein", "Plant Protein", "Creatine", "BCAA & Other Muscle Support", "Electrolytes (Hydration)", "Protein Bars & Snacks", "Pain Relief", "Fitness Equipments", "Supports & Braces", "Health Drinks", "Health Foods", "Sugar Substitutes"],
  },
  {
    name: "Herbal & Ayurvedic",
    subcategories: ["Amla", "Ashwagandha", "Shilajit", "Aloe Vera", "Chyavanprash", "Giloy & Guduchi", "Tulsi", "Wheatgrass", "Spirulina & Moringa", "Neem"],
  },
  {
    name: "Women's Health",
    subcategories: ["Hormonal Care", "Prenatal & Post Natal Care", "Period Care", "For Moms"],
  },
  {
    name: "Health & Wellness Kits & Combos",
    subcategories: ["Health & Wellness Kits", "Health & Wellness Combos"],
  },
];

async function seedCategoryTree() {
  await getUncategorizedRefs();
  const count = await ProductCategory.countDocuments({ slug: { $ne: "uncategorized" } });
  if (count > 0) return;

  for (let i = 0; i < DEFAULT_TREE.length; i += 1) {
    const categoryData = DEFAULT_TREE[i];
    const category = await ProductCategory.create({
      name: categoryData.name,
      slug: await ensureUniqueCategorySlug(categoryData.name),
      sort_order: i,
      is_active: true,
    });

    for (let j = 0; j < categoryData.subcategories.length; j += 1) {
      const name = categoryData.subcategories[j];
      await ProductSubcategory.create({
        category_id: category._id,
        name,
        slug: await ensureUniqueSubcategorySlug(category._id, name),
        sort_order: j,
        is_active: true,
      });
    }
  }
}

module.exports = { seedCategoryTree };
