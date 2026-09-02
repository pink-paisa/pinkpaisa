import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ArrowRight, ArrowUpRight, Clock, Loader2, Search, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCatalogFacets } from "@/hooks/useCatalogFacets";
import { useCatalogProducts, type CatalogProduct } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode } from "@/hooks/useProductTaxonomy";
import { cn } from "@/lib/utils";

const RECENT_KEY = "pp_recent_product_searches";
const RECENT_LIMIT = 5;
const SUGGESTION_DEBOUNCE_MS = 220;

type FilterUpdates = Record<string, string | null>;

type SearchAutocompleteProps = {
  value: string;
  taxonomy?: ProductCategoryNode[];
  placeholder?: string;
  className?: string;
  /** Commits the typed term to the URL. */
  onSearch: (term: string) => void;
  onNavigate: (updates: FilterUpdates) => void;
};

type Suggestion =
  | { kind: "category"; id: string; label: string; count: number; slug: string }
  | { kind: "subcategory"; id: string; label: string; count: number; slug: string; categorySlug: string }
  | { kind: "brand"; id: string; label: string; count: number }
  | { kind: "product"; id: string; label: string; product: CatalogProduct }
  | { kind: "recent"; id: string; label: string }
  | { kind: "all"; id: string; label: string; count: number };

const readRecentSearches = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const writeRecentSearches = (terms: string[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(terms.slice(0, RECENT_LIMIT)));
  } catch {
    /* Storage can be unavailable (private mode, blocked cookies) — recents are optional. */
  }
};

/** Highlights the matched run so shoppers can see why a row was suggested. */
const HighlightedLabel = ({ label, query }: { label: string; query: string }) => {
  const index = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <mark className="bg-transparent font-bold text-primary">{label.slice(index, index + query.length)}</mark>
      {label.slice(index + query.length)}
    </>
  );
};

export const SearchAutocomplete = ({
  value,
  taxonomy,
  placeholder = "Search products, brands or concerns...",
  className,
  onSearch,
  onNavigate,
}: SearchAutocompleteProps) => {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = "product-search-suggestions";

  useEffect(() => setDraft(value), [value]);
  useEffect(() => setRecent(readRecentSearches()), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(draft.trim()), SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const hasQuery = debounced.length >= 2;

  const { data: facets, isFetching: facetsLoading } = useCatalogFacets(
    hasQuery && open ? { search: debounced } : {},
  );
  const { data: productMatches, isFetching: productsLoading } = useCatalogProducts(
    hasQuery && open ? { search: debounced, pageSize: 3, page: 1 } : { pageSize: 3, page: 1 },
  );

  const loading = open && hasQuery && (facetsLoading || productsLoading);

  const slugLookup = useMemo(() => {
    const categoryBySlug = new Map<string, string>();
    const subcategoryBySlug = new Map<string, { slug: string; categorySlug: string }>();
    (taxonomy ?? []).forEach((category) => {
      categoryBySlug.set(category.name.toLowerCase(), category.slug);
      category.subcategories.forEach((sub) =>
        subcategoryBySlug.set(sub.name.toLowerCase(), { slug: sub.slug, categorySlug: category.slug }),
      );
    });
    return { categoryBySlug, subcategoryBySlug };
  }, [taxonomy]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!hasQuery) {
      return recent.map((term) => ({ kind: "recent" as const, id: `recent:${term}`, label: term }));
    }

    const items: Suggestion[] = [];

    (facets?.categories ?? []).slice(0, 3).forEach((entry) => {
      const slug = slugLookup.categoryBySlug.get(entry.name.toLowerCase());
      if (slug) items.push({ kind: "category", id: `category:${slug}`, label: entry.name, count: entry.count, slug });
    });

    (facets?.subcategories ?? [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .forEach((entry) => {
        const match = slugLookup.subcategoryBySlug.get(entry.name.toLowerCase());
        if (match) {
          items.push({
            kind: "subcategory",
            id: `subcategory:${match.slug}`,
            label: entry.name,
            count: entry.count,
            slug: match.slug,
            categorySlug: match.categorySlug,
          });
        }
      });

    (facets?.brands ?? [])
      .filter((brand) => brand.name.toLowerCase().includes(debounced.toLowerCase()))
      .slice(0, 2)
      .forEach((brand) => items.push({ kind: "brand", id: `brand:${brand.name}`, label: brand.name, count: brand.count }));

    (productMatches?.items ?? []).slice(0, 3).forEach((product) =>
      items.push({ kind: "product", id: `product:${product.id}`, label: product.title, product }),
    );

    const total = productMatches?.total ?? 0;
    if (total > 0) items.push({ kind: "all", id: "all", label: debounced, count: total });

    return items;
  }, [debounced, facets, hasQuery, productMatches, recent, slugLookup]);

  useEffect(() => setActiveIndex(-1), [debounced, open]);

  const rememberTerm = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecent((previous) => {
      const next = [trimmed, ...previous.filter((entry) => entry !== trimmed)].slice(0, RECENT_LIMIT);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  const commitSearch = useCallback(
    (term: string) => {
      rememberTerm(term);
      onSearch(term.trim());
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSearch, rememberTerm],
  );

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      switch (suggestion.kind) {
        case "category":
          rememberTerm(debounced);
          onNavigate({ category: suggestion.slug, subcategory: null, page: null });
          break;
        case "subcategory":
          rememberTerm(debounced);
          onNavigate({ category: suggestion.categorySlug, subcategory: suggestion.slug, page: null });
          break;
        case "brand":
          rememberTerm(debounced);
          onNavigate({ brand: suggestion.label, page: null });
          break;
        case "product":
          rememberTerm(debounced);
          void router.push(`/product/${suggestion.product.slug}`);
          setOpen(false);
          inputRef.current?.blur();
          return;
        case "recent":
          setDraft(suggestion.label);
          commitSearch(suggestion.label);
          return;
        case "all":
          commitSearch(suggestion.label);
          return;
      }
      // Jumping to a category, subcategory or brand does not apply the typed
      // term, so snap the box back to whatever the URL actually filters by —
      // otherwise it advertises a search that is not in effect.
      setDraft(value);
      setOpen(false);
      inputRef.current?.blur();
    },
    [commitSearch, debounced, onNavigate, rememberTerm, router, value],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open || suggestions.length === 0) return;
      event.preventDefault();
      setActiveIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = current + delta;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      if (active) applySuggestion(active);
      else commitSearch(draft);
    }
  };

  const groups = useMemo(() => {
    const order: Array<{ key: Suggestion["kind"]; label: string }> = [
      { key: "recent", label: "Recent searches" },
      { key: "category", label: "Categories" },
      { key: "subcategory", label: "Subcategories" },
      { key: "brand", label: "Brands" },
      { key: "product", label: "Products" },
    ];
    return order
      .map((group) => ({
        ...group,
        items: suggestions.filter((item) => item.kind === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [suggestions]);

  const seeAll = suggestions.find((item) => item.kind === "all");

  return (
    <div ref={containerRef} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        className="rounded-full pl-9 pr-9"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onSearch("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {open && (groups.length > 0 || loading) ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover shadow-2xl"
        >
          {loading && groups.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching the catalog...
            </div>
          ) : null}

          {groups.map((group) => (
            <div key={group.key} className="border-b border-border last:border-b-0">
              <p className="bg-background px-4 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                const index = suggestions.indexOf(item);
                const active = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={active}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => applySuggestion(item)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors",
                      active ? "bg-rose-soft" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {item.kind === "product" ? (
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
                          {item.product.featured_image ? (
                            <img
                              src={item.product.featured_image}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain p-1"
                            />
                          ) : null}
                        </span>
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                          {item.kind === "recent" ? <Clock className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          <HighlightedLabel label={item.label} query={debounced} />
                        </span>
                        {item.kind === "product" ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {item.product.brand_name ? `${item.product.brand_name} · ` : ""}
                            {item.product.subcategory || item.product.category}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {"count" in item ? `${item.count}` : null}
                      {item.kind === "product" ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {seeAll ? (
            <button
              type="button"
              onClick={() => applySuggestion(seeAll)}
              className="flex w-full items-center justify-between gap-3 bg-background px-4 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <span className="text-sm font-semibold text-primary">
                See all {seeAll.count} results for “{seeAll.label}”
              </span>
              <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Enter
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default SearchAutocomplete;
