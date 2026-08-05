import type { CatalogProductDetail } from "@/hooks/useCatalogProducts";

const clean = (value?: string | null) => String(value || "").trim();

const stripLines = (value = "") => value.replace(/\s+/g, " ").trim();

export function getProductSeoTitle(product?: CatalogProductDetail | null) {
  if (!product) return "Product";
  return clean(product.seo_title) || clean(product.seo_meta_title) || product.title;
}

export function getProductSeoDescription(product?: CatalogProductDetail | null) {
  if (!product) return "Explore this Pink Paisa product.";
  const description =
    clean(product.seo_description) ||
    clean(product.seo_meta_description) ||
    clean(product.short_description) ||
    clean(product.full_description) ||
    `Explore ${product.title} on Pink Paisa.`;
  return stripLines(description).slice(0, 180);
}

export function getProductSeoImage(product?: CatalogProductDetail | null) {
  if (!product) return null;
  return product.featured_image || product.images?.[0] || product.image_items?.[0]?.url || null;
}

export function isIndexableProduct(product?: CatalogProductDetail | null) {
  if (!product) return false;
  if (product.status !== "active") return false;
  if (!product.category || product.category === "Uncategorized") return false;
  if (!product.subcategory || product.subcategory === "Uncategorized") return false;
  if (product.is_affiliate && product.affiliate_compliance_status !== "compliant") return false;
  return true;
}

function absoluteUrl(siteUrl: string, path?: string | null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildBreadcrumbJsonLd(product: CatalogProductDetail, siteUrl: string, canonicalPath: string) {
  const breadcrumb = product.breadcrumb?.length
    ? product.breadcrumb
    : [
        { name: "Home", href: "/" },
        { name: product.category || "Products", href: "/products" },
        { name: product.subcategory || product.category || "Products", href: "/products" },
        { name: product.title, href: canonicalPath },
      ];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumb.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(siteUrl, item.href),
    })),
  };
}

function buildSafeProductJsonLd(product: CatalogProductDetail, siteUrl: string) {
  const image = getProductSeoImage(product);
  const safeProduct: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: getProductSeoDescription(product),
    image: image ? [absoluteUrl(siteUrl, image)] : undefined,
    sku: product.sku || product.affiliate_asin || undefined,
    brand: product.brand_name ? { "@type": "Brand", name: product.brand_name } : undefined,
    category: product.subcategory || product.category || undefined,
  };

  Object.keys(safeProduct).forEach((key) => {
    if (safeProduct[key] === undefined) delete safeProduct[key];
  });

  return safeProduct;
}

function buildNonAffiliateOfferJsonLd(product: CatalogProductDetail, siteUrl: string, canonicalPath: string) {
  const price = product.sale_price ?? product.price ?? null;
  const baseProduct = buildSafeProductJsonLd(product, siteUrl);
  if (price == null) return baseProduct;

  return {
    ...baseProduct,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price,
      availability:
        product.stock_quantity > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: absoluteUrl(siteUrl, canonicalPath),
    },
  };
}

export function buildProductPageJsonLd(product: CatalogProductDetail, siteUrl: string, canonicalPath: string) {
  const canonicalUrl = absoluteUrl(siteUrl, canonicalPath);
  const image = getProductSeoImage(product);
  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: getProductSeoTitle(product),
    description: getProductSeoDescription(product),
    url: canonicalUrl,
    image: image ? absoluteUrl(siteUrl, image) : undefined,
  };

  const productJsonLd = product.is_affiliate
    ? buildSafeProductJsonLd(product, siteUrl)
    : buildNonAffiliateOfferJsonLd(product, siteUrl, canonicalPath);

  return [
    webpage,
    buildBreadcrumbJsonLd(product, siteUrl, canonicalPath),
    productJsonLd,
  ];
}
