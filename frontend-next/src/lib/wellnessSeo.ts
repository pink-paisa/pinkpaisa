import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode, ProductSubcategoryNode } from "@/hooks/useProductTaxonomy";

export type WellnessFaq = {
  question: string;
  answer: string;
};

export type WellnessBestForSection = {
  title: string;
  description: string;
  productMatch: (product: CatalogProduct) => boolean;
};

export type WellnessPageConfig = {
  key: string;
  path: string;
  label: string;
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  h1: string;
  intro: string;
  categorySlug?: string;
  subcategorySlug?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  fallbackSearch: string;
  concerns: string[];
  bestForSections: WellnessBestForSection[];
  howToChoose: string[];
  faqs: WellnessFaq[];
  source: "taxonomy" | "instagram";
};

export const WELLNESS_HUB_PATH = "/wellness";
export const WELLNESS_INSTAGRAM_PICKS_PATH = `${WELLNESS_HUB_PATH}/instagram-picks`;

export const WELLNESS_HUB_SEO = {
  title: "Pink Paisa Wellness Finds",
  description:
    "Explore curated wellness affiliate finds across active Pink Paisa categories, Instagram picks, and product collections.",
  h1: "Pink Paisa Wellness finds for smarter self-care shopping",
  intro:
    "Start with curated product edits, compare the use case, then check the latest price and details on Amazon from each product page.",
};

const STOP_WORDS = new Set(["and", "the", "for", "with", "care", "self"]);

const includesAny = (product: CatalogProduct, values: string[]) => {
  const haystack = [
    product.title,
    product.short_description,
    product.full_description,
    product.buying_intent,
    product.category,
    product.subcategory,
    ...(product.tags || []),
    ...(product.pros || []),
    ...(product.cons || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return values.some((value) => haystack.includes(value.toLowerCase()));
};

const titleCase = (value = "") =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const normalizeText = (value?: string | null) => String(value || "").trim();

const textFromSlug = (slug = "") => titleCase(slug.replace(/-/g, " "));

export const slugifyWellnessSegment = (value = "") =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const getWellnessPathFromLabels = (...values: Array<string | null | undefined>) => {
  const slug = values.map((value) => slugifyWellnessSegment(String(value || ""))).find(Boolean);
  return slug ? `${WELLNESS_HUB_PATH}/${slug}` : WELLNESS_HUB_PATH;
};

const buildSearchTerms = (...values: Array<string | null | undefined>) => {
  const words = values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return Array.from(new Set(words)).slice(0, 8);
};

const buildConcerns = (label: string, categoryName?: string | null) => {
  const terms = buildSearchTerms(label, categoryName);
  return Array.from(new Set([
    label,
    ...terms.map(titleCase),
    "Everyday routine",
    "Amazon details",
  ])).slice(0, 6);
};

const buildBestForSections = (label: string, terms: string[]): WellnessBestForSection[] => [
  {
    title: `${label} routine picks`,
    description: `Products that fit a simple ${label.toLowerCase()} routine or repeat-use buying intent.`,
    productMatch: (product) => includesAny(product, ["routine", "daily", "everyday", ...terms]),
  },
  {
    title: "Concern-focused picks",
    description: "Options with product notes, pros, or campaign labels that point to a specific buyer concern.",
    productMatch: (product) => includesAny(product, ["fall", "dandruff", "dry", "frizz", "dark", "spot", "acne", "repair", "natural", "hydrating", ...terms]),
  },
  {
    title: "Featured Pink Paisa picks",
    description: "Products marked for stronger visibility or Instagram-led discovery.",
    productMatch: (product) => Boolean(product.is_featured_affiliate || product.affiliate_is_instagram_pick),
  },
];

const genericHowToChoose = [
  "Match the product to the buyer concern before opening Amazon.",
  "Read the Pink Paisa product notes, pros, and considerations first.",
  "Confirm current price, seller, reviews, size, delivery, and availability directly on Amazon before buying.",
  "For skincare, haircare, or wellness concerns, follow brand directions and consult a qualified professional when needed.",
];

const buildFaqs = (label: string): WellnessFaq[] => [
  {
    question: `Are these ${label.toLowerCase()} products sold by Pink Paisa?`,
    answer:
      "No. These are curated Amazon affiliate finds. Pink Paisa may earn from qualifying purchases when buyers use product links.",
  },
  {
    question: "Why does Pink Paisa send buyers to Amazon for price details?",
    answer:
      "Amazon prices, availability, sellers, ratings, reviews, and shipping can change. Pink Paisa keeps manual affiliate pages price-safe and asks buyers to confirm final details on Amazon.",
  },
];

export function buildTaxonomyWellnessConfig(category: ProductCategoryNode, subcategory: ProductSubcategoryNode): WellnessPageConfig {
  const label = normalizeText(subcategory.name) || textFromSlug(subcategory.slug);
  const categoryName = normalizeText(category.name);
  const terms = buildSearchTerms(label, categoryName, subcategory.description);
  const seoTitle = normalizeText(subcategory.seo_meta_title) || `${label} Finds | Pink Paisa Wellness`;
  const seoDescription =
    normalizeText(subcategory.seo_meta_description) ||
    normalizeText(subcategory.description) ||
    `Explore curated ${label.toLowerCase()} affiliate picks from Pink Paisa Wellness. Compare the product notes, then check current details on Amazon.`;

  return {
    key: subcategory.slug,
    path: `${WELLNESS_HUB_PATH}/${subcategory.slug}`,
    label,
    seoTitle,
    seoDescription,
    eyebrow: categoryName || "Pink Paisa Wellness",
    h1: `${label} wellness finds`,
    intro:
      normalizeText(subcategory.description) ||
      `A curated Pink Paisa edit for ${label.toLowerCase()} shoppers. Compare use cases before checking current Amazon details.`,
    categorySlug: category.slug,
    subcategorySlug: subcategory.slug,
    categoryId: category.id || category._id || null,
    subcategoryId: subcategory.id || subcategory._id || null,
    fallbackSearch: terms.join(" ") || label,
    concerns: buildConcerns(label, categoryName),
    bestForSections: buildBestForSections(label, terms),
    howToChoose: genericHowToChoose,
    faqs: buildFaqs(label),
    source: "taxonomy",
  };
}

export function buildInstagramWellnessConfig(): WellnessPageConfig {
  const label = "Instagram Picks";
  return {
    key: "instagram-picks",
    path: WELLNESS_INSTAGRAM_PICKS_PATH,
    label,
    seoTitle: "Instagram Wellness Picks | Pink Paisa Wellness",
    seoDescription:
      "Shop Pink Paisa Wellness finds featured for Instagram reels, stories, and campaign collections. Open each pick for context before checking Amazon.",
    eyebrow: "Pink Paisa Finds",
    h1: "Instagram wellness picks",
    intro:
      "A mobile-first edit of Pink Paisa affiliate finds selected for reels, stories, and campaign collections.",
    fallbackSearch: "wellness beauty skincare haircare",
    concerns: ["Reel finds", "Story picks", "Trending care", "Beauty edits", "Routine products"],
    bestForSections: [
      {
        title: "Featured Instagram finds",
        description: "Products marked by admin for Instagram campaigns and fast mobile browsing.",
        productMatch: (product) => Boolean(product.affiliate_is_instagram_pick || product.is_featured_affiliate),
      },
    ],
    howToChoose: genericHowToChoose,
    faqs: buildFaqs(label),
    source: "instagram",
  };
}

export function buildWellnessConfigsFromTaxonomy(categories: ProductCategoryNode[] = []) {
  const taxonomyConfigs = categories.filter((category) => category.is_active && !category.is_system && category.slug !== "uncategorized").flatMap((category) =>
    (category.subcategories || [])
      .filter((subcategory) => subcategory.is_active && !subcategory.is_system && subcategory.slug !== "uncategorized")
      .map((subcategory) => buildTaxonomyWellnessConfig(category, subcategory)),
  );

  return [...taxonomyConfigs, buildInstagramWellnessConfig()];
}

export function pickSectionProducts(products: CatalogProduct[], section: WellnessBestForSection) {
  const matches = products.filter(section.productMatch);
  return matches.length ? matches.slice(0, 4) : products.slice(0, 4);
}
