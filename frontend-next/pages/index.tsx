import type { GetServerSideProps } from "next";
import IndexPage from "@/pages/Index";
import SeoHead from "@/components/SeoHead";
import { Product } from "@/hooks/useProducts";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { getSiteUrl, serverFetch } from "@/lib/server-api";

type HomePageProps = {
  initialProducts?: Product[];
  initialCatalogResponse?: CatalogProductsResponse;
};

export const getServerSideProps: GetServerSideProps<HomePageProps> = async () => {
  try {
    const [initialProducts, initialCatalogResponse] = await Promise.all([
      serverFetch<Product[]>("/virtual-products"),
      serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=false&_page=1&_limit=6"),
    ]);
    return { props: { initialProducts, initialCatalogResponse } };
  } catch {
    try {
      const initialCatalogResponse = await serverFetch<CatalogProductsResponse>("/products?include_meta=true&is_affiliate=false&_page=1&_limit=6");
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
    sameAs: ["https://www.instagram.com/pinkpaisa.in"],
  };

  return (
    <>
      <SeoHead
        title="Wealth, Wellness and Women"
        description="Pink Paisa brings together digital learning, wellness products, workshops, and women-first growth experiences in one place."
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
