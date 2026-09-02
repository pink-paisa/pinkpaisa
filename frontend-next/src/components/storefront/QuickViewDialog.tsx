import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Heart, Sparkles } from "lucide-react";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { DISCLOSURE_TEXT } from "@/components/affiliate/AffiliateDisclosure";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { formatAffiliateDataRefreshTime, hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";
import { formatCatalogPrice } from "@/lib/catalogQuery";
import { cn } from "@/lib/utils";

type QuickViewDialogProps = {
  product: CatalogProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wished: boolean;
  onToggleWishlist: (product: CatalogProduct) => void;
};

const MetaCell = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
    <p className="truncate text-xs font-medium">{value}</p>
  </div>
);

const PointList = ({
  title,
  points,
  tone,
}: {
  title: string;
  points: string[];
  tone: "good" | "caution";
}) => (
  <div className={cn("flex-1 rounded-xl border border-border p-3", tone === "good" ? "bg-sage-light" : "bg-background")}>
    <p
      className={cn(
        "text-[9px] font-bold uppercase tracking-[0.1em]",
        tone === "good" ? "text-sage" : "text-muted-foreground",
      )}
    >
      {title}
    </p>
    <ul className="mt-2 space-y-1.5">
      {points.map((point) => (
        <li key={point} className="flex gap-2 text-[11px] leading-4">
          {tone === "good" ? (
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-sage" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span>{point}</span>
        </li>
      ))}
    </ul>
  </div>
);

/**
 * The API already returns `pros`, `cons` and `buying_intent` for every catalog
 * entry but the grid has no room for them. Quick view is where they earn their
 * keep — for affiliate listings with no price, they are the only comparison aid
 * a shopper has before leaving for Amazon.
 */
export const QuickViewDialog = ({
  product,
  open,
  onOpenChange,
  wished,
  onToggleWishlist,
}: QuickViewDialogProps) => {
  if (!product) return null;

  const isAffiliate = Boolean(product.is_affiliate && product.affiliate_url);
  const showPrice = hasVisibleAffiliatePrice(product) || (!isAffiliate && product.price != null);
  const refreshedAt = formatAffiliateDataRefreshTime(product);
  // Some rows arrive with a single semicolon-joined string rather than discrete entries.
  const splitPoints = (values?: string[]) =>
    (values ?? [])
      .flatMap((entry) => entry.split(";"))
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 4);
  const pros = splitPoints(product.pros);
  const cons = splitPoints(product.cons);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden rounded-2xl p-0">
        <div className="grid max-h-[85dvh] grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 bg-background p-5">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-white">
              {product.featured_image ? (
                <img
                  src={product.featured_image}
                  alt={product.title}
                  className="h-full w-full object-contain p-4"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Sparkles className="h-12 w-12 text-muted-foreground/30" />
                </div>
              )}
              {isAffiliate ? (
                <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                  {product.is_featured_affiliate ? "Editor's pick" : "Curated find"}
                </span>
              ) : null}
            </div>
            {isAffiliate ? (
              <p className="rounded-lg bg-card p-2.5 text-[11px] leading-4 text-muted-foreground">
                Amazon supplies the catalogue image. More angles, sizes and variants are on the Amazon listing.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              {product.brand_name ? (
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
                  {product.brand_name}
                </span>
              ) : null}
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                {product.category}
                {product.subcategory ? ` · ${product.subcategory}` : ""}
              </span>
            </div>

            <DialogTitle className="text-lg font-medium leading-snug sm:text-xl">{product.title}</DialogTitle>

            {product.buying_intent ? (
              <div className="rounded-xl bg-rose-soft p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-accent-foreground">Who this is for</p>
                <p className="mt-1 text-xs font-medium">{product.buying_intent}</p>
              </div>
            ) : null}

            <div className="rounded-xl border border-border bg-background p-3.5">
              {showPrice ? (
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-serif text-xl font-bold">
                    {formatCatalogPrice(product.sale_price ?? product.price ?? 0)}
                  </span>
                  {product.sale_price && product.price ? (
                    <span className="text-sm text-muted-foreground line-through">
                      {formatCatalogPrice(product.price)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" aria-hidden />
                  Live price on Amazon.in
                </p>
              )}
              <DialogDescription className="mt-1 text-[11px] leading-4">
                {isAffiliate
                  ? `Amazon sets and changes this price, so we send you to the live listing.${refreshedAt ? ` Last checked ${refreshedAt}.` : ""}`
                  : product.stock_quantity > 0
                    ? `${product.stock_quantity} in stock and ready to ship.`
                    : "Currently out of stock."}
              </DialogDescription>
            </div>

            {pros.length > 0 || cons.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                {pros.length > 0 ? <PointList title="What we like" points={pros} tone="good" /> : null}
                {cons.length > 0 ? <PointList title="Check before buying" points={cons} tone="caution" /> : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              {product.brand_name ? <MetaCell label="Brand" value={product.brand_name} /> : null}
              {product.affiliate_asin ? <MetaCell label="ASIN" value={product.affiliate_asin} /> : null}
              {product.affiliate_marketplace ? (
                <MetaCell
                  label="Marketplace"
                  value={product.affiliate_marketplace === "amazon_in" ? "Amazon.in" : "Amazon.com"}
                />
              ) : null}
              {product.country_of_origin ? <MetaCell label="Origin" value={product.country_of_origin} /> : null}
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                {isAffiliate ? (
                  <AffiliateCta
                    product={product}
                    label="View on Amazon"
                    className="w-full rounded-full"
                    showDisclosure={false}
                  />
                ) : (
                  <Button asChild className="w-full rounded-full">
                    <Link href={`/product/${product.slug}`}>
                      View product <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
              <Button
                variant="outline"
                className="shrink-0 rounded-full"
                onClick={() => onToggleWishlist(product)}
                aria-pressed={wished}
              >
                <Heart className={cn("h-4 w-4", wished && "fill-current text-primary")} />
                {wished ? "Saved" : "Save"}
              </Button>
            </div>

            {isAffiliate ? <p className="text-[10px] leading-4 text-muted-foreground">{DISCLOSURE_TEXT}</p> : null}

            <Link
              href={`/product/${product.slug}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              Open full product page <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickViewDialog;
