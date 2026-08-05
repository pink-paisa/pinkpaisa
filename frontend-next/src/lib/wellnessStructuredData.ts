import type { CatalogProduct } from "@/hooks/useCatalogProducts";

type WellnessJsonLdInput = {
  siteUrl: string;
  path: string;
  title: string;
  description: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  products: CatalogProduct[];
};

export function buildWellnessJsonLd({
  siteUrl,
  path,
  title,
  description,
  breadcrumbs,
  products,
}: WellnessJsonLdInput) {
  const cleanSiteUrl = siteUrl.replace(/\/$/, "");
  const pageUrl = `${cleanSiteUrl}${path}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url: pageUrl,
      isPartOf: {
        "@type": "WebSite",
        name: "Pink Paisa",
        url: cleanSiteUrl,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: `${cleanSiteUrl}${item.path}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: products.slice(0, 12).map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${cleanSiteUrl}/product/${product.slug}`,
        name: product.title,
      })),
    },
  ];
}
