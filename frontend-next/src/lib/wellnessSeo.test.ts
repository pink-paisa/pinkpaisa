import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import type { ProductCategoryNode, ProductSubcategoryNode } from "@/hooks/useProductTaxonomy";
import {
  buildInstagramWellnessConfig,
  buildTaxonomyWellnessConfig,
  pickSectionProducts,
  type WellnessPageConfig,
} from "@/lib/wellnessSeo";

function makeProduct(overrides: Partial<CatalogProduct>): CatalogProduct {
  return {
    id: overrides.id || "product",
    title: overrides.title || "Wellness product",
    slug: overrides.slug || overrides.id || "product",
    short_description: null,
    full_description: null,
    category: "Wellness",
    images: [],
    featured_image: null,
    price: null,
    sale_price: null,
    sku: null,
    stock_quantity: 1,
    tags: [],
    weight: null,
    dimensions: null,
    status: "active",
    featured: false,
    bestseller: false,
    sort_order: 0,
    ...overrides,
  };
}

function jsonRoundTrip(config: WellnessPageConfig) {
  return JSON.parse(JSON.stringify(config)) as WellnessPageConfig;
}

describe("wellness SSR configuration", () => {
  it("keeps taxonomy product matching after a JSON round trip", () => {
    const config = buildTaxonomyWellnessConfig(
      {
        id: "wellness",
        _id: "wellness",
        name: "Wellness",
        slug: "wellness",
        is_active: true,
      } as ProductCategoryNode,
      {
        id: "haircare",
        _id: "haircare",
        name: "Haircare",
        slug: "haircare",
        description: "Hair care products",
        is_active: true,
      } as ProductSubcategoryNode,
    );
    const serialized = jsonRoundTrip(config);
    const routineProduct = makeProduct({ id: "routine", title: "Daily hair routine serum" });
    const unrelatedProduct = makeProduct({ id: "unrelated", title: "Yoga blocks", category: "Fitness" });

    expect(serialized.bestForSections[0].productMatch).toEqual({
      kind: "includes_any",
      values: expect.arrayContaining(["routine", "haircare"]),
    });
    expect(pickSectionProducts([unrelatedProduct, routineProduct], serialized.bestForSections[0])).toEqual([
      routineProduct,
    ]);
  });

  it("keeps Instagram featured matching after a JSON round trip", () => {
    const config = jsonRoundTrip(buildInstagramWellnessConfig());
    const ordinaryProduct = makeProduct({ id: "ordinary" });
    const featuredProduct = makeProduct({ id: "featured", affiliate_is_instagram_pick: true });

    expect(config.bestForSections[0].productMatch).toEqual({ kind: "featured_or_instagram" });
    expect(pickSectionProducts([ordinaryProduct, featuredProduct], config.bestForSections[0])).toEqual([
      featuredProduct,
    ]);
  });

  it("contains no values that Next.js cannot serialize", () => {
    const configs = [buildInstagramWellnessConfig()];

    const visit = (value: unknown): void => {
      expect(typeof value).not.toBe("function");
      expect(value).not.toBeUndefined();
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };

    visit(configs);
    expect(JSON.parse(JSON.stringify(configs))).toEqual(configs);
  });
});
