import type { CatalogProduct } from "@/hooks/useCatalogProducts";

export function getAffiliateProductDisplayTitle(
  product: Pick<CatalogProduct, "title" | "editorial_title">,
) {
  return product.editorial_title?.trim() || product.title;
}
