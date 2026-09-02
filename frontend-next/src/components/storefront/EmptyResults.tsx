import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw, SearchX, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CatalogFacetResponse } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode } from "@/hooks/useProductTaxonomy";
import type { CatalogFilterState } from "@/lib/catalogQuery";

type FilterUpdates = Record<string, string | null>;

export type AppliedFilter = {
  key: string;
  label: string;
  updates: FilterUpdates;
};

type EmptyResultsProps = {
  state: CatalogFilterState;
  appliedFilters: AppliedFilter[];
  taxonomy?: ProductCategoryNode[];
  /** Unfiltered facet counts, so category shortcuts still show real numbers here. */
  globalFacets?: CatalogFacetResponse;
  onUpdate: (updates: FilterUpdates) => void;
  onClear: () => void;
};

const RecoveryCard = ({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-border bg-background p-5">
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {step}
      </span>
      <h4 className="text-sm font-semibold">{title}</h4>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    <div className="mt-auto space-y-2">{children}</div>
  </div>
);

const ActionRow = ({
  label,
  meta,
  onClick,
  icon,
  emphasis,
}: {
  label: string;
  meta?: string;
  onClick: () => void;
  icon?: React.ReactNode;
  emphasis?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center justify-between gap-3 rounded-full border bg-card px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      emphasis ? "border-primary font-semibold text-primary" : "border-border font-medium"
    }`}
  >
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    {meta ? <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{meta}</span> : null}
  </button>
);

export const EmptyResults = ({
  state,
  appliedFilters,
  taxonomy,
  globalFacets,
  onUpdate,
  onClear,
}: EmptyResultsProps) => {
  const categories = useMemo(
    () => (taxonomy ?? []).filter((item) => item.slug !== "uncategorized" && item.is_active),
    [taxonomy],
  );

  const globalCounts = useMemo(() => {
    const map = new Map<string, number>();
    (globalFacets?.categories ?? []).forEach((entry) => {
      if (entry.id) map.set(entry.id, entry.count);
      map.set(entry.name.toLowerCase(), entry.count);
    });
    return map;
  }, [globalFacets?.categories]);

  const catalogTotal = useMemo(
    () => (globalFacets?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0),
    [globalFacets?.categories],
  );

  const nonSearchFilters = appliedFilters.filter((filter) => filter.key !== "search");
  const searchWords = state.search.trim().split(/\s+/).filter(Boolean);

  return (
    <div className="space-y-7">
      <div className="flex flex-col items-center rounded-3xl border border-border bg-card px-6 py-10 text-center sm:px-10">
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-rose-soft">
          <SearchX className="h-10 w-10 text-primary" aria-hidden />
        </div>
        <h2 className="mt-5 font-serif text-2xl leading-tight sm:text-3xl">We could not find a match</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          {state.search
            ? `Nothing in the catalog matches “${state.search}”${nonSearchFilters.length ? " with these filters applied" : ""}.`
            : "No products match the filters you have applied."}{" "}
          These next steps usually help.
        </p>

        <div className="mt-7 flex w-full flex-col gap-4 lg:flex-row">
          {nonSearchFilters.length > 0 ? (
            <RecoveryCard
              step={1}
              title="Remove a filter"
              description={`${nonSearchFilters.length} ${nonSearchFilters.length === 1 ? "filter is" : "filters are"} narrowing this search. Removing one may bring results back.`}
            >
              {nonSearchFilters.slice(0, 3).map((filter) => (
                <ActionRow
                  key={filter.key}
                  label={filter.label}
                  icon={<X className="h-3 w-3 shrink-0" />}
                  emphasis
                  onClick={() => onUpdate({ ...filter.updates, page: null })}
                />
              ))}
              <ActionRow
                label="Clear all filters"
                meta={catalogTotal ? `${catalogTotal} products` : undefined}
                icon={<RotateCcw className="h-3 w-3 shrink-0" />}
                onClick={onClear}
              />
            </RecoveryCard>
          ) : null}

          {state.search ? (
            <RecoveryCard
              step={nonSearchFilters.length > 0 ? 2 : 1}
              title="Adjust your search"
              description="We match product titles, brands, categories and descriptions. Fewer words usually match more."
            >
              {nonSearchFilters.length > 0 ? (
                <ActionRow
                  label={`Search “${state.search}” across everything`}
                  icon={<SlidersHorizontal className="h-3 w-3 shrink-0" />}
                  emphasis
                  onClick={() =>
                    onUpdate({
                      category: null,
                      subcategory: null,
                      brand: null,
                      in_stock: null,
                      on_sale: null,
                      min_price: null,
                      max_price: null,
                      page: null,
                    })
                  }
                />
              ) : null}
              {searchWords.length > 1 ? (
                <ActionRow
                  label={`Try just “${searchWords[0]}”`}
                  onClick={() => onUpdate({ search: searchWords[0], page: null })}
                />
              ) : null}
              <ActionRow label="Clear the search box" onClick={() => onUpdate({ search: null, page: null })} />
            </RecoveryCard>
          ) : null}

          <RecoveryCard
            step={(nonSearchFilters.length > 0 ? 1 : 0) + (state.search ? 1 : 0) + 1}
            title="Browse by category"
            description="Every product is hand-picked by the Pink Paisa team and linked to Amazon.in."
          >
            {categories.slice(0, 4).map((category) => (
              <ActionRow
                key={category.id}
                label={category.name}
                meta={
                  globalCounts.get(category.id) != null || globalCounts.get(category.name.toLowerCase()) != null
                    ? String(globalCounts.get(category.id) ?? globalCounts.get(category.name.toLowerCase()))
                    : undefined
                }
                onClick={() =>
                  onUpdate({ search: null, category: category.slug, subcategory: null, brand: null, page: null })
                }
              />
            ))}
          </RecoveryCard>
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-2xl bg-sage-light p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Looking for something we do not stock?</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us what to add, or apply to list your own wellness brand on Pink Paisa.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <Button asChild variant="outline" className="rounded-full bg-card">
            <Link href="/pink-pages/submit">Suggest a product</Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/vendor/signup">
              Become a vendor <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EmptyResults;
