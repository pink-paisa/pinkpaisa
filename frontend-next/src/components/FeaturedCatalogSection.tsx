import Link from "next/link";
import { Check, ShoppingCart, Sparkles } from "lucide-react";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import type { CatalogProduct, CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { formatAffiliateDataRefreshTime, hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";
import { toast } from "sonner";

const formatPrice = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const FeaturedCatalogCard = ({ product }: { product: CatalogProduct }) => {
  const { addItem, items } = useCart();
  const isAffiliate = Boolean(product.is_affiliate && product.affiliate_url);
  const showAffiliateApiPrice = hasVisibleAffiliatePrice(product);
  const affiliatePriceRefreshedAt = formatAffiliateDataRefreshTime(product);
  const cartQuantity = items.filter((item) => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
  const outOfStock = !isAffiliate && product.stock_quantity <= 0;
  const quantityReachedCap = !isAffiliate && cartQuantity >= product.stock_quantity && product.stock_quantity > 0;
  const isInCart = !isAffiliate && cartQuantity > 0;

  const handleAdd = () => {
    if (isAffiliate || outOfStock || quantityReachedCap) return;
    addItem(
      {
        id: product.id,
        title: product.title,
        price: product.sale_price ?? product.price,
        priceMax: product.price,
        format: "Physical Product",
        image_url: product.featured_image,
        slug: product.slug,
        stock_quantity_at_add: product.stock_quantity,
      },
      1,
    );
    toast.success(`${product.title} added to cart`);
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-xl hover:shadow-primary/10">
      <Link href={`/product/${product.slug}`} className="relative aspect-square overflow-hidden bg-accent/20">
        {product.featured_image ? (
          <img src={product.featured_image} alt={product.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Sparkles className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        {product.sale_price && !isAffiliate ? (
          <span className="absolute left-3 top-3 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">Sale</span>
        ) : null}
        {isAffiliate ? (
          <span className="absolute left-3 top-3 rounded-full bg-background/95 px-2.5 py-1 text-[10px] font-bold text-primary shadow-sm">Curated find</span>
        ) : null}
        {outOfStock ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
            <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground">Out of Stock</span>
          </div>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          {product.category}
          {product.subcategory ? ` · ${product.subcategory}` : ""}
        </p>
        <Link href={`/product/${product.slug}`} className="mb-2 font-serif text-lg leading-tight transition-colors hover:text-primary">
          {product.title}
        </Link>
        {product.short_description ? <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{product.short_description}</p> : null}

        <div className={isAffiliate ? "mt-auto space-y-3" : "mt-auto flex items-center justify-between gap-3"}>
          {isAffiliate ? (
            showAffiliateApiPrice ? (
              <div className="w-full">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-serif text-xl font-bold text-foreground">{formatPrice(product.sale_price ?? product.price)}</span>
                  {product.sale_price ? <span className="text-sm text-muted-foreground line-through">{formatPrice(product.price)}</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {affiliatePriceRefreshedAt ? `Updated ${affiliatePriceRefreshedAt}. ` : ""}Confirm on Amazon.
                </p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">Confirm price on Amazon.</p>
            )
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-xl font-bold text-foreground">{formatPrice(product.sale_price ?? product.price)}</span>
              {product.sale_price ? <span className="text-sm text-muted-foreground line-through">{formatPrice(product.price)}</span> : null}
            </div>
          )}
          {isAffiliate ? (
            <AffiliateCta product={product} size="sm" variant="secondary" className="w-full rounded-xl" />
          ) : (
            <Button size="sm" className="rounded-xl" variant={isInCart ? "secondary" : "default"} onClick={handleAdd} disabled={outOfStock || quantityReachedCap}>
              {isInCart ? (
                <>
                  <Check className="h-3.5 w-3.5" /> {quantityReachedCap ? "Maxed" : "Added"}
                </>
              ) : (
                <>
                  <ShoppingCart className="h-3.5 w-3.5" /> Add
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const FeaturedCatalogSection = ({ initialCatalogResponse }: { initialCatalogResponse?: CatalogProductsResponse }) => {
  const products = (initialCatalogResponse?.items || []).slice(0, 6);

  if (!products.length) return null;

  return (
    <section id="products" className="bg-background py-20 md:py-28">
      <div className="container mx-auto">
        <div className="mb-14 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Featured Products</p>
            <h2 className="mb-4 font-serif text-3xl leading-tight md:text-4xl">Shop the wellness products buyers can actually purchase right now</h2>
            <p className="text-lg text-muted-foreground">
              Approved admin and vendor-backed products now surface here, so shoppers can discover the live catalog straight from the homepage.
            </p>
          </div>
          <Button asChild size="lg" className="rounded-2xl">
            <Link href="/products">View all products</Link>
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <FeaturedCatalogCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturedCatalogSection;
