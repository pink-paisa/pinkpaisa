import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type ProductSubcategoryNode = {
  id: string;
  _id?: string;
  category_id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  image_url?: string | null;
  seo_meta_title?: string | null;
  seo_meta_description?: string | null;
  product_count?: number;
  visible_count?: number;
  vendor_count?: number;
  is_active: boolean;
  sort_order: number;
  is_system?: boolean;
};

export type ProductCategoryNode = {
  id: string;
  _id?: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  image_url?: string | null;
  seo_meta_title?: string | null;
  seo_meta_description?: string | null;
  product_count?: number;
  visible_count?: number;
  vendor_count?: number;
  is_active: boolean;
  sort_order: number;
  is_system?: boolean;
  subcategories: ProductSubcategoryNode[];
};

export const useProductTaxonomy = (options?: { includeInactive?: boolean; includeUncategorized?: boolean }) => {
  const params = new URLSearchParams();
  if (options?.includeInactive) params.set("include_inactive", "true");
  if (options?.includeUncategorized) params.set("include_uncategorized", "true");
  const query = params.toString();

  return useQuery({
    queryKey: ["product_taxonomy", options?.includeInactive ?? false, options?.includeUncategorized ?? false],
    queryFn: async () => apiFetch<ProductCategoryNode[]>(`/categories/tree${query ? `?${query}` : ""}`),
    staleTime: 5 * 60 * 1000,
  });
};
