import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { serverFetch } from "@/lib/server-api";
import StartHere from "@/pages/StartHere";

type StartHerePageProps = {
  products: CatalogProductsResponse["items"];
};

export const getServerSideProps: GetServerSideProps<StartHerePageProps> = async () => {
  const response = await serverFetch<CatalogProductsResponse>(
    "/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&affiliate_link_status=ok&_page=1&_limit=6",
  ).catch(() => null);
  return { props: { products: response?.items ?? [] } };
};

export default function StartHerePage({ products }: StartHerePageProps) {
  return (
    <>
      <SeoHead
        title="Start Here"
        description="Take the Pink Paisa Wealthness Quiz, use practical calculators, explore curated picks, or request a workshop quote."
        canonicalPath="/start-here"
      />
      <StartHere products={products} />
    </>
  );
}
