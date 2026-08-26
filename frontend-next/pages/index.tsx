import type { GetServerSideProps } from "next";
import IndexPage from "@/pages/Index";
import SeoHead from "@/components/SeoHead";
import { Product } from "@/hooks/useProducts";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { getSiteUrl, serverFetch } from "@/lib/server-api";
import { PINK_PAISA_BRAND } from "@/lib/brand";

type HomePageProps = {
  initialProducts?: Product[];
  initialCatalogResponse?: CatalogProductsResponse;
};

export const getServerSideProps: GetServerSideProps<HomePageProps> = async () => {
  try {
    const [initialProducts, initialCatalogResponse] = await Promise.all([
      serverFetch<Product[]>("/virtual-products"),
      serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&affiliate_link_status=ok&_page=1&_limit=6"),
    ]);
    return { props: { initialProducts, initialCatalogResponse } };
  } catch {
    try {
      const initialCatalogResponse = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=true&affiliate_instagram_pick=true&affiliate_link_status=ok&_page=1&_limit=6");
      return { props: { initialCatalogResponse } };
    } catch {
      return { props: {} };
    }
  }
};

export default function HomePage({ initialProducts, initialCatalogResponse }: HomePageProps) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Pink Paisa",
    url: getSiteUrl(),
    sameAs: [PINK_PAISA_BRAND.instagramUrl],
  };

  return (
    <>
      <SeoHead
        title="Wealth, Wellness and Women"
        description="Take the Wealthness Quiz, use practical money calculators, and explore healthy curated affiliate picks from Pink Paisa."
        canonicalPath="/"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <IndexPage initialProducts={initialProducts} initialCatalogResponse={initialCatalogResponse} />
    </>
  );
}
