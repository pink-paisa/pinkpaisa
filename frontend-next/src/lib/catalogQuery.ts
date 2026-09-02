import type { ParsedUrlQuery } from "querystring";

export const CATALOG_PAGE_SIZE = 24;
export const DEFAULT_SORT = "popular";

export const SORT_OPTIONS = [
  { value: "popular", label: "Most popular" },
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
] as const;

export type CatalogFilterState = {
  search: string;
  categorySlug: string;
  subcategorySlug: string;
  sort: string;
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  onSale: boolean;
  brands: string[];
  page: number;
};

type QueryValue = string | string[] | undefined;

const firstValue = (value: QueryValue, fallback = "") =>
  (Array.isArray(value) ? value[0] : value) || fallback;

const numberValue = (value: QueryValue) => {
  const normalized = firstValue(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const listValue = (value: QueryValue) =>
  firstValue(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Single source of truth for reading the catalog filter state off the URL, used
 * by both `getServerSideProps` and the client page so the two cannot drift.
 */
export const parseCatalogQuery = (query: ParsedUrlQuery): CatalogFilterState => ({
  search: firstValue(query.search),
  categorySlug: firstValue(query.category, "all"),
  subcategorySlug: firstValue(query.subcategory, "all"),
  sort: firstValue(query.sort, DEFAULT_SORT),
  minPrice: numberValue(query.min_price),
  maxPrice: numberValue(query.max_price),
  inStock: firstValue(query.in_stock) === "true",
  onSale: firstValue(query.on_sale) === "true",
  brands: listValue(query.brand),
  page: Math.max(Number(firstValue(query.page, "1")) || 1, 1),
});

/** Query string for the public `/products` API. */
export const buildCatalogApiParams = (state: CatalogFilterState) => {
  const params = new URLSearchParams();
  params.set("include_meta", "true");
  params.set("_page", String(state.page));
  params.set("_limit", String(CATALOG_PAGE_SIZE));
  if (state.search) params.set("search", state.search);
  if (state.categorySlug !== "all") params.set("category_slug", state.categorySlug);
  if (state.subcategorySlug !== "all") params.set("subcategory_slug", state.subcategorySlug);
  if (state.sort && state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.minPrice != null) params.set("min_price", String(state.minPrice));
  if (state.maxPrice != null) params.set("max_price", String(state.maxPrice));
  if (state.inStock) params.set("in_stock", "true");
  if (state.onSale) params.set("on_sale", "true");
  if (state.brands.length) params.set("brand", state.brands.join(","));
  return params;
};

/** Canonical `/products?...` path for SEO, omitting defaults. */
export const buildCatalogCanonicalPath = (state: CatalogFilterState) => {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.categorySlug !== "all") params.set("category", state.categorySlug);
  if (state.subcategorySlug !== "all") params.set("subcategory", state.subcategorySlug);
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.minPrice != null) params.set("min_price", String(state.minPrice));
  if (state.maxPrice != null) params.set("max_price", String(state.maxPrice));
  if (state.inStock) params.set("in_stock", "true");
  if (state.onSale) params.set("on_sale", "true");
  if (state.brands.length) params.set("brand", state.brands.join(","));
  const query = params.toString();
  return `/products${query ? `?${query}` : ""}`;
};

/** Filters the shopper actively applied — drives the "Clear (n)" affordance. */
export const activeFilterCount = (state: CatalogFilterState) =>
  (state.search ? 1 : 0) +
  (state.categorySlug !== "all" ? 1 : 0) +
  (state.subcategorySlug !== "all" ? 1 : 0) +
  (state.minPrice != null ? 1 : 0) +
  (state.maxPrice != null ? 1 : 0) +
  (state.inStock ? 1 : 0) +
  (state.onSale ? 1 : 0) +
  state.brands.length;

export const hasActiveFilters = (state: CatalogFilterState) =>
  activeFilterCount(state) > 0 || state.sort !== DEFAULT_SORT;

export const formatCatalogPrice = (value: number) => `₹${value.toLocaleString("en-IN")}`;
