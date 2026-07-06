import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import InstagramAffiliateLanding from "@/pages/InstagramAffiliateLanding";
import { serverFetch } from "@/lib/server-api";

type InstagramPicksPageProps = {
  products: CatalogProductsResponse["items"];
};

export const getServerSideProps: GetServerSideProps<InstagramPicksPageProps> = async () => {
  const response = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&_page=1&_limit=24").catch(() => null);
  return { props: { products: response?.items ?? [] } };
};

export default function InstagramPicksPage({ products }: InstagramPicksPageProps) {
  return (
    <>
      <SeoHead
        title="Instagram Picks"
        description="Curated Amazon products selected for Pink Paisa Instagram campaigns."
        canonicalPath="/instagram/picks"
      />
      <InstagramAffiliateLanding
        title="Instagram Picks"
        description="Products selected for reels, stories, and bio traffic. Open each pick to review context before going to Amazon."
        products={products}
        activeTab="picks"
      />
    </>
  );
}
