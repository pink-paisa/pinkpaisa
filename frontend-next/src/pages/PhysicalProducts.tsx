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
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-xl hover:shadow-primary/8"
    >
      <Link href={`/product/${product.slug}`} className="relative aspect-square overflow-hidden bg-accent/30">
          {product.featured_image ? (
            <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute left-3 top-3 flex flex-col gap-1.5">
            {product.bestseller && !isAffiliate ? (
              <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                <Star className="h-3 w-3" /> Bestseller
              </span>
            ) : null}
            {isAffiliate && product.is_featured_affiliate ? (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">Featured pick</span>
            ) : null}
            {product.featured && !product.bestseller && !isAffiliate ? (
              <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold text-accent-foreground">Featured</span>
            ) : null}
            {!isAffiliate && product.sale_price ? (
              <span className="rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground">Sale</span>
            ) : null}
            {isAffiliate ? (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">Amazon pick</span>
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
        className={`absolute right-3 top-3 rounded-full border p-2 backdrop-blur-sm transition-colors ${
          wished ? "border-rose-200 bg-white text-rose-500" : "border-white/70 bg-white/85 text-muted-foreground hover:text-rose-500"
        }`}
      >
        <Heart className={`h-4 w-4 ${wished ? "fill-current" : ""}`} />
      </button>

      <div className="flex flex-1 flex-col p-4 md:p-5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          {product.category}
          {product.subcategory ? ` · ${product.subcategory}` : ""}
        </p>

        <Link href={`/product/${product.slug}`}>
          <h3 className="mb-2 font-serif text-lg leading-tight transition-colors hover:text-primary">{product.title}</h3>
        </Link>

        {product.short_description ? <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{product.short_description}</p> : null}

        <div className="mt-auto flex items-center justify-between gap-3">
          {isAffiliate ? (
            <p className="max-w-[11rem] text-xs leading-5 text-muted-foreground">Amazon price and availability are checked on Amazon.</p>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-xl font-bold text-foreground">{formatPrice(product.sale_price ?? product.price)}</span>
              {product.sale_price ? <span className="text-sm text-muted-foreground line-through">{formatPrice(product.price)}</span> : null}
            </div>
          )}

          {isAffiliate ? (
            <AffiliateCta product={product} size="sm" variant="secondary" className="rounded-xl" />
          ) : (
            <Button
              size="sm"
              variant={isInCart ? "secondary" : "default"}
              className="rounded-xl"
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
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-10 md:py-16">
        <div className="mb-10 max-w-3xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary">Wellness Products</p>
          <h1 className="mb-3 font-serif text-3xl leading-tight md:text-4xl">Curated Products for Your Journey</h1>
          <p className="text-lg text-muted-foreground">Wellness, self-growth & financial empowerment - handpicked for you.</p>
        </div>

        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
            </Button>
            <Select value={sort} onValueChange={(value) => updateParams({ sort: value === "popular" ? null : value, page: null })}>
              <SelectTrigger className="w-52">
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

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => updateParams({ category: null, subcategory: null, page: null })}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              categorySlug === "all" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
            }`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => updateParams({ category: category.slug, subcategory: null, page: null })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                categorySlug === category.slug ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {activeCategory && visibleSubcategories.length > 0 ? (
          <div className="mb-8 rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Subcategories in {activeCategory.name}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => updateParams({ subcategory: null, page: null })}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  subcategorySlug === "all" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
                }`}
              >
                All {activeCategory.name}
              </button>
              {visibleSubcategories.map((subcategory) => (
                <button
                  key={subcategory.id}
                  onClick={() => updateParams({ subcategory: subcategory.slug, page: null })}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    subcategorySlug === subcategory.slug ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
                  }`}
                >
                  {subcategory.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[280px,minmax(0,1fr)]">
          <aside className="hidden rounded-3xl border border-border bg-card p-5 lg:block">
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

          <div>
            <div className="mb-5 flex items-center justify-between">
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
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((item) => (
                  <Skeleton key={item} className="h-96 rounded-2xl" />
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
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
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
          <div className="mt-6">
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
