import type { GetServerSideProps } from "next";
import PhysicalProductsPage from "@/pages/PhysicalProducts";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { serverFetch } from "@/lib/server-api";
import {
  buildCatalogApiParams,
  buildCatalogCanonicalPath,
  parseCatalogQuery,
  type CatalogFilterState,
} from "@/lib/catalogQuery";

type ProductsPageProps = {
  initialCatalogResponse?: CatalogProductsResponse;
  filterState: CatalogFilterState;
};

export const getServerSideProps: GetServerSideProps<ProductsPageProps> = async ({ query }) => {
  const filterState = parseCatalogQuery(query);

  try {
    const initialCatalogResponse = await serverFetch<CatalogProductsResponse>(
      `/products?${buildCatalogApiParams(filterState).toString()}`,
    );
    return { props: { initialCatalogResponse, filterState } };
  } catch {
    return { props: { filterState } };
  }
};

const titleize = (slug: string) => slug.replace(/-/g, " ");

export default function ProductsPage({ initialCatalogResponse, filterState }: ProductsPageProps) {
  const titleParts = ["Wellness Products"];
  if (filterState.categorySlug !== "all") titleParts.push(titleize(filterState.categorySlug));
  if (filterState.subcategorySlug !== "all") titleParts.push(titleize(filterState.subcategorySlug));

  const description = filterState.search
    ? `Browse Pink Paisa products matching "${filterState.search}" with curated wellness and lifestyle picks.`
    : "Browse Pink Paisa's wellness product catalog with curated skincare, lifestyle, and women-first picks.";

  return (
    <>
      <SeoHead
        title={titleParts.join(" | ")}
        description={description}
        canonicalPath={buildCatalogCanonicalPath(filterState)}
      />
      <PhysicalProductsPage initialCatalogResponse={initialCatalogResponse} />
    </>
  );
}
