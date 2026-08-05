import Link from "next/link";
import { CheckCircle2, Info } from "lucide-react";
import type { CatalogProductDetail } from "@/hooks/useCatalogProducts";
import { WELLNESS_INSTAGRAM_PICKS_PATH } from "@/lib/wellnessSeo";

type AffiliateProductSeoSectionProps = {
  product: CatalogProductDetail;
  wellnessPath: string;
};

const fallbackText = (product: CatalogProductDetail) =>
  product.buying_intent ||
  product.short_description ||
  `A curated ${product.subcategory || product.category || "wellness"} pick for buyers comparing options before opening Amazon.`;

export default function AffiliateProductSeoSection({ product, wellnessPath }: AffiliateProductSeoSectionProps) {
  if (!product.is_affiliate) return null;

  const whyPicked = product.pros?.length ? product.pros : [fallbackText(product)];
  const considerations = product.cons?.length
    ? product.cons
    : ["Confirm current price, seller, size, reviews, delivery, and availability on Amazon before buying."];

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Buying guide</p>
      <h2 className="mt-2 font-serif text-2xl leading-tight">How this Pink Paisa pick fits</h2>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl bg-secondary/50 p-4">
          <h3 className="font-semibold">Best for</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{fallbackText(product)}</p>
        </div>

        <div className="rounded-xl bg-secondary/50 p-4">
          <h3 className="font-semibold">Why we picked it</h3>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
            {whyPicked.slice(0, 4).map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-secondary/50 p-4">
          <h3 className="font-semibold">Consider before buying</h3>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
            {considerations.slice(0, 4).map((item) => (
              <li key={item} className="flex gap-2">
                <Info className="mt-1 h-4 w-4 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">How to use this page</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the Pink Paisa notes to decide if this product fits your routine, then open Amazon only when you are ready to check the latest product details.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Related collection</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Compare this item with other curated picks in the same wellness area.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href={wellnessPath} className="inline-flex text-sm font-semibold text-primary hover:underline">
              Browse related wellness picks
            </Link>
            <Link href={WELLNESS_INSTAGRAM_PICKS_PATH} className="inline-flex text-sm font-semibold text-primary hover:underline">
              View Instagram picks
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Does Pink Paisa sell this product?</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            No. This is an Amazon affiliate pick. Pink Paisa helps you compare the use case, then Amazon handles the final product details and purchase.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Why is there no price shown here?</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Manual affiliate pages do not show Amazon price, ratings, reviews, or availability. Check Amazon for the current details before buying.
          </p>
        </div>
      </div>
    </section>
  );
}
