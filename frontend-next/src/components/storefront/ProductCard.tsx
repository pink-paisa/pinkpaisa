import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Heart, Maximize2, ShoppingCart, Sparkles, Star } from "lucide-react";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { formatAffiliateDataRefreshTime, hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";
import { formatCatalogPrice } from "@/lib/catalogQuery";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ProductCardProps = {
  product: CatalogProduct;
  wished: boolean;
  cartQuantity: number;
  onToggleWishlist: (product: CatalogProduct) => void;
  onQuickView?: (product: CatalogProduct) => void;
};

const CardBadge = ({ children, tone = "muted" }: { children: ReactNode; tone?: "primary" | "muted" | "sale" }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide sm:px-2.5 sm:py-1 sm:text-[10px]",
      tone === "primary" && "bg-primary text-primary-foreground",
      tone === "sale" && "bg-destructive text-destructive-foreground",
      tone === "muted" && "border border-border bg-background/95 text-accent-foreground shadow-sm",
    )}
  >
    {children}
  </span>
);

export const ProductCard = ({
  product,
  wished,
  cartQuantity,
  onToggleWishlist,
  onQuickView,
}: ProductCardProps) => {
  const { addItem } = useCart();
  const isAffiliate = Boolean(product.is_affiliate && product.affiliate_url);
  const showAffiliatePrice = hasVisibleAffiliatePrice(product);
  const refreshedAt = formatAffiliateDataRefreshTime(product);
  const isInCart = !isAffiliate && cartQuantity > 0;
  const outOfStock = !isAffiliate && product.stock_quantity <= 0;
  const atStockCap = !isAffiliate && product.stock_quantity > 0 && cartQuantity >= product.stock_quantity;

  const handleAdd = () => {
    if (isAffiliate || outOfStock || atStockCap) return;
    addItem(
      {
        id: product.id,
        title: product.title,
        price: product.sale_price ?? product.price ?? 0,
        priceMax: product.price ?? undefined,
        format: "Physical Product",
        image_url: product.featured_image,
        slug: product.slug,
        stock_quantity_at_add: product.stock_quantity,
      },
      1,
    );
    toast.success(product.title + " added to cart");
  };

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg hover:shadow-primary/10">
      <Link href={"/product/" + product.slug} className="relative block aspect-square overflow-hidden bg-white">
        {product.featured_image ? (
          <img
            src={product.featured_image}
            alt={product.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-105 sm:p-4"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent/30">
            <Sparkles className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
          {product.bestseller && !isAffiliate ? (
            <CardBadge tone="primary">
              <Star className="h-3 w-3" /> Bestseller
            </CardBadge>
          ) : null}
          {isAffiliate && product.is_featured_affiliate ? <CardBadge tone="primary">Editor&apos;s pick</CardBadge> : null}
          {product.featured && !product.bestseller && !isAffiliate ? <CardBadge>Featured</CardBadge> : null}
          {!isAffiliate && product.sale_price ? <CardBadge tone="sale">Sale</CardBadge> : null}
          {isAffiliate && !product.is_featured_affiliate ? <CardBadge>Curated find</CardBadge> : null}
        </div>

        {outOfStock ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
            <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground">
              Out of Stock
            </span>
          </div>
        ) : null}
      </Link>

      <div className="absolute right-2 top-2 flex flex-col gap-1.5 sm:right-3 sm:top-3">
        <button
          type="button"
          onClick={() => onToggleWishlist(product)}
          aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
          aria-pressed={wished}
          className={cn(
            "rounded-full border p-2 backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-2.5",
            wished
              ? "border-primary/30 bg-white text-primary"
              : "border-border bg-white/90 text-muted-foreground hover:text-primary",
          )}
        >
          <Heart className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", wished && "fill-current")} />
        </button>
        {onQuickView ? (
          <button
            type="button"
            onClick={() => onQuickView(product)}
            aria-label="Quick view"
            className="hidden rounded-full border border-border bg-white/90 p-2.5 text-muted-foreground opacity-0 backdrop-blur-sm transition-all hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 lg:block"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="line-clamp-1 text-[9px] font-bold uppercase tracking-[0.09em] text-primary sm:text-[10px]">
            {product.brand_name || product.category}
          </p>
          {isAffiliate ? (
            <span className="shrink-0 rounded-md bg-background px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              amazon.in
            </span>
          ) : null}
        </div>

        <Link href={"/product/" + product.slug} className="min-w-0">
          <h3 className="line-clamp-2 min-h-[2.25rem] text-[13px] font-medium leading-snug transition-colors hover:text-primary sm:text-sm">
            {product.title}
          </h3>
        </Link>

        <p className="line-clamp-1 text-[10px] text-muted-foreground sm:text-[11px]">
          {product.category}
          {product.subcategory ? " · " + product.subcategory : ""}
        </p>

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="h-px w-full bg-border" />

          {isAffiliate ? (
            showAffiliatePrice ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-serif text-base font-bold text-foreground sm:text-lg">
                    {formatCatalogPrice(product.sale_price ?? product.price ?? 0)}
                  </span>
                  {product.sale_price && product.price ? (
                    <span className="text-xs text-muted-foreground line-through">
                      {formatCatalogPrice(product.price)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {refreshedAt ? "Updated " + refreshedAt : "Confirm on Amazon"}
                </p>
              </div>
            ) : (
              // Amazon owns the price for these listings, so the card promises a live
              // price at the destination rather than showing a stale or empty one.
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-sage sm:text-[11px]">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sage" aria-hidden />
                Live price on Amazon
              </p>
            )
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-serif text-base font-bold text-foreground sm:text-lg">
                {formatCatalogPrice(product.sale_price ?? product.price ?? 0)}
              </span>
              {product.sale_price && product.price ? (
                <span className="text-xs text-muted-foreground line-through">
                  {formatCatalogPrice(product.price)}
                </span>
              ) : null}
            </div>
          )}

          {isAffiliate ? (
            <AffiliateCta
              product={product}
              label="View on Amazon"
              size="sm"
              variant="outline"
              className="h-9 w-full rounded-full border-primary text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
              showDisclosure={false}
            />
          ) : (
            <Button
              size="sm"
              variant={isInCart ? "secondary" : "default"}
              className="h-9 w-full rounded-full text-xs"
              onClick={handleAdd}
              disabled={outOfStock || atStockCap}
            >
              {isInCart ? (
                <>
                  <Check className="h-3.5 w-3.5" /> {atStockCap ? "Max reached" : "Added"}
                </>
              ) : (
                <>
                  <ShoppingCart className="h-3.5 w-3.5" /> Add to cart
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
