import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import InstagramAffiliateLanding from "@/pages/InstagramAffiliateLanding";
import { serverFetch } from "@/lib/server-api";

type CampaignPageProps = {
  slug: string;
  products: CatalogProductsResponse["items"];
};

export const getServerSideProps: GetServerSideProps<CampaignPageProps> = async ({ params }) => {
  const slug = String(params?.slug || "");
  const response = await serverFetch<CatalogProductsResponse>(`/products?include_meta=true&is_affiliate=true&campaign_label=${encodeURIComponent(slug)}&_page=1&_limit=24`).catch(() => null);
  return { props: { slug, products: response?.items ?? [] } };
};

export default function InstagramCampaignPage({ slug, products }: CampaignPageProps) {
  const title = slug.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <>
      <SeoHead
        title={`${title} Amazon Picks`}
        description={`Curated Amazon picks for the ${title} campaign from Pink Paisa.`}
        canonicalPath={`/instagram/campaign/${slug}`}
      />
      <InstagramAffiliateLanding
        title={title}
        description="Campaign picks curated for Instagram traffic. Confirm price, availability, shipping, ratings, and reviews on Amazon before buying."
        products={products}
        activeTab="campaign"
      />
    </>
  );
}
