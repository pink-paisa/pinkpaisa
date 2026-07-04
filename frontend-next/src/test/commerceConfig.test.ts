import { describe, expect, it } from "vitest";
import { calculateShippingCost, FREE_SHIPPING_THRESHOLD, STANDARD_SHIPPING_COST } from "@/lib/commerceConfig";

describe("commerce config", () => {
  it("charges standard shipping below the free-shipping threshold", () => {
    const subtotal = Math.max(FREE_SHIPPING_THRESHOLD - 1, 0);
    expect(calculateShippingCost(subtotal)).toBe(
      FREE_SHIPPING_THRESHOLD > 0 ? STANDARD_SHIPPING_COST : 0
    );
  });

  it("waives shipping once the threshold is reached", () => {
    const subtotal = FREE_SHIPPING_THRESHOLD > 0 ? FREE_SHIPPING_THRESHOLD : STANDARD_SHIPPING_COST;
    expect(calculateShippingCost(subtotal)).toBe(0);
  });
});
