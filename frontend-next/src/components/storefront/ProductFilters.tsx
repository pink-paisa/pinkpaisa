import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { CatalogFacetResponse } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode } from "@/hooks/useProductTaxonomy";
import { activeFilterCount, formatCatalogPrice, type CatalogFilterState } from "@/lib/catalogQuery";
import { cn } from "@/lib/utils";

type FilterUpdates = Record<string, string | null>;

type ProductFiltersProps = {
  taxonomy?: ProductCategoryNode[];
  /** Counts that ignore the category/subcategory selection, so the category list stays navigable. */
  categoryFacets?: CatalogFacetResponse;
  /** Counts within the active category, driving subcategory and brand rows. */
  scopedFacets?: CatalogFacetResponse;
  state: CatalogFilterState;
  onUpdate: (updates: FilterUpdates) => void;
  onToggleBrand: (brandName: string) => void;
  onClear: () => void;
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{children}</p>
);

const CountBadge = ({ value }: { value: number }) => (
  <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{value}</span>
);

/**
 * The theme sets `--radius: 0.75rem`, which makes Tailwind's `rounded-sm` 8px —
 * enough to round a 16px checkbox into a circle and make it read as a radio.
 * Multi-select controls stay square so they are distinguishable from the
 * single-select category list.
 */
const SquareCheckbox = (props: React.ComponentProps<typeof Checkbox>) => (
  <Checkbox {...props} className={cn("rounded-[3px]", props.className)} />
);

const BRAND_PREVIEW_COUNT = 6;

const ProductFilters = ({
  taxonomy,
  categoryFacets,
  scopedFacets,
  state,
  onUpdate,
  onToggleBrand,
  onClear,
}: ProductFiltersProps) => {
  const [brandQuery, setBrandQuery] = useState("");
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [showAllSubcategories, setShowAllSubcategories] = useState(false);

  const categories = useMemo(
    () => (taxonomy ?? []).filter((item) => item.slug !== "uncategorized" && item.is_active),
    [taxonomy],
  );

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

  const countForCategory = (category: ProductCategoryNode) =>
    categoryCounts.get(category.id) ?? categoryCounts.get(category.name.toLowerCase()) ?? 0;

  const totalAcrossCategories = useMemo(
    () => (categoryFacets?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0),
    [categoryFacets?.categories],
  );

  const activeCategory = categories.find((item) => item.slug === state.categorySlug);

  // Inside a category, offer that category's own subcategories. Otherwise surface
  // the busiest ones across the whole result set as an entry point.
  const subcategoryOptions = useMemo(() => {
    if (activeCategory) {
      return activeCategory.subcategories
        .filter((item) => item.is_active)
        .map((item) => ({
          key: item.id,
          slug: item.slug,
          name: item.name,
          count: subcategoryCounts.get(item.id) ?? subcategoryCounts.get(item.name.toLowerCase()) ?? 0,
        }));
    }
    const bySlug = new Map<string, string>();
    categories.forEach((category) =>
      category.subcategories.forEach((sub) => bySlug.set(sub.name.toLowerCase(), sub.slug)),
    );
    return (categoryFacets?.subcategories ?? [])
      .map((entry) => ({
        key: entry.id ?? entry.name,
        slug: bySlug.get(entry.name.toLowerCase()) ?? "",
        name: entry.name,
        count: entry.count,
      }))
      .filter((entry) => entry.slug)
      .sort((a, b) => b.count - a.count);
  }, [activeCategory, categories, categoryFacets?.subcategories, subcategoryCounts]);

  const visibleSubcategories = showAllSubcategories ? subcategoryOptions : subcategoryOptions.slice(0, 5);

  const brands = scopedFacets?.brands ?? [];
  const filteredBrands = useMemo(() => {
    const query = brandQuery.trim().toLowerCase();
    const matches = query ? brands.filter((brand) => brand.name.toLowerCase().includes(query)) : brands;
    // Keep already-selected brands reachable even when they fall outside the preview.
    const selected = matches.filter((brand) => state.brands.includes(brand.name));
    const rest = matches.filter((brand) => !state.brands.includes(brand.name));
    return [...selected, ...rest];
  }, [brandQuery, brands, state.brands]);

  const visibleBrands = showAllBrands || brandQuery ? filteredBrands : filteredBrands.slice(0, BRAND_PREVIEW_COUNT);

  const priceBuckets = scopedFacets?.price_buckets ?? [];
  const supportsPriceFilter = priceBuckets.length > 0;
  const sliderMax = useMemo(() => {
    const highest = priceBuckets.reduce((max, bucket) => Math.max(max, bucket.max ?? bucket.min), 0);
    return Math.max(highest, 1000);
  }, [priceBuckets]);

  const appliedCount = activeFilterCount(state);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Filters</h3>
          <p className="text-xs leading-5 text-muted-foreground">Narrow the catalog to what fits you best.</p>
        </div>
        {appliedCount > 0 ? (
          <Button variant="ghost" size="sm" className="shrink-0 rounded-full text-xs" onClick={onClear}>
            Clear {appliedCount}
          </Button>
        ) : null}
      </div>

      <div className="h-px w-full bg-border" />

      <section className="space-y-2.5">
        <SectionLabel>Category</SectionLabel>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onUpdate({ category: null, subcategory: null, page: null })}
            aria-pressed={state.categorySlug === "all"}
            className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-1 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  state.categorySlug === "all" ? "border-primary bg-primary" : "border-border bg-card",
                )}
              >
                {state.categorySlug === "all" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                ) : null}
              </span>
              <span className={cn("truncate", state.categorySlug === "all" ? "font-semibold" : "text-muted-foreground")}>
                All products
              </span>
            </span>
            <CountBadge value={totalAcrossCategories} />
          </button>

          {categories.map((category) => {
            const selected = state.categorySlug === category.slug;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onUpdate({ category: category.slug, subcategory: null, page: null })}
                aria-pressed={selected}
                className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-1 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-primary bg-primary" : "border-border bg-card",
                    )}
                  >
                    {selected ? <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" /> : null}
                  </span>
                  <span className={cn("truncate", selected ? "font-semibold" : "text-muted-foreground")}>
                    {category.name}
                  </span>
                </span>
                <CountBadge value={countForCategory(category)} />
              </button>
            );
          })}
        </div>
      </section>

      {subcategoryOptions.length > 0 ? (
        <>
          <div className="h-px w-full bg-border" />
          <section className="space-y-2.5">
            <SectionLabel>
              {activeCategory ? `Subcategory in ${activeCategory.name}` : "Popular subcategories"}
            </SectionLabel>
            <div className="space-y-1">
              {visibleSubcategories.map((subcategory) => {
                const selected = state.subcategorySlug === subcategory.slug;
                return (
                  <label
                    key={subcategory.key}
                    className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-1 text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <SquareCheckbox
                        checked={selected}
                        onCheckedChange={() =>
                          onUpdate({
                            category: activeCategory ? activeCategory.slug : state.categorySlug,
                            subcategory: selected ? null : subcategory.slug,
                            page: null,
                          })
                        }
                      />
                      <span className={cn("truncate", selected ? "font-medium" : "text-muted-foreground")}>
                        {subcategory.name}
                      </span>
                    </span>
                    <CountBadge value={subcategory.count} />
                  </label>
                );
              })}
            </div>
            {subcategoryOptions.length > 5 ? (
              <button
                type="button"
                onClick={() => setShowAllSubcategories((value) => !value)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {showAllSubcategories ? "Show fewer" : `Show all ${subcategoryOptions.length} subcategories`}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {brands.length > 0 ? (
        <>
          <div className="h-px w-full bg-border" />
          <section className="space-y-2.5">
            <SectionLabel>Brand</SectionLabel>
            {brands.length > BRAND_PREVIEW_COUNT ? (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={brandQuery}
                  onChange={(event) => setBrandQuery(event.target.value)}
                  placeholder={`Search ${brands.length} brands...`}
                  aria-label="Search brands"
                  className="h-9 rounded-full pl-8 text-xs"
                />
              </div>
            ) : null}
            <div className="space-y-1">
              {visibleBrands.map((brand) => {
                const selected = state.brands.includes(brand.name);
                return (
                  <label
                    key={brand.name}
                    className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-1 text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <SquareCheckbox checked={selected} onCheckedChange={() => onToggleBrand(brand.name)} />
                      <span className={cn("truncate", selected ? "font-medium" : "text-muted-foreground")}>
                        {brand.name}
                      </span>
                    </span>
                    <CountBadge value={brand.count} />
                  </label>
                );
              })}
              {visibleBrands.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No brands match “{brandQuery}”.</p>
              ) : null}
            </div>
            {!brandQuery && filteredBrands.length > BRAND_PREVIEW_COUNT ? (
              <button
                type="button"
                onClick={() => setShowAllBrands((value) => !value)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {showAllBrands ? "Show fewer" : `Show all ${filteredBrands.length} brands`}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      <div className="h-px w-full bg-border" />

      <section className="space-y-2.5">
        <SectionLabel>Availability</SectionLabel>
        <div className="space-y-1">
          <label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
            <SquareCheckbox
              checked={state.inStock}
              onCheckedChange={(value) => onUpdate({ in_stock: value === true ? "true" : null, page: null })}
            />
            <span className={state.inStock ? "font-medium" : "text-muted-foreground"}>In stock only</span>
          </label>
          <label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
            <SquareCheckbox
              checked={state.onSale}
              onCheckedChange={(value) => onUpdate({ on_sale: value === true ? "true" : null, page: null })}
            />
            <span className={state.onSale ? "font-medium" : "text-muted-foreground"}>On sale only</span>
          </label>
        </div>
      </section>

      {supportsPriceFilter ? (
        <>
          <div className="h-px w-full bg-border" />
          <PriceSection state={state} sliderMax={sliderMax} onUpdate={onUpdate} />
        </>
      ) : (
        <div className="rounded-xl bg-rose-soft p-3">
          <p className="text-xs font-semibold text-accent-foreground">Why is there no price filter?</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Every product in this result set is priced by Amazon and can change at any time. We link you to the live
            price instead of filtering on a stale one.
          </p>
        </div>
      )}
    </div>
  );
};

const parseInputNumber = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
};

const PriceSection = ({
  state,
  sliderMax,
  onUpdate,
}: {
  state: CatalogFilterState;
  sliderMax: number;
  onUpdate: (updates: FilterUpdates) => void;
}) => {
  const [draft, setDraft] = useState<[number, number]>([state.minPrice ?? 0, state.maxPrice ?? sliderMax]);

  return (
    <section className="space-y-2.5">
      <SectionLabel>Price range</SectionLabel>
      <Slider
        value={draft}
        min={0}
        max={sliderMax}
        step={100}
        minStepsBetweenThumbs={1}
        onValueChange={(value) => {
          if (value.length === 2) setDraft([value[0] ?? 0, value[1] ?? sliderMax]);
        }}
        onValueCommit={(value) => {
          if (value.length !== 2) return;
          onUpdate({
            min_price: value[0] > 0 ? String(value[0]) : null,
            max_price: value[1] < sliderMax ? String(value[1]) : null,
            page: null,
          });
        }}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatCatalogPrice(draft[0])}</span>
        <span>{formatCatalogPrice(draft[1])}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <label htmlFor="product-filter-min-price" className="text-xs font-medium text-muted-foreground">
            Min
          </label>
          <Input
            id="product-filter-min-price"
            type="number"
            inputMode="numeric"
            min={0}
            value={state.minPrice ?? ""}
            className="h-9"
            onChange={(event) => {
              const parsed = parseInputNumber(event.target.value);
              onUpdate({ min_price: parsed != null ? String(parsed) : null, page: null });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="product-filter-max-price" className="text-xs font-medium text-muted-foreground">
            Max
          </label>
          <Input
            id="product-filter-max-price"
            type="number"
            inputMode="numeric"
            min={0}
            value={state.maxPrice ?? ""}
            className="h-9"
            onChange={(event) => {
              const parsed = parseInputNumber(event.target.value);
              onUpdate({ max_price: parsed != null ? String(parsed) : null, page: null });
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default ProductFilters;
