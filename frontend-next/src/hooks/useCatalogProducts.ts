import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type CatalogProduct = {
  id: string;
  title: string;
  slug: string;
  is_affiliate?: boolean;
  affiliate_url?: string | null;
  affiliate_external_id?: string | null;
  affiliate_source_platform?: string | null;
  affiliate_asin?: string | null;
  affiliate_marketplace?: "amazon_in" | "amazon_us" | null;
  affiliate_tag?: string | null;
  affiliate_data_source?: string | null;
  affiliate_data_last_refreshed_at?: string | null;
  affiliate_data_expires_at?: string | null;
  affiliate_api_error?: string | null;
  price_status?: "unavailable" | "manual_unverified" | "verified" | "stale" | null;
  price_available?: boolean;
  price_verified_at?: string | null;
  affiliate_compliance_status?: "needs_review" | "compliant" | "non_compliant" | "paused" | null;
  affiliate_compliance_flags?: string[];
  buying_intent?: string | null;
  campaign_label?: string | null;
  pros?: string[];
  cons?: string[];
  seo_title?: string | null;
  seo_description?: string | null;
  is_featured_affiliate?: boolean;
  affiliate_sort_order?: number;
  affiliate_is_instagram_pick?: boolean;
  short_description: string | null;
  full_description: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  category: string;
  subcategory?: string | null;
  images: string[];
  image_items?: Array<{ url: string; alt: string | null; position: number }>;
  featured_image: string | null;
  price: number | null;
  sale_price: number | null;
  effective_price?: number | null;
  mrp?: number | null;
  gst_rate_percent?: number;
  hsn_code?: string | null;
  brand_name?: string | null;
  country_of_origin?: string | null;
  sku: string | null;
  stock_quantity: number;
  tags: string[];
  weight: number | null;
  dimensions: string | null;
  seo_meta_title?: string | null;
  seo_meta_description?: string | null;
  seo_keywords?: string[];
  attributes?: Record<string, unknown>;
  status: string;
  featured: boolean;
  bestseller: boolean;
  sort_order: number;
  updatedAt?: string;
  updated_at?: string;
  createdAt?: string;
  created_at?: string;
};

export type CatalogFacetResponse = {
  categories: Array<{ id: string | null; name: string; count: number }>;
  subcategories: Array<{ id: string | null; name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
  price_buckets: Array<{ min: number; max: number | null; count: number }>;
};

export type CatalogProductDetail = CatalogProduct & {
  related_products?: CatalogProduct[];
  vendor_summary?: {
    id: string;
    shop_name: string | null;
    business_name: string | null;
    owner_name: string | null;
  };
  breadcrumb?: Array<{ name: string; href: string }>;
};

export type CatalogProductsResponse = {
  items: CatalogProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type CatalogProductParams = {
  includeAll?: boolean;
  search?: string;
  categorySlug?: string | null;
  subcategorySlug?: string | null;
  sort?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  inStock?: boolean;
  onSale?: boolean;
  brands?: string[];
  page?: number;
  pageSize?: number;
};

export const useCatalogProducts = ({
  includeAll = false,
  search,
  categorySlug,
  subcategorySlug,
  sort,
  minPrice,
  maxPrice,
  inStock,
  onSale,
  brands,
  page = 1,
  pageSize = 24,
}: CatalogProductParams = {}, initialData?: CatalogProductsResponse) => {
  return useQuery({
    queryKey: ["catalog_products", includeAll, search || "", categorySlug || "", subcategorySlug || "", sort || "", minPrice ?? "", maxPrice ?? "", inStock ?? false, onSale ?? false, (brands || []).join("|"), page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeAll) params.set("all", "true");
      params.set("include_meta", "true");
      params.set("_page", String(page));
      params.set("_limit", String(pageSize));
      if (search?.trim()) params.set("search", search.trim());
      if (categorySlug && categorySlug !== "all") params.set("category_slug", categorySlug);
      if (subcategorySlug && subcategorySlug !== "all") params.set("subcategory_slug", subcategorySlug);
      if (sort?.trim()) params.set("sort", sort.trim());
      if (minPrice != null) params.set("min_price", String(minPrice));
      if (maxPrice != null) params.set("max_price", String(maxPrice));
      if (inStock) params.set("in_stock", "true");
      if (onSale) params.set("on_sale", "true");
      if (brands?.length) params.set("brand", brands.join(","));
      return apiFetch<CatalogProductsResponse>(`/products?${params.toString()}`);
    },
    initialData,
  });
};

export const useCatalogProduct = (slug?: string, initialData?: CatalogProductDetail | null, include?: string) => {
  return useQuery({
    queryKey: ["catalog_product", slug || "", include || ""],
    enabled: Boolean(slug),
    queryFn: async () => apiFetch<CatalogProductDetail>(`/products/${slug}${include ? `?include=${encodeURIComponent(include)}` : ""}`),
    initialData: initialData ?? undefined,
  });
};
