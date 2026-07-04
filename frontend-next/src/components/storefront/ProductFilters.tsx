import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { CatalogFacetResponse } from "@/hooks/useCatalogProducts";

type ProductFiltersProps = {
  facets?: CatalogFacetResponse;
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  onSale: boolean;
  selectedBrands: string[];
  hasActiveFilters: boolean;
  onMinPriceChange: (value: number | null) => void;
  onMaxPriceChange: (value: number | null) => void;
  onInStockChange: (value: boolean) => void;
  onOnSaleChange: (value: boolean) => void;
  onToggleBrand: (brandName: string) => void;
  onClear: () => void;
};

const parseInputNumber = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
};

const formatPrice = (value: number) => `₹${value.toLocaleString("en-IN")}`;

const ProductFilters = ({
  facets,
  minPrice,
  maxPrice,
  inStock,
  onSale,
  selectedBrands,
  hasActiveFilters,
  onMinPriceChange,
  onMaxPriceChange,
  onInStockChange,
  onOnSaleChange,
  onToggleBrand,
  onClear,
}: ProductFiltersProps) => {
  const sliderMax = useMemo(() => {
    const highestBucket = facets?.price_buckets?.reduce((max, bucket) => {
      if (bucket.max == null) return Math.max(max, bucket.min);
      return Math.max(max, bucket.max);
    }, 5000);
    return Math.max(highestBucket || 5000, 5000);
  }, [facets?.price_buckets]);

  const [sliderValue, setSliderValue] = useState<[number, number]>([
    minPrice ?? 0,
    maxPrice ?? sliderMax,
  ]);

  useEffect(() => {
    setSliderValue([minPrice ?? 0, maxPrice ?? sliderMax]);
  }, [minPrice, maxPrice, sliderMax]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Filters</h3>
          <p className="text-sm text-muted-foreground">Narrow the catalog to what fits you best.</p>
        </div>
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <section className="space-y-3">
        <div>
          <p className="font-medium">Price range</p>
          <p className="text-sm text-muted-foreground">Choose the budget you want to browse.</p>
        </div>
        <Slider
          value={sliderValue}
          min={0}
          max={sliderMax}
          step={100}
          minStepsBetweenThumbs={1}
          onValueChange={(value) => {
            if (value.length === 2) {
              setSliderValue([value[0] || 0, value[1] || sliderMax]);
            }
          }}
          onValueCommit={(value) => {
            if (value.length === 2) {
              onMinPriceChange(value[0] > 0 ? value[0] : null);
              onMaxPriceChange(value[1] < sliderMax ? value[1] : null);
            }
          }}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatPrice(sliderValue[0])}</span>
          <span>{formatPrice(sliderValue[1])}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Min</label>
            <Input
              type="number"
              min={0}
              value={minPrice ?? ""}
              onChange={(event) => onMinPriceChange(parseInputNumber(event.target.value))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Max</label>
            <Input
              type="number"
              min={0}
              value={maxPrice ?? ""}
              onChange={(event) => onMaxPriceChange(parseInputNumber(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <p className="font-medium">Availability</p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={inStock} onCheckedChange={(value) => onInStockChange(value === true)} />
            In stock only
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={onSale} onCheckedChange={(value) => onOnSaleChange(value === true)} />
            On sale only
          </label>
        </div>
      </section>

      {facets?.brands?.length ? (
        <section className="space-y-3">
          <div>
            <p className="font-medium">Brand</p>
            <p className="text-sm text-muted-foreground">Filter by the labels currently in this result set.</p>
          </div>
          <div className="space-y-3">
            {facets.brands.map((brand) => {
              const selected = selectedBrands.includes(brand.name);
              return (
                <label key={brand.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-3">
                    <Checkbox checked={selected} onCheckedChange={() => onToggleBrand(brand.name)} />
                    {brand.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{brand.count}</span>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default ProductFilters;
