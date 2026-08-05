import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";

type WellnessProductCardProps = {
  product: CatalogProduct;
};

export default function WellnessProductCard({ product }: WellnessProductCardProps) {
  const hasAffiliateCta = Boolean(product.is_affiliate && product.affiliate_url);
  const supportingText =
    product.buying_intent ||
    product.short_description ||
    product.seo_description ||
    "Open the product page for context, then confirm current details on Amazon.";

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/product/${product.slug}`} className="aspect-square overflow-hidden bg-accent/30">
        {product.featured_image ? (
          <img
            src={product.featured_image}
            alt={product.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-3 transition-transform duration-500 hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Sparkles className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <p className="line-clamp-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          {product.subcategory || product.category}
        </p>
        <Link href={`/product/${product.slug}`} className="mt-2">
          <h2 className="line-clamp-2 min-h-[2.75rem] font-serif text-lg leading-tight hover:text-primary">
            {product.title}
          </h2>
        </Link>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
          {supportingText}
        </p>
        {product.pros?.length ? (
          <ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
            {product.pros.slice(0, 2).map((item) => (
              <li key={item}>Best for: {item}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto pt-4">
          {hasAffiliateCta ? (
            <AffiliateCta
              product={product}
              label="Check on Amazon"
              size="sm"
              variant="secondary"
              className="w-full rounded-full text-xs"
            />
          ) : (
            <Link
              href={`/product/${product.slug}`}
              className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-secondary px-4 text-sm font-semibold text-secondary-foreground"
            >
              View product
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
