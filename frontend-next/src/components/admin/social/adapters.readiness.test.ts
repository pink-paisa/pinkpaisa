import { describe, expect, it } from "vitest";
import { normalizeReadiness } from "./adapters";

describe("Social Manager generation readiness", () => {
  it("keeps manual generation available when automatic daily generation is disabled", () => {
    const readiness = normalizeReadiness({
      generation_enabled: false,
      manual_generation_enabled: true,
      ai_configured: true,
    });

    expect(readiness.generationEnabled).toBe(false);
    expect(readiness.manualGenerationEnabled).toBe(true);
  });

  it("falls back to the legacy generation flag for older server responses", () => {
    expect(normalizeReadiness({ generation_enabled: false }).manualGenerationEnabled).toBe(false);
    expect(normalizeReadiness({ generationEnabled: true }).manualGenerationEnabled).toBe(true);
  });
});
