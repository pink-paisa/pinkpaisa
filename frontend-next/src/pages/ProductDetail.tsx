import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Heart,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
} from "lucide-react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type CatalogProduct,
  type CatalogProductDetail,
  useCatalogProduct,
} from "@/hooks/useCatalogProducts";
import { useWishlist } from "@/hooks/useWishlist";
import { trackAffiliateEvent } from "@/lib/affiliateTracking";
import { formatAffiliateDataRefreshTime, hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";
import { toast } from "sonner";

const formatPrice = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const ProductDetail = ({
  slug: initialSlug,
  initialProduct,
}: {
  slug?: string;
  initialProduct?: CatalogProductDetail | null;
}) => {
  const router = useRouter();
  const routeSlug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const slug = initialSlug ?? routeSlug;
  const { data: product, isLoading } = useCatalogProduct(slug, initialProduct ?? null, "related,vendor,breadcrumb");
  const { addItem, items } = useCart();
  const { toggleWishlist, isWishlisted } = useWishlist();
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [recentlyViewed, setRecentlyViewed] = useState<CatalogProduct[]>([]);

  const isAffiliate = Boolean(product?.is_affiliate && product?.affiliate_url);
  const showAffiliateApiPrice = hasVisibleAffiliatePrice(product);
  const affiliatePriceRefreshedAt = formatAffiliateDataRefreshTime(product);
  const currentCartQuantity = product ? items.find((item) => item.id === product.id)?.quantity || 0 : 0;
  const isInCart = currentCartQuantity > 0;

  const imageItems = useMemo(() => {
    if (!product) return [];
    if (Array.isArray(product.image_items) && product.image_items.length > 0) {
      return product.image_items
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((item) => ({
          url: item.url,
          alt: item.alt || product.title,
        }));
    }
    const legacyImages = Array.isArray(product.images) ? product.images : [];
    const urls = product.featured_image
      ? [product.featured_image, ...legacyImages.filter((image) => image !== product.featured_image)]
      : legacyImages;
    return urls.map((url) => ({ url, alt: product.title }));
  }, [product]);

  useEffect(() => {
    setSelectedImage(0);
  }, [product?.id]);

  useEffect(() => {
    if (!product || !isAffiliate || product.affiliate_compliance_status !== "compliant") return;
    trackAffiliateEvent(product, "product_view");
  }, [isAffiliate, product]);

  useEffect(() => {
    if (typeof window === "undefined" || !product || isAffiliate) return;
    const storageKey = "pinkpaisa_recently_viewed_products";
    const currentEntry: CatalogProduct = {
      id: product.id,
      slug: product.slug,
      title: product.title,
      short_description: product.short_description,
      full_description: product.full_description,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      image_items: product.image_items,
      featured_image: product.featured_image,
      price: product.price,
      sale_price: product.sale_price,
      sku: product.sku,
      stock_quantity: product.stock_quantity,
      tags: product.tags,
      weight: product.weight,
      dimensions: product.dimensions,
      status: product.status,
      featured: product.featured,
      bestseller: product.bestseller,
      sort_order: product.sort_order,
      is_affiliate: product.is_affiliate,
      affiliate_url: product.affiliate_url,
      createdAt: product.createdAt,
      created_at: product.created_at,
    };

    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as CatalogProduct[];
      const next = [currentEntry, ...stored.filter((item) => item.slug !== currentEntry.slug)].slice(0, 8);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setRecentlyViewed(next.filter((item) => item.slug !== currentEntry.slug));
    } catch {
      setRecentlyViewed([]);
    }
  }, [isAffiliate, product]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto py-16">
          <div className="grid gap-10 md:grid-cols-2">
            <Skeleton className="aspect-square rounded-2xl" />
            <div className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto flex flex-col items-center justify-center py-32 text-center">
          <Package className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h1 className="mb-2 font-serif text-2xl">Product Not Found</h1>
          <p className="mb-6 text-muted-foreground">This product doesn&apos;t exist or has been removed.</p>
          <Button onClick={() => router.push("/products")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Shop
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  const outOfStock = !isAffiliate && product.stock_quantity <= 0;
  const maxQuantity = Math.max(product.stock_quantity - currentCartQuantity, 0);
  const discount = !isAffiliate && product.sale_price ? Math.round(((product.price - product.sale_price) / product.price) * 100) : 0;
  const wished = isWishlisted(product.id);

  const handleAdd = () => {
    if (outOfStock || isAffiliate || quantity <= 0) return;
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
      quantity,
    );
    toast.success(`${product.title} × ${quantity} added to cart`);
  };

  const handleToggleWishlist = async () => {
    try {
      const added = await toggleWishlist({
        id: product.id,
        slug: product.slug,
        title: product.title,
        featured_image: product.featured_image,
        price: product.price,
        sale_price: product.sale_price,
        stock_quantity: product.stock_quantity,
      });
      toast.success(added ? "Added to wishlist" : "Removed from wishlist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update wishlist");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-8 md:py-16">
        {product.breadcrumb?.length ? (
          <nav className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {product.breadcrumb.map((item, index) => (
              <span key={item.href} className="flex items-center gap-2">
                {index > 0 ? <span>/</span> : null}
                {index === product.breadcrumb!.length - 1 ? (
                  <span className="text-foreground">{item.name}</span>
                ) : (
                  <Link href={item.href} className="hover:text-foreground">
                    {item.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        <button
          onClick={() => router.push("/products")}
          className="mb-8 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Shop
        </button>

        <div className="grid gap-8 md:gap-12 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
            <div className="relative mb-4 aspect-square overflow-hidden rounded-2xl bg-accent/30">
              {imageItems.length > 0 ? (
                <img src={imageItems[selectedImage]?.url} alt={imageItems[selectedImage]?.alt || product.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Sparkles className="h-20 w-20 text-muted-foreground/20" />
                </div>
              )}

              <div className="absolute left-4 top-4 flex flex-col gap-2">
                {product.bestseller && !isAffiliate ? (
                  <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                    <Star className="h-3 w-3" /> Bestseller
                  </span>
                ) : null}
                {isAffiliate && product.is_featured_affiliate ? (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                    Editor&apos;s pick
                  </span>
                ) : null}
                {discount > 0 ? (
                  <span className="rounded-full bg-destructive px-3 py-1 text-xs font-bold text-destructive-foreground">
                    {discount}% OFF
                  </span>
                ) : null}
              </div>

              {!isAffiliate ? (
                <button
                  onClick={handleToggleWishlist}
                  className={`absolute right-4 top-4 rounded-full border p-3 transition-colors ${
                    wished ? "border-rose-200 bg-white text-rose-500" : "border-white/80 bg-white/90 text-muted-foreground hover:text-rose-500"
                  }`}
                >
                  <Heart className={`h-4 w-4 ${wished ? "fill-current" : ""}`} />
                </button>
              ) : null}
            </div>

            {imageItems.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {imageItems.map((image, index) => (
                  <button
                    key={`${image.url}-${index}`}
                    onClick={() => setSelectedImage(index)}
                    className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                      selectedImage === index ? "border-primary" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <img src={image.url} alt={image.alt || product.title} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-col"
          >
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary">
              {product.category}
              {product.subcategory ? ` · ${product.subcategory}` : ""}
            </p>
            <h1 className="mb-3 font-serif text-3xl leading-tight md:text-4xl">{product.title}</h1>

            {!isAffiliate || showAffiliateApiPrice ? (
              <div className="mb-6 flex items-baseline gap-3">
                <span className="font-serif text-3xl font-bold text-foreground">
                  {formatPrice(product.sale_price ?? product.price)}
                </span>
                {product.sale_price ? (
                  <>
                    <span className="text-lg text-muted-foreground line-through">{formatPrice(product.price)}</span>
                    <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">
                      Save {formatPrice(product.price - product.sale_price)}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}
            {isAffiliate && showAffiliateApiPrice && affiliatePriceRefreshedAt ? (
              <p className="-mt-4 mb-6 text-xs text-muted-foreground">
                Amazon API data last refreshed {affiliatePriceRefreshedAt}. Confirm final price and availability on Amazon.
              </p>
            ) : null}

            {product.vendor_summary ? (
              <div className="mb-6 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-accent p-2 text-primary">
                    <Store className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sold by</p>
                    <p className="font-medium">{product.vendor_summary.shop_name}</p>
                    {product.vendor_summary.business_name ? (
                      <p className="text-sm text-muted-foreground">{product.vendor_summary.business_name}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {isAffiliate ? (
              <div className="mb-8 rounded-2xl border border-primary/20 bg-primary/5 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Curated Amazon find</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Selected for its fit with the Pink Paisa edit. Open Amazon to confirm the current price,
                  availability, shipping, ratings, and reviews before buying.
                </p>
                <div className="mt-4">
                  <AffiliateCta product={product} size="lg" className="rounded-xl" />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  {outOfStock ? (
                    <span className="text-sm font-medium text-destructive">Out of Stock</span>
                  ) : product.stock_quantity <= 5 ? (
                    <span className="text-sm font-medium text-amber-600">Only {product.stock_quantity} left!</span>
                  ) : (
                    <span className="text-sm font-medium text-emerald-600">In Stock</span>
                  )}
                </div>

                {product.short_description ? (
                  <p className="mb-6 leading-relaxed text-muted-foreground">{product.short_description}</p>
                ) : null}

                <div className="mb-8 flex items-center gap-4">
                  <div className="flex items-center gap-0 rounded-xl border border-border">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                      className="rounded-l-xl p-3 transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center font-medium tabular-nums">{quantity}</span>
                    <button
                      onClick={() => setQuantity(Math.min(maxQuantity || 1, quantity + 1))}
                      disabled={quantity >= maxQuantity}
                      className="rounded-r-xl p-3 transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <Button size="lg" className="flex-1 rounded-xl font-semibold" onClick={handleAdd} disabled={outOfStock || maxQuantity <= 0}>
                    {isInCart ? (
                      <>
                        <Check className="h-4 w-4" /> In Cart - Add More
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="h-4 w-4" /> Add to Cart
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {product.full_description ? (
              <div className="border-t border-border pt-6">
                <h3 className="mb-3 font-serif text-lg">About This Product</h3>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.full_description}</p>
              </div>
            ) : null}

            {isAffiliate && ((product.pros?.length ?? 0) > 0 || (product.cons?.length ?? 0) > 0) ? (
              <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
                {product.pros?.length ? (
                  <div>
                    <h3 className="mb-3 font-serif text-lg">Why it may help</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {product.pros.map((item) => <li key={item}>+ {item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {product.cons?.length ? (
                  <div>
                    <h3 className="mb-3 font-serif text-lg">Consider before buying</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {product.cons.map((item) => <li key={item}>- {item}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {product.tags && product.tags.length > 0 ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {product.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-6 space-y-1 text-xs text-muted-foreground">
              {product.sku ? <p>SKU: {product.sku}</p> : null}
              {product.brand_name ? <p>Brand: {product.brand_name}</p> : null}
              {product.weight != null ? <p>Weight: {product.weight}</p> : null}
              {product.dimensions ? <p>Dimensions: {product.dimensions}</p> : null}
            </div>
          </motion.div>
        </div>

        {product.related_products?.length ? (
          <section className="mt-16">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">You may also like</p>
                <h2 className="mt-2 font-serif text-2xl">Related picks from the same category</h2>
              </div>
              <Link href="/products" className="text-sm font-medium text-primary hover:underline">
                Browse all
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {product.related_products.map((related) => (
                <Link key={related.id} href={`/product/${related.slug}`} className="group overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="aspect-[1.1] overflow-hidden bg-accent/30">
                    {related.featured_image ? (
                      <img src={related.featured_image} alt={related.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{related.category}</p>
                    <h3 className="mt-2 line-clamp-2 font-medium">{related.title}</h3>
                    {related.is_affiliate ? (
                      hasVisibleAffiliatePrice(related) ? (
                        <div className="mt-3 flex flex-col gap-1">
                          <span className="font-semibold text-foreground">{formatPrice(related.sale_price ?? related.price)}</span>
                          <span className="text-xs text-muted-foreground">Confirm on Amazon</span>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">Check price on Amazon</p>
                      )
                    ) : (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="font-semibold text-foreground">{formatPrice(related.sale_price ?? related.price)}</span>
                        {related.sale_price ? <span className="text-xs text-muted-foreground line-through">{formatPrice(related.price)}</span> : null}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {recentlyViewed.length ? (
          <section className="mt-16">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Recently viewed</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {recentlyViewed.slice(0, 4).map((recent) => (
                <Link key={recent.slug} href={`/product/${recent.slug}`} className="group overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="aspect-[1.1] overflow-hidden bg-accent/30">
                    {recent.featured_image ? (
                      <img src={recent.featured_image} alt={recent.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-2 font-medium">{recent.title}</h3>
                    <p className="mt-2 text-sm font-semibold">{formatPrice(recent.sale_price ?? recent.price)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {!isAffiliate && !outOfStock ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{product.title}</p>
              <p className="text-sm font-semibold text-primary">{formatPrice(product.sale_price ?? product.price)}</p>
            </div>
            <Button className="rounded-xl" onClick={handleAdd} disabled={maxQuantity <= 0}>
              <ShoppingCart className="mr-2 h-4 w-4" /> Add to Cart
            </Button>
          </div>
        </div>
      ) : null}

      <Footer />
    </div>
  );
};

export default ProductDetail;
