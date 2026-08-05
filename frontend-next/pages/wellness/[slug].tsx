import type { GetServerSideProps } from "next";
import SeoHead from "@/components/SeoHead";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { getSiteUrl } from "@/lib/server-api";
import { fetchWellnessCategoryProducts, fetchWellnessCollectionBySlug } from "@/lib/wellnessServer";
import { buildWellnessJsonLd } from "@/lib/wellnessStructuredData";
import { WELLNESS_HUB_PATH, type WellnessPageConfig } from "@/lib/wellnessSeo";
import WellnessCategoryLanding from "@/pages/WellnessCategoryLanding";

type WellnessDynamicPageProps = {
  config: WellnessPageConfig;
  collections: WellnessPageConfig[];
  products: CatalogProduct[];
};

export const getServerSideProps: GetServerSideProps<WellnessDynamicPageProps> = async ({ params }) => {
  const slug = String(params?.slug || "").trim();
  if (!slug) return { notFound: true };

  const { config, collections } = await fetchWellnessCollectionBySlug(slug);
  if (!config) return { notFound: true };

  const products = await fetchWellnessCategoryProducts(config);
  return { props: { config, collections, products } };
};

export default function WellnessDynamicPage({ config, collections, products }: WellnessDynamicPageProps) {
  const jsonLd = buildWellnessJsonLd({
    siteUrl: getSiteUrl(),
    path: config.path,
    title: config.seoTitle,
    description: config.seoDescription,
    breadcrumbs: [
      { name: "Home", path: "/" },
      { name: "Wellness", path: WELLNESS_HUB_PATH },
      { name: config.label, path: config.path },
    ],
    products,
  });

  return (
    <>
      <SeoHead
        title={config.seoTitle}
        description={config.seoDescription}
        canonicalPath={config.path}
        image="/og-pink-paisa.png"
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <WellnessCategoryLanding config={config} collections={collections} products={products} />
    </>
  );
}
