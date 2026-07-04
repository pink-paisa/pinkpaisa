import type { GetServerSideProps } from "next";
import ProductDetailPage from "@/pages/ProductDetail";
import SeoHead from "@/components/SeoHead";
import { CatalogProductDetail } from "@/hooks/useCatalogProducts";
import { getSiteUrl, serverFetch } from "@/lib/server-api";

type ProductPageProps = {
  slug: string;
  initialProduct?: CatalogProductDetail | null;
};

export const getServerSideProps: GetServerSideProps<ProductPageProps> = async ({ params }) => {
  const slug = String(params?.slug || "");
  try {
    const initialProduct = await serverFetch<CatalogProductDetail>(`/products/${slug}?include=related,vendor,breadcrumb`);
    return { props: { slug, initialProduct } };
  } catch {
    return { notFound: true };
  }
};

export default function ProductPage({ slug, initialProduct }: ProductPageProps) {
  const title = initialProduct?.title || "Product";
  const description =
    initialProduct?.short_description ||
    initialProduct?.full_description ||
    `Explore ${title} on Pink Paisa.`;
  const image = initialProduct?.featured_image || initialProduct?.images?.[0] || null;
  const price = initialProduct?.sale_price ?? initialProduct?.price ?? null;
  const isAffiliate = Boolean(initialProduct?.is_affiliate);

  const productJsonLd =
    initialProduct && !isAffiliate && price != null
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: initialProduct.title,
          image: image ? [image] : undefined,
          description,
          sku: initialProduct.sku || undefined,
          brand: { "@type": "Brand", name: initialProduct.brand_name || "Pink Paisa" },
          category: initialProduct.category || undefined,
          offers: {
            "@type": "Offer",
            priceCurrency: "INR",
            price,
            availability:
              initialProduct.stock_quantity > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            url: `${getSiteUrl()}/product/${slug}`,
          },
        }
      : null;

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        canonicalPath={`/product/${slug}`}
        image={image}
        type="product"
      />
      {productJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
      ) : null}
      <ProductDetailPage slug={slug} initialProduct={initialProduct} />
    </>
  );
}
