import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import InstagramAffiliateLanding from "@/pages/InstagramAffiliateLanding";
import { serverFetch } from "@/lib/server-api";

type InstagramTrendingPageProps = {
  products: CatalogProductsResponse["items"];
};

export function resolveTrendingServerResult(products: CatalogProductsResponse["items"]) {
  if (!products.length) {
    return {
      redirect: {
        destination: "/instagram/picks",
        permanent: false,
      },
    } as const;
  }
  return { props: { products } } as const;
}

export const getServerSideProps: GetServerSideProps<InstagramTrendingPageProps> = async () => {
  const response = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&affiliate_link_status=ok&featured=true&_page=1&_limit=24").catch(() => null);
  return resolveTrendingServerResult(response?.items ?? []);
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
