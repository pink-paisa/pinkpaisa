import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowRight, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import EmptyResults, { type AppliedFilter } from "@/components/storefront/EmptyResults";
import ProductCard from "@/components/storefront/ProductCard";
import ProductFilters from "@/components/storefront/ProductFilters";
import QuickViewDialog from "@/components/storefront/QuickViewDialog";
import SearchAutocomplete from "@/components/storefront/SearchAutocomplete";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/contexts/CartContext";
import { useCatalogFacets } from "@/hooks/useCatalogFacets";
import { useCatalogProducts, type CatalogProduct, type CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { useWishlist, type WishlistProductSummary } from "@/hooks/useWishlist";
import {
  CATALOG_PAGE_SIZE,
  DEFAULT_SORT,
  SORT_OPTIONS,
  activeFilterCount,
  parseCatalogQuery,
} from "@/lib/catalogQuery";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type FilterUpdates = Record<string, string | null>;

const toWishlistProduct = (product: CatalogProduct): WishlistProductSummary => ({
  id: product.id,
  slug: product.slug,
  title: product.title,
  featured_image: product.featured_image,
  price: product.price,
  sale_price: product.sale_price,
  stock_quantity: product.stock_quantity,
  is_affiliate: product.is_affiliate,
  affiliate_url: product.affiliate_url,
  affiliate_data_source: product.affiliate_data_source,
  affiliate_data_last_refreshed_at: product.affiliate_data_last_refreshed_at,
  affiliate_data_expires_at: product.affiliate_data_expires_at,
  price_status: product.price_status,
  price_available: product.price_available,
  affiliate_compliance_status: product.affiliate_compliance_status,
});

const Pill = ({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-foreground hover:bg-accent/60",
    )}
  >
    {label}
    {count != null ? (
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/25 text-primary-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {count}
      </span>
    ) : null}
  </button>
);

const PhysicalProducts = ({
  initialCatalogResponse,
}: {
  initialCatalogResponse?: CatalogProductsResponse;
}) => {
  const router = useRouter();
  const state = useMemo(() => parseCatalogQuery(router.query), [router.query]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<CatalogProduct | null>(null);

  const { data: catalogResponse, isLoading } = useCatalogProducts(
    {
      search: state.search,
      categorySlug: state.categorySlug,
      subcategorySlug: state.subcategorySlug,
      sort: state.sort,
      minPrice: state.minPrice,
      maxPrice: state.maxPrice,
      inStock: state.inStock,
      onSale: state.onSale,
      brands: state.brands,
      page: state.page,
      pageSize: CATALOG_PAGE_SIZE,
    },
    initialCatalogResponse,
  );
  const { data: taxonomy } = useProductTaxonomy();

  // Facet counts are computed against whatever filter is applied, so a single
  // call would zero out every category as soon as one is picked. Three scopes
  // keep each control showing counts for the dimension it controls; React Query
  // collapses them into one request whenever the scopes coincide.
  const { data: globalFacets } = useCatalogFacets({});
  const { data: categoryFacets } = useCatalogFacets({
    search: state.search,
    inStock: state.inStock,
    onSale: state.onSale,
    brands: state.brands,
  });
  const { data: scopedFacets } = useCatalogFacets({
    search: state.search,
    categorySlug: state.categorySlug,
    inStock: state.inStock,
    onSale: state.onSale,
    brands: state.brands,
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
  const activeCategory = categories.find((item) => item.slug === state.categorySlug);
  const activeSubcategory = activeCategory?.subcategories.find((item) => item.slug === state.subcategorySlug);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    (categoryFacets?.categories ?? []).forEach((entry) => {
      if (entry.id) map.set(entry.id, entry.count);
      map.set(entry.name.toLowerCase(), entry.count);
    });
    return map;
  }, [categoryFacets?.categories]);

  const subcategoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    (scopedFacets?.subcategories ?? []).forEach((entry) => {
      if (entry.id) map.set(entry.id, entry.count);
      map.set(entry.name.toLowerCase(), entry.count);
    });
    return map;
  }, [scopedFacets?.subcategories]);

  const catalogTotal = useMemo(
    () => (globalFacets?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0),
    [globalFacets?.categories],
  );
  const allProductsCount = useMemo(
    () => (categoryFacets?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0),
    [categoryFacets?.categories],
  );

  const cartQuantities = useMemo(
    () =>
      items.reduce<Record<string, number>>((acc, item) => {
        acc[item.id] = item.quantity;
        return acc;
      }, {}),
    [items],
  );

  const appliedCount = activeFilterCount(state);
  const hasAnyFilter = appliedCount > 0 || state.sort !== DEFAULT_SORT;

  const updateParams = useCallback(
    (updates: FilterUpdates, options?: { replace?: boolean }) => {
      const nextQuery: Record<string, string> = {};
      Object.entries(router.query).forEach(([key, value]) => {
        const normalized = Array.isArray(value) ? value[0] : value;
        if (typeof normalized === "string" && normalized) nextQuery[key] = normalized;
      });
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all") delete nextQuery[key];
        else nextQuery[key] = value;
      });
      const navigate = options?.replace ? router.replace : router.push;
      void navigate.call(router, { pathname: "/products", query: nextQuery }, undefined, { shallow: true });
    },
    [router],
  );

  const clearFilters = useCallback(() => {
    void router.push({ pathname: "/products", query: {} }, undefined, { shallow: true });
  }, [router]);

  const toggleBrand = useCallback(
    (brandName: string) => {
      const next = state.brands.includes(brandName)
        ? state.brands.filter((brand) => brand !== brandName)
        : [...state.brands, brandName];
      updateParams({ brand: next.length ? next.join(",") : null, page: null });
    },
    [state.brands, updateParams],
  );

  // A stale `page` beyond the last page renders an empty grid that looks like a
  // no-results state, so pull it back once the response says how many exist.
  useEffect(() => {
    if (isLoading || !catalogResponse) return;
    if (totalResults > 0 && state.page > totalPages) {
      updateParams({ page: totalPages > 1 ? String(totalPages) : null }, { replace: true });
    }
  }, [catalogResponse, isLoading, state.page, totalPages, totalResults, updateParams]);

  const handleToggleWishlist = async (product: CatalogProduct) => {
    try {
      const added = await toggleWishlist(toWishlistProduct(product));
      toast.success(added ? "Added to wishlist" : "Removed from wishlist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wishlist update failed");
    }
  };

  const appliedFilters = useMemo<AppliedFilter[]>(() => {
    const chips: AppliedFilter[] = [];
    if (state.search) chips.push({ key: "search", label: `“${state.search}”`, updates: { search: null } });
    if (activeCategory) {
      chips.push({
        key: "category",
        label: activeCategory.name,
        updates: { category: null, subcategory: null },
      });
    }
    if (activeSubcategory) {
      chips.push({ key: "subcategory", label: activeSubcategory.name, updates: { subcategory: null } });
    }
    state.brands.forEach((brand) =>
      chips.push({
        key: `brand:${brand}`,
        label: brand,
        updates: { brand: state.brands.filter((entry) => entry !== brand).join(",") || null },
      }),
    );
    if (state.inStock) chips.push({ key: "in_stock", label: "In stock", updates: { in_stock: null } });
    if (state.onSale) chips.push({ key: "on_sale", label: "On sale", updates: { on_sale: null } });
    if (state.minPrice != null) {
      chips.push({ key: "min_price", label: `Min ₹${state.minPrice}`, updates: { min_price: null } });
    }
    if (state.maxPrice != null) {
      chips.push({ key: "max_price", label: `Max ₹${state.maxPrice}`, updates: { max_price: null } });
    }
    return chips;
  }, [activeCategory, activeSubcategory, state]);

  const filterPanel = (
    <ProductFilters
      taxonomy={taxonomy}
      categoryFacets={categoryFacets}
      scopedFacets={scopedFacets}
      state={state}
      onUpdate={updateParams}
      onToggleBrand={toggleBrand}
      onClear={clearFilters}
    />
  );

  const rangeStart = totalResults === 0 ? 0 : (state.page - 1) * CATALOG_PAGE_SIZE + 1;
  const rangeEnd = Math.min(state.page * CATALOG_PAGE_SIZE, totalResults);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container mx-auto max-w-full">
        <header className="py-7 md:py-9">
          <nav aria-label="Breadcrumb" className="mb-3.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link href="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <span aria-hidden className="text-border">/</span>
            {activeCategory ? (
              <>
                <Link href="/products" className="transition-colors hover:text-foreground">
                  Wellness Products
                </Link>
                <span aria-hidden className="text-border">/</span>
                {activeSubcategory ? (
                  <>
                    <Link
                      href={`/products?category=${encodeURIComponent(activeCategory.slug)}`}
                      className="transition-colors hover:text-foreground"
                    >
                      {activeCategory.name}
                    </Link>
                    <span aria-hidden className="text-border">/</span>
                    <span className="font-medium text-foreground">{activeSubcategory.name}</span>
                  </>
                ) : (
                  <span className="font-medium text-foreground">{activeCategory.name}</span>
                )}
              </>
            ) : (
              <span className="font-medium text-foreground">Wellness Products</span>
            )}
          </nav>

          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-primary md:text-xs">
            {activeCategory ? activeCategory.name : "Curated wellness edit"}
          </p>
          <h1 className="mb-2.5 max-w-3xl font-serif text-3xl leading-tight md:text-[2.75rem]">
            {activeSubcategory?.name || activeCategory?.name || "Curated Products for Your Journey"}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {activeSubcategory?.description ||
              activeCategory?.description ||
              "Wellness, self-growth and financial empowerment — hand-picked for women, reviewed by the Pink Paisa team."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {catalogTotal > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                {catalogTotal} hand-picked products
              </span>
            ) : null}
            {globalFacets?.brands?.length ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-sage" aria-hidden />
                {globalFacets.brands.length} brands
              </span>
            ) : null}
            <Link
              href="/wellness"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Explore wellness guides <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <div className="sticky top-14 z-30 -mx-4 border-y border-border bg-card/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,32rem)_auto] lg:items-center lg:justify-between">
            <SearchAutocomplete
              value={state.search}
              taxonomy={taxonomy}
              placeholder={
                activeCategory
                  ? `Search within ${activeCategory.name}...`
                  : catalogTotal
                    ? `Search ${catalogTotal} wellness products, brands or concerns...`
                    : "Search wellness products, brands or concerns..."
              }
              onSearch={(term) => updateParams({ search: term || null, page: null }, { replace: true })}
              onNavigate={(updates) => updateParams(updates)}
            />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 lg:flex">
              <Button
                variant="outline"
                className={cn(
                  "h-10 shrink-0 rounded-full px-4 lg:hidden",
                  appliedCount > 0 && "border-primary text-primary",
                )}
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filters
                {appliedCount > 0 ? (
                  <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {appliedCount}
                  </span>
                ) : null}
              </Button>
              <Select
                value={state.sort}
                onValueChange={(value) => updateParams({ sort: value === DEFAULT_SORT ? null : value, page: null })}
              >
                <SelectTrigger className="w-full rounded-full lg:w-52" aria-label="Sort products">
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
        </div>

        <div className="-mx-4 mt-5 overflow-x-auto px-4 pb-1 scrollbar-hidden sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <div className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
            <Pill
              label="All products"
              count={allProductsCount || undefined}
              active={state.categorySlug === "all"}
              onClick={() => updateParams({ category: null, subcategory: null, page: null })}
            />
            {categories.map((category) => (
              <Pill
                key={category.id}
                label={category.name}
                count={categoryCounts.get(category.id) ?? categoryCounts.get(category.name.toLowerCase())}
                active={state.categorySlug === category.slug}
                onClick={() => updateParams({ category: category.slug, subcategory: null, page: null })}
              />
            ))}
          </div>
        </div>

        {activeCategory && activeCategory.subcategories.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-border bg-card p-3.5">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              Browse {activeCategory.name}
            </p>
            <div className="-mx-3 overflow-x-auto px-3 pb-1 scrollbar-hidden">
              <div className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
                <Pill
                  label={`All ${activeCategory.name}`}
                  count={categoryCounts.get(activeCategory.id) ?? undefined}
                  active={state.subcategorySlug === "all"}
                  onClick={() => updateParams({ subcategory: null, page: null })}
                />
                {activeCategory.subcategories
                  .filter((subcategory) => subcategory.is_active)
                  .map((subcategory) => (
                    <Pill
                      key={subcategory.id}
                      label={subcategory.name}
                      count={
                        subcategoryCounts.get(subcategory.id) ?? subcategoryCounts.get(subcategory.name.toLowerCase())
                      }
                      active={state.subcategorySlug === subcategory.slug}
                      onClick={() => updateParams({ subcategory: subcategory.slug, page: null })}
                    />
                  ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid min-w-0 gap-7 pb-14 lg:grid-cols-[264px,minmax(0,1fr)]">
          <aside className="hidden self-start rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-32 lg:block">
            {filterPanel}
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {isLoading
                    ? "Loading products..."
                    : totalResults === 0
                      ? "No products found"
                      : `Showing ${rangeStart}–${rangeEnd} of ${totalResults} products`}
                </p>
                {!isLoading && totalResults > 0 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {appliedCount > 0
                      ? `Narrowed from ${catalogTotal || totalResults} by ${appliedCount} ${appliedCount === 1 ? "filter" : "filters"}`
                      : "Every pick links out to Amazon.in for live pricing"}
                  </p>
                ) : null}
              </div>

              {appliedFilters.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {appliedFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => updateParams({ ...filter.updates, page: null })}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent/70"
                    >
                      {filter.label}
                      <X className="h-3 w-3" aria-hidden />
                      <span className="sr-only">Remove filter</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              ) : null}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-80 rounded-2xl" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <EmptyResults
                state={state}
                appliedFilters={appliedFilters}
                taxonomy={taxonomy}
                globalFacets={globalFacets}
                onUpdate={updateParams}
                onClear={clearFilters}
              />
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
                      onQuickView={setQuickViewProduct}
                    />
                  ))}

                  {/* A handful of results usually means the filters are too tight —
                      offer the way back out rather than a half-empty row. */}
                  {hasAnyFilter && totalResults > 0 && totalResults < 4 ? (
                    <div className="flex flex-col justify-center gap-2.5 rounded-2xl border border-dashed border-border bg-background p-5">
                      <p className="text-sm font-semibold">Only {totalResults} matches</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Widen your search to see more of the catalog.
                      </p>
                      {activeSubcategory && activeCategory ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full rounded-full bg-card text-xs"
                          onClick={() => updateParams({ subcategory: null, page: null })}
                        >
                          All {activeCategory.name}
                          {categoryCounts.get(activeCategory.id) ? ` (${categoryCounts.get(activeCategory.id)})` : ""}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full rounded-full bg-card text-xs"
                        onClick={clearFilters}
                      >
                        Clear all filters{catalogTotal ? ` (${catalogTotal})` : ""}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {totalPages > 1 ? (
                  <nav className="mt-9 flex items-center justify-center gap-2" aria-label="Pagination">
                    <Button
                      variant="outline"
                      className="rounded-full"
                      disabled={state.page <= 1}
                      onClick={() => updateParams({ page: state.page > 2 ? String(state.page - 1) : null })}
                    >
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>
                    <span className="px-2 text-sm text-muted-foreground">
                      Page {state.page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      disabled={state.page >= totalPages}
                      onClick={() => updateParams({ page: String(state.page + 1) })}
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </nav>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col rounded-t-3xl p-0 sm:max-w-none">
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2">
              Filters
              {appliedCount > 0 ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                  {appliedCount} applied
                </span>
              ) : null}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">{filterPanel}</div>
          <div className="flex items-center gap-2.5 border-t border-border px-4 py-3.5">
            <Button variant="outline" className="rounded-full" onClick={clearFilters} disabled={appliedCount === 0}>
              Clear all
            </Button>
            <Button className="flex-1 rounded-full" onClick={() => setFiltersOpen(false)}>
              Show {totalResults} {totalResults === 1 ? "product" : "products"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <QuickViewDialog
        product={quickViewProduct}
        open={Boolean(quickViewProduct)}
        onOpenChange={(open) => {
          if (!open) setQuickViewProduct(null);
        }}
        wished={quickViewProduct ? isWishlisted(quickViewProduct.id) : false}
        onToggleWishlist={handleToggleWishlist}
      />

      <Footer />
    </div>
  );
};

export default PhysicalProducts;
