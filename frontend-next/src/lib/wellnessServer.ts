import type { CatalogProduct, CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode } from "@/hooks/useProductTaxonomy";
import { serverFetch } from "@/lib/server-api";
import { buildWellnessConfigsFromTaxonomy, type WellnessPageConfig } from "@/lib/wellnessSeo";

const PRODUCT_LIMIT = 24;

function dedupeProducts(products: CatalogProduct[]) {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = product.id || product.slug;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCatalogProducts(path: string) {
  const response = await serverFetch<CatalogProductsResponse>(path).catch(() => null);
  return response?.items ?? [];
}

export async function fetchWellnessCollections() {
  const taxonomy = await serverFetch<ProductCategoryNode[]>("/categories/tree").catch(() => []);
  return buildWellnessConfigsFromTaxonomy(taxonomy);
}

export async function fetchWellnessCollectionBySlug(slug: string) {
  const collections = await fetchWellnessCollections();
  return {
    collections,
    config: collections.find((collection) => collection.key === slug || collection.path === `/wellness/${slug}`) || null,
  };
}

export async function fetchWellnessCategoryProducts(config: WellnessPageConfig) {
  const attempts: string[] = [];

  if (config.key === "instagram-picks") {
    attempts.push(`/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&_page=1&_limit=${PRODUCT_LIMIT}`);
    attempts.push(`/products?include_meta=true&is_affiliate=true&featured=true&_page=1&_limit=${PRODUCT_LIMIT}`);
  }

  if (config.categorySlug || config.subcategorySlug) {
    const params = new URLSearchParams();
    params.set("include_meta", "true");
    params.set("is_affiliate", "true");
    params.set("_page", "1");
    params.set("_limit", String(PRODUCT_LIMIT));
    if (config.categorySlug) params.set("category_slug", config.categorySlug);
    if (config.subcategorySlug) params.set("subcategory_slug", config.subcategorySlug);
    attempts.push(`/products?${params.toString()}`);
  }

  if (config.fallbackSearch) {
    const params = new URLSearchParams();
    params.set("include_meta", "true");
    params.set("is_affiliate", "true");
    params.set("search", config.fallbackSearch);
    params.set("_page", "1");
    params.set("_limit", String(PRODUCT_LIMIT));
    attempts.push(`/products?${params.toString()}`);
  }

  attempts.push(`/products?include_meta=true&is_affiliate=true&_page=1&_limit=${PRODUCT_LIMIT}`);

  for (const attempt of attempts) {
    const products = await fetchCatalogProducts(attempt);
    if (products.length) return dedupeProducts(products);
  }

  return [];
}

export async function fetchWellnessHubProducts() {
  const [instagramPicks, featured, recent] = await Promise.all([
    fetchCatalogProducts(`/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&_page=1&_limit=8`),
    fetchCatalogProducts(`/products?include_meta=true&is_affiliate=true&featured=true&_page=1&_limit=8`),
    fetchCatalogProducts(`/products?include_meta=true&is_affiliate=true&sort=newest&_page=1&_limit=8`),
  ]);

  return dedupeProducts([...instagramPicks, ...featured, ...recent]).slice(0, 24);
}

export async function fetchIndexableWellnessCollections() {
  const collections = await fetchWellnessCollections();
  const products = await fetchCatalogProducts("/products?include_meta=true&is_affiliate=true&_page=1&_limit=5000");
  const subcategoryIds = new Set(products.map((product) => product.subcategory_id).filter(Boolean));
  const hasInstagramProducts = products.some((product) => product.affiliate_is_instagram_pick || product.is_featured_affiliate);

  return collections.filter((collection) => {
    if (collection.source === "instagram") return hasInstagramProducts;
    return Boolean(collection.subcategoryId && subcategoryIds.has(collection.subcategoryId));
  });
}
