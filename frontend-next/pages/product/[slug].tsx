import type { GetServerSideProps } from "next";
import ProductDetailPage from "@/pages/ProductDetail";
import SeoHead from "@/components/SeoHead";
import { CatalogProductDetail } from "@/hooks/useCatalogProducts";
import { getSiteUrl, serverFetch } from "@/lib/server-api";
import {
  buildProductPageJsonLd,
  getProductSeoDescription,
  getProductSeoImage,
  getProductSeoTitle,
  isIndexableProduct,
} from "@/lib/productSeo";

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
  const title = getProductSeoTitle(initialProduct);
  const description = getProductSeoDescription(initialProduct);
  const image = getProductSeoImage(initialProduct);
  const noindex = !isIndexableProduct(initialProduct);
  const productJsonLd = initialProduct
    ? buildProductPageJsonLd(initialProduct, getSiteUrl(), `/product/${slug}`)
    : null;

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        canonicalPath={`/product/${slug}`}
        image={image}
        type="product"
        noindex={noindex}
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
