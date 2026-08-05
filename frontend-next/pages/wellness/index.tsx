import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import ErrorBoundary from "@/components/ui/error-boundary";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { getSiteUrl } from "@/lib/server-api";
import { fetchWellnessCollections, fetchWellnessHubProducts } from "@/lib/wellnessServer";
import { buildWellnessJsonLd } from "@/lib/wellnessStructuredData";
import { WELLNESS_HUB_PATH, WELLNESS_HUB_SEO, type WellnessPageConfig } from "@/lib/wellnessSeo";
import WellnessLanding from "@/pages/WellnessLanding";

type WellnessPageProps = {
  products: CatalogProduct[];
  collections: WellnessPageConfig[];
};

export const getServerSideProps: GetServerSideProps<WellnessPageProps> = async () => {
  const [products, collections] = await Promise.all([
    fetchWellnessHubProducts(),
    fetchWellnessCollections(),
  ]);
  return { props: { products, collections } };
};

export default function WellnessPage({ products, collections }: WellnessPageProps) {
  const jsonLd = buildWellnessJsonLd({
    siteUrl: getSiteUrl(),
    path: WELLNESS_HUB_PATH,
    title: WELLNESS_HUB_SEO.title,
    description: WELLNESS_HUB_SEO.description,
    breadcrumbs: [
      { name: "Home", path: "/" },
      { name: "Wellness", path: WELLNESS_HUB_PATH },
    ],
    products,
  });

  return (
    <>
      <SeoHead
        title={WELLNESS_HUB_SEO.title}
        description={WELLNESS_HUB_SEO.description}
        canonicalPath={WELLNESS_HUB_PATH}
        image="/og-pink-paisa.png"
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ErrorBoundary
        resetKey={WELLNESS_HUB_PATH}
        title="Wellness page could not load"
        description="The wellness hub hit a browser rendering issue. Reload this page or browse products while we recover this section."
        actionLabel="Try again"
      >
        <WellnessLanding products={products} collections={collections} />
      </ErrorBoundary>
    </>
  );
}
