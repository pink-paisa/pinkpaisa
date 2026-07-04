import type { GetServerSideProps } from "next";
import PhysicalProductsPage from "@/pages/PhysicalProducts";
import SeoHead from "@/components/SeoHead";
import { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { serverFetch } from "@/lib/server-api";

type ProductsPageProps = {
  initialCatalogResponse?: CatalogProductsResponse;
  searchTerm: string;
  categorySlug: string;
  subcategorySlug: string;
  sort: string;
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  onSale: boolean;
  brands: string[];
};

export const getServerSideProps: GetServerSideProps<ProductsPageProps> = async ({ query }) => {
  const params = new URLSearchParams();
  params.set("include_meta", "true");
  params.set("_page", String(query.page || 1));
  params.set("_limit", "24");

  const searchTerm = typeof query.search === "string" ? query.search : "";
  const categorySlug = typeof query.category === "string" ? query.category : "all";
  const subcategorySlug = typeof query.subcategory === "string" ? query.subcategory : "all";
  const sort = typeof query.sort === "string" ? query.sort : "popular";
  const minPrice = typeof query.min_price === "string" ? Number(query.min_price) : null;
  const maxPrice = typeof query.max_price === "string" ? Number(query.max_price) : null;
  const inStock = query.in_stock === "true";
  const onSale = query.on_sale === "true";
  const brands = typeof query.brand === "string" ? query.brand.split(",").map((value) => value.trim()).filter(Boolean) : [];

  if (searchTerm) params.set("search", searchTerm);
  if (categorySlug !== "all") params.set("category_slug", categorySlug);
  if (subcategorySlug !== "all") params.set("subcategory_slug", subcategorySlug);
  if (sort && sort !== "popular") params.set("sort", sort);
  if (minPrice != null && Number.isFinite(minPrice)) params.set("min_price", String(minPrice));
  if (maxPrice != null && Number.isFinite(maxPrice)) params.set("max_price", String(maxPrice));
  if (inStock) params.set("in_stock", "true");
  if (onSale) params.set("on_sale", "true");
  if (brands.length) params.set("brand", brands.join(","));

  try {
    const initialCatalogResponse = await serverFetch<CatalogProductsResponse>(`/products?${params.toString()}`);
    return {
      props: { initialCatalogResponse, searchTerm, categorySlug, subcategorySlug, sort, minPrice, maxPrice, inStock, onSale, brands },
    };
  } catch {
    return {
      props: { searchTerm, categorySlug, subcategorySlug, sort, minPrice, maxPrice, inStock, onSale, brands },
    };
  }
};

export default function ProductsPage({
  initialCatalogResponse,
  searchTerm,
  categorySlug,
  subcategorySlug,
  sort,
  minPrice,
  maxPrice,
  inStock,
  onSale,
  brands,
}: ProductsPageProps) {
  const titleParts = ["Wellness Products"];
  if (categorySlug !== "all") titleParts.push(categorySlug.replace(/-/g, " "));
  if (subcategorySlug !== "all") titleParts.push(subcategorySlug.replace(/-/g, " "));
  const title = titleParts.join(" | ");
  const description = searchTerm
    ? `Browse Pink Paisa products matching "${searchTerm}" with curated wellness and lifestyle picks.`
    : "Browse Pink Paisa's wellness product catalog with curated skincare, lifestyle, and women-first picks.";
  const canonicalParams = new URLSearchParams();
  if (searchTerm) canonicalParams.set("search", searchTerm);
  if (categorySlug !== "all") canonicalParams.set("category", categorySlug);
  if (subcategorySlug !== "all") canonicalParams.set("subcategory", subcategorySlug);
  if (sort !== "popular") canonicalParams.set("sort", sort);
  if (minPrice != null) canonicalParams.set("min_price", String(minPrice));
  if (maxPrice != null) canonicalParams.set("max_price", String(maxPrice));
  if (inStock) canonicalParams.set("in_stock", "true");
  if (onSale) canonicalParams.set("on_sale", "true");
  if (brands.length) canonicalParams.set("brand", brands.join(","));
  const canonicalPath = `/products${canonicalParams.toString() ? `?${canonicalParams.toString()}` : ""}`;

  return (
    <>
      <SeoHead title={title} description={description} canonicalPath={canonicalPath} />
      <PhysicalProductsPage initialCatalogResponse={initialCatalogResponse} />
    </>
  );
}
