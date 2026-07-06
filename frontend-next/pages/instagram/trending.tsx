import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import InstagramAffiliateLanding from "@/pages/InstagramAffiliateLanding";
import { serverFetch } from "@/lib/server-api";

type InstagramTrendingPageProps = {
  products: CatalogProductsResponse["items"];
};

export const getServerSideProps: GetServerSideProps<InstagramTrendingPageProps> = async () => {
  const response = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&featured=true&_page=1&_limit=24").catch(() => null);
  return { props: { products: response?.items ?? [] } };
};

export default function InstagramTrendingPage({ products }: InstagramTrendingPageProps) {
  return (
    <>
      <SeoHead
        title="Trending Amazon Finds"
        description="Featured Amazon finds curated by Pink Paisa."
        canonicalPath="/instagram/trending"
      />
      <InstagramAffiliateLanding
        title="Trending Now"
        description="Featured Amazon finds for fast mobile browsing. Confirm final price, availability, shipping, ratings, and reviews on Amazon."
        products={products}
        activeTab="trending"
      />
    </>
  );
}
