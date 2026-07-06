import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Check, Heart, Search, ShoppingCart, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import ProductFilters from "@/components/storefront/ProductFilters";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/contexts/CartContext";
import { useCatalogFacets } from "@/hooks/useCatalogFacets";
import {
  useCatalogProducts,
  type CatalogProduct,
  type CatalogProductsResponse,
} from "@/hooks/useCatalogProducts";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { useWishlist, type WishlistProductSummary } from "@/hooks/useWishlist";
import { formatAffiliateDataRefreshTime, hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";
import { toast } from "sonner";

const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

const formatPrice = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const getQueryValue = (value: string | string[] | undefined, fallback = "") =>
  Array.isArray(value) ? value[0] || fallback : value || fallback;

const parseQueryNumber = (value: string | string[] | undefined) => {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseQueryBoolean = (value: string | string[] | undefined) => {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized === "true";
};

const parseQueryBrands = (value: string | string[] | undefined) => {
  const normalized = Array.isArray(value) ? value[0] : value;
  return String(normalized || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const toWishlistProduct = (product: CatalogProduct): WishlistProductSummary => ({
  id: product.id,
  slug: product.slug,
  title: product.title,
  featured_image: product.featured_image,
  price: product.price,
  sale_price: product.sale_price,
  stock_quantity: product.stock_quantity,
});

const ProductCard = ({
  product,
  wished,
  cartQuantity,
  onToggleWishlist,
}: {
  product: CatalogProduct;
  wished: boolean;
  cartQuantity: number;
  onToggleWishlist: (product: CatalogProduct) => void;
}) => {
  const { addItem } = useCart();
  const isAffiliate = Boolean(product.is_affiliate && product.affiliate_url);
  const showAffiliateApiPrice = hasVisibleAffiliatePrice(product);
  const affiliatePriceRefreshedAt = formatAffiliateDataRefreshTime(product);
  const isInCart = !isAffiliate && cartQuantity > 0;
  const outOfStock = !isAffiliate && product.stock_quantity <= 0;
  const quantityReachedCap = !isAffiliate && cartQuantity >= product.stock_quantity && product.stock_quantity > 0;

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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-lg hover:shadow-primary/8"
    >
      <Link href={`/product/${product.slug}`} className="relative aspect-square overflow-hidden bg-accent/30">
          {product.featured_image ? (
            <img src={product.featured_image} alt={product.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute left-2 top-2 flex flex-col gap-1.5 sm:left-3 sm:top-3">
            {product.bestseller && !isAffiliate ? (
              <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-foreground sm:px-2.5 sm:py-1 sm:text-[10px]">
                <Star className="h-3 w-3" /> Bestseller
              </span>
            ) : null}
            {isAffiliate && product.is_featured_affiliate ? (
              <span className="rounded-full bg-background/95 px-2 py-0.5 text-[9px] font-bold text-primary shadow-sm sm:px-2.5 sm:py-1 sm:text-[10px]">Editor&apos;s pick</span>
            ) : null}
            {product.featured && !product.bestseller && !isAffiliate ? (
              <span className="rounded-full bg-background/95 px-2 py-0.5 text-[9px] font-bold text-primary shadow-sm sm:px-2.5 sm:py-1 sm:text-[10px]">Featured</span>
            ) : null}
            {!isAffiliate && product.sale_price ? (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-[9px] font-bold text-destructive-foreground sm:px-2.5 sm:py-1 sm:text-[10px]">Sale</span>
            ) : null}
            {isAffiliate ? (
              <span className="rounded-full bg-background/95 px-2 py-0.5 text-[9px] font-bold text-primary shadow-sm sm:px-2.5 sm:py-1 sm:text-[10px]">Curated find</span>
            ) : null}
          </div>
          {outOfStock ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
              <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground">Out of Stock</span>
            </div>
          ) : null}
        </Link>

      <button
        onClick={() => onToggleWishlist(product)}
        aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
        className={`absolute right-2 top-2 rounded-full border p-2 backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-3 sm:top-3 sm:p-2.5 ${
          wished ? "border-rose-200 bg-white text-rose-500" : "border-white/70 bg-white/85 text-muted-foreground hover:text-rose-500"
        }`}
      >
        <Heart className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${wished ? "fill-current" : ""}`} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        <p className="mb-1 line-clamp-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary sm:text-[10px]">
          {product.category}
          {product.subcategory ? ` · ${product.subcategory}` : ""}
        </p>

        <Link href={`/product/${product.slug}`}>
          <h3 className="mb-1.5 line-clamp-2 min-h-[2.35rem] font-serif text-base leading-tight transition-colors hover:text-primary sm:min-h-[2.5rem] sm:text-lg">{product.title}</h3>
        </Link>

        {product.short_description ? <p className="mb-3 hidden line-clamp-2 text-sm text-muted-foreground sm:block">{product.short_description}</p> : null}

        <div className={isAffiliate ? "mt-auto space-y-2 sm:space-y-3" : "mt-auto space-y-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0"}>
          {isAffiliate ? (
            showAffiliateApiPrice ? (
              <div className="w-full">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-serif text-base font-bold text-foreground sm:text-xl">{formatPrice(product.sale_price ?? product.price)}</span>
                  {product.sale_price ? <span className="text-xs text-muted-foreground line-through sm:text-sm">{formatPrice(product.price)}</span> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {affiliatePriceRefreshedAt ? `Updated ${affiliatePriceRefreshedAt}. ` : ""}Confirm on Amazon.
                </p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">Confirm price and availability on Amazon.</p>
            )
          ) : (
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-serif text-base font-bold text-foreground sm:text-xl">{formatPrice(product.sale_price ?? product.price)}</span>
                {product.sale_price ? <span className="text-xs text-muted-foreground line-through sm:text-sm">{formatPrice(product.price)}</span> : null}
              </div>
            </div>
          )}

          {isAffiliate ? (
            <AffiliateCta product={product} label="View on Amazon" size="sm" variant="secondary" className="w-full rounded-full px-2 text-[11px] sm:px-3 sm:text-xs" />
          ) : (
            <Button
              size="sm"
              variant={isInCart ? "secondary" : "default"}
              className="h-8 w-full rounded-full px-2.5 text-xs sm:h-9 sm:w-auto sm:px-3"
              onClick={handleAdd}
              disabled={outOfStock || quantityReachedCap}
            >
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
    </motion.div>
  );
};

const PhysicalProducts = ({
  initialCatalogResponse,
}: {
  initialCatalogResponse?: CatalogProductsResponse;
}) => {
  const router = useRouter();
  const searchTerm = getQueryValue(router.query.search, "");
  const categorySlug = getQueryValue(router.query.category, "all");
  const subcategorySlug = getQueryValue(router.query.subcategory, "all");
  const sort = getQueryValue(router.query.sort, "popular");
  const page = Math.max(Number(getQueryValue(router.query.page, "1")) || 1, 1);
  const minPrice = parseQueryNumber(router.query.min_price);
  const maxPrice = parseQueryNumber(router.query.max_price);
  const inStock = parseQueryBoolean(router.query.in_stock);
  const onSale = parseQueryBoolean(router.query.on_sale);
  const selectedBrands = parseQueryBrands(router.query.brand);

  const [search, setSearch] = useState(searchTerm);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: catalogResponse, isLoading } = useCatalogProducts(
    {
      search: searchTerm,
      categorySlug,
      subcategorySlug,
      sort,
      minPrice,
      maxPrice,
      inStock,
      onSale,
      brands: selectedBrands,
      page,
      pageSize: 24,
    },
    initialCatalogResponse,
  );
  const { data: taxonomy } = useProductTaxonomy();
  const { data: facets } = useCatalogFacets({
    search: searchTerm,
    categorySlug,
    subcategorySlug,
    minPrice,
    maxPrice,
    inStock,
    onSale,
    brands: selectedBrands,
  });
  const { items } = useCart();
  const { toggleWishlist, isWishlisted } = useWishlist();

  const products = catalogResponse?.items ?? [];
  const totalPages = Math.max(catalogResponse?.totalPages || 1, 1);
  const totalResults = catalogResponse?.total || 0;

  const categories = useMemo(
    () => (taxonomy ?? []).filter((item) => item.slug !== "uncategorized" && item.is_active),
    [taxonomy],
  );
  const activeCategory = categories.find((item) => item.slug === categorySlug);
  const visibleSubcategories = activeCategory?.subcategories ?? [];
  const cartQuantities = useMemo(
    () =>
      items.reduce<Record<string, number>>((acc, item) => {
        acc[item.id] = item.quantity;
        return acc;
      }, {}),
    [items],
  );

  const hasActiveFilters = Boolean(
    searchTerm ||
      categorySlug !== "all" ||
      subcategorySlug !== "all" ||
      sort !== "popular" ||
      minPrice != null ||
      maxPrice != null ||
      inStock ||
      onSale ||
      selectedBrands.length,
  );

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const nextQuery: Record<string, string> = {};

      Object.entries(router.query).forEach(([key, value]) => {
        const normalized = Array.isArray(value) ? value[0] : value;
        if (typeof normalized === "string" && normalized) nextQuery[key] = normalized;
      });

      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all") delete nextQuery[key];
        else nextQuery[key] = value;
      });

      router.push({ pathname: "/products", query: nextQuery }, undefined, { shallow: true });
    },
    [router],
  );

  useEffect(() => {
    setSearch(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (normalizedSearch === searchTerm) return;
    const timer = window.setTimeout(() => {
      updateParams({ search: normalizedSearch || null, page: null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, searchTerm, updateParams]);

  useEffect(() => {
    if (isLoading || !catalogResponse) return;
    if (totalResults > 0 && page > totalPages) {
      updateParams({ page: totalPages > 1 ? String(totalPages) : null });
    }
  }, [catalogResponse, isLoading, page, totalPages, totalResults, updateParams]);

  const goToPage = (nextPage: number) => {
    updateParams({ page: nextPage > 1 ? String(nextPage) : null });
  };

  const toggleBrand = (brandName: string) => {
    const nextBrands = selectedBrands.includes(brandName)
      ? selectedBrands.filter((brand) => brand !== brandName)
      : [...selectedBrands, brandName];
    updateParams({ brand: nextBrands.length ? nextBrands.join(",") : null, page: null });
  };

  const clearFilters = () => {
    setSearch("");
    router.push({ pathname: "/products", query: {} }, undefined, { shallow: true });
  };

  const handleToggleWishlist = async (product: CatalogProduct) => {
    try {
      const added = await toggleWishlist(toWishlistProduct(product));
      toast.success(added ? "Added to wishlist" : "Removed from wishlist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wishlist update failed");
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Navbar />
      <div className="container mx-auto max-w-full py-6 md:py-10">
        <div className="mb-6 max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary md:text-sm">Wellness Products</p>
          <h1 className="mb-2 max-w-full font-serif text-2xl leading-tight md:text-4xl">Curated Products for Your Journey</h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">Wellness, self-growth & financial empowerment - handpicked for you.</p>
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(18rem,28rem)_auto] lg:items-center lg:justify-between">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 lg:flex">
            <Button variant="outline" className="h-10 rounded-full px-4 lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
            </Button>
            <Select value={sort} onValueChange={(value) => updateParams({ sort: value === "popular" ? null : value, page: null })}>
              <SelectTrigger className="w-full rounded-full lg:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 scrollbar-hidden sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <div className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
            <button
              onClick={() => updateParams({ category: null, subcategory: null, page: null })}
              aria-pressed={categorySlug === "all"}
              className={`min-h-9 shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                categorySlug === "all" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
              }`}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => updateParams({ category: category.slug, subcategory: null, page: null })}
                aria-pressed={categorySlug === category.slug}
                className={`min-h-9 shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  categorySlug === category.slug ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {activeCategory && visibleSubcategories.length > 0 ? (
          <div className="mb-5 rounded-lg border border-border bg-card p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Subcategories in {activeCategory.name}
            </p>
            <div className="-mx-3 overflow-x-auto px-3 pb-1 scrollbar-hidden">
              <div className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
                <button
                  onClick={() => updateParams({ subcategory: null, page: null })}
                  aria-pressed={subcategorySlug === "all"}
                  className={`min-h-9 shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    subcategorySlug === "all" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
                  }`}
                >
                  All {activeCategory.name}
                </button>
                {visibleSubcategories.map((subcategory) => (
                  <button
                    key={subcategory.id}
                    onClick={() => updateParams({ subcategory: subcategory.slug, page: null })}
                    aria-pressed={subcategorySlug === subcategory.slug}
                    className={`min-h-9 shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      subcategorySlug === subcategory.slug ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
                    }`}
                  >
                    {subcategory.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-6 lg:grid-cols-[240px,minmax(0,1fr)]">
          <aside className="hidden self-start rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20 lg:block">
            <ProductFilters
              facets={facets}
              minPrice={minPrice}
              maxPrice={maxPrice}
              inStock={inStock}
              onSale={onSale}
              selectedBrands={selectedBrands}
              hasActiveFilters={hasActiveFilters}
              onMinPriceChange={(value) => updateParams({ min_price: value != null ? String(value) : null, page: null })}
              onMaxPriceChange={(value) => updateParams({ max_price: value != null ? String(value) : null, page: null })}
              onInStockChange={(value) => updateParams({ in_stock: value ? "true" : null, page: null })}
              onOnSaleChange={(value) => updateParams({ on_sale: value ? "true" : null, page: null })}
              onToggleBrand={toggleBrand}
              onClear={clearFilters}
            />
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {isLoading ? "Loading products..." : `${totalResults} products found`}
              </p>
              {hasActiveFilters ? (
                <Button variant="ghost" size="sm" className="rounded-full lg:hidden" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map((item) => (
                  <Skeleton key={item} className="h-72 rounded-lg sm:h-80" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground">
                <Sparkles className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>No products found</p>
                {hasActiveFilters ? (
                  <Button variant="outline" className="mt-4 rounded-xl" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      wished={isWishlisted(product.id)}
                      cartQuantity={cartQuantities[product.id] || 0}
                      onToggleWishlist={handleToggleWishlist}
                    />
                  ))}
                </div>

                {totalPages > 1 ? (
                  <div className="mt-8 flex items-center justify-center gap-3">
                    <Button variant="outline" className="rounded-xl" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button variant="outline" className="rounded-xl" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                      Next
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filter products</SheetTitle>
          </SheetHeader>
          <div className="mt-6 pb-6">
            <ProductFilters
              facets={facets}
              minPrice={minPrice}
              maxPrice={maxPrice}
              inStock={inStock}
              onSale={onSale}
              selectedBrands={selectedBrands}
              hasActiveFilters={hasActiveFilters}
              onMinPriceChange={(value) => updateParams({ min_price: value != null ? String(value) : null, page: null })}
              onMaxPriceChange={(value) => updateParams({ max_price: value != null ? String(value) : null, page: null })}
              onInStockChange={(value) => updateParams({ in_stock: value ? "true" : null, page: null })}
              onOnSaleChange={(value) => updateParams({ on_sale: value ? "true" : null, page: null })}
              onToggleBrand={toggleBrand}
              onClear={clearFilters}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Footer />
    </div>
  );
};

export default PhysicalProducts;
