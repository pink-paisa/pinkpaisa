import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { CatalogFacetResponse } from "@/hooks/useCatalogProducts";

type CatalogFacetsParams = {
  search?: string;
  categorySlug?: string | null;
  subcategorySlug?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  inStock?: boolean;
  onSale?: boolean;
  brands?: string[];
};

export const useCatalogFacets = ({
  search,
  categorySlug,
  subcategorySlug,
  minPrice,
  maxPrice,
  inStock,
  onSale,
  brands,
}: CatalogFacetsParams = {}) => {
  return useQuery({
    queryKey: [
      "catalog_facets",
      search || "",
      categorySlug || "",
      subcategorySlug || "",
      minPrice ?? "",
      maxPrice ?? "",
      inStock ?? false,
      onSale ?? false,
      (brands || []).join("|"),
    ],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search?.trim()) params.set("search", search.trim());
      if (categorySlug && categorySlug !== "all") params.set("category_slug", categorySlug);
      if (subcategorySlug && subcategorySlug !== "all") params.set("subcategory_slug", subcategorySlug);
      if (minPrice != null) params.set("min_price", String(minPrice));
      if (maxPrice != null) params.set("max_price", String(maxPrice));
      if (inStock) params.set("in_stock", "true");
      if (onSale) params.set("on_sale", "true");
      if (brands?.length) params.set("brand", brands.join(","));
      return apiFetch<CatalogFacetResponse>(`/products/facets?${params.toString()}`);
    },
  });
};
