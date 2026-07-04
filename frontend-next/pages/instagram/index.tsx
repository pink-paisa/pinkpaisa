import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import InstagramAffiliateLanding from "@/pages/InstagramAffiliateLanding";
import { serverFetch } from "@/lib/server-api";

type InstagramPageProps = {
  products: CatalogProductsResponse["items"];
};

export const getServerSideProps: GetServerSideProps<InstagramPageProps> = async () => {
  const response = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&_page=1&_limit=24").catch(() => null);
  return { props: { products: response?.items ?? [] } };
};

export default function InstagramPage({ products }: InstagramPageProps) {
  return (
    <>
      <SeoHead
        title="Best Amazon Finds"
        description="Mobile-first Amazon picks curated by Pink Paisa for Instagram shoppers."
        canonicalPath="/instagram"
      />
      <InstagramAffiliateLanding
        title="Best Amazon Finds"
        description="Curated picks from Pink Paisa. Open each product for context, then check the current price and availability on Amazon."
        products={products}
        activeTab="home"
      />
    </>
  );
}
