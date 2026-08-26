import { describe, expect, it } from "vitest";
import { artworkOnlyEligibility } from "./socialVisualMode";
import {
  AI_NATIVE_FULL_GRAPHIC_LABEL,
  deriveDraftWorkflow,
  isAiNativeFullGraphicAsset,
  provenanceLabels,
} from "./socialWorkflow";
import { SocialDraft, SocialGenerationRun, SocialReadiness } from "./types";

const readiness = { blockers: [] } as unknown as SocialReadiness;

const draft = (status: string, visualMode: SocialDraft["visualMode"] = "AI_VISUAL_WITH_EXACT_OVERLAY", overrides: Partial<SocialDraft> = {}) => ({
  id: "draft-1",
  status,
  visualMode,
  primary: { format: "SINGLE_IMAGE", verifiedProductId: "" },
  assets: [{ provider: "OpenAI", model: "gpt-image-2", role: "FINAL_COMPOSED", visualMode, provenance: {}, sourceProvenance: "generated" }],
  ...overrides,
} as unknown as SocialDraft);

const run = (status: SocialGenerationRun["status"], stage = "FAILED") => ({ id: "run-1", status, currentStage: stage }) as SocialGenerationRun;

describe("deriveDraftWorkflow", () => {
  it.each([
    ["DRAFT", "generate-creative", "Generate required creative revision"],
    ["REJECTED", "submit-review", "Submit for review"],
    ["NEEDS_REVIEW", "approve-and-schedule", "Approve & schedule"],
    ["APPROVED", "schedule", "Schedule"],
    ["SCHEDULED", "view-calendar", "View scheduled post"],
    ["PUBLISHING", "none", "Publishing in progress"],
    ["PUBLISHED", "view-results", "View results"],
  ])("maps %s to one state-derived primary action", (status, action, label) => {
    expect(deriveDraftWorkflow(draft(status), readiness, false)).toMatchObject({ primaryAction: action, label });
  });

  it("always makes unsaved work the primary action", () => {
    expect(deriveDraftWorkflow(draft("NEEDS_REVIEW"), readiness, true)).toMatchObject({ primaryAction: "save", label: "Save & recheck" });
  });

  it("routes a real generic FAILED draft through its failed generation run", () => {
    const failed = draft("FAILED", "AI_VISUAL_WITH_EXACT_OVERLAY", { lastError: { stage: "GENERATING_IMAGES" } });
    expect(deriveDraftWorkflow(failed, readiness, false, run("FAILED_IMAGE_GENERATION", "FAILED"))).toMatchObject({
      primaryAction: "retry-generation-run",
      label: "Retry image generation",
    });
  });

  it("does not misroute publishing failures into creative regeneration", () => {
    const scheduledRetry = draft("FAILED", "AI_VISUAL_WITH_EXACT_OVERLAY", {
      lastError: { stage: "PUBLISHING" },
      publication: { status: "FAILED", retry_scheduled_for: "2026-08-25T05:00:00.000Z" },
    });
    expect(deriveDraftWorkflow(scheduledRetry, readiness, false, run("SUCCEEDED"))).toMatchObject({ primaryAction: "none", label: "Publishing retry scheduled" });

    const uncertain = draft("FAILED", "AI_VISUAL_WITH_EXACT_OVERLAY", {
      lastError: { stage: "PUBLISH_OUTCOME_UNCERTAIN" },
      publication: { status: "UNCERTAIN", outcome_uncertain: true },
    });
    expect(deriveDraftWorkflow(uncertain, readiness, false, run("SUCCEEDED"))).toMatchObject({
      primaryAction: "complete-manual-action",
      label: "Manual Instagram reconciliation required",
    });
  });
});

describe("AI artwork-only eligibility", () => {
  it.each(["SINGLE_IMAGE", "CAROUSEL"])("allows eligible %s education content", (format) => {
    expect(artworkOnlyEligibility({ format, objective: "EDUCATION" })).toEqual({ eligible: true, reasons: [], message: "" });
  });

  it.each(["STORY", "REEL", "VIDEO_FEED", "PRODUCT_FEATURE", "RESOURCE_PROMOTION", "EVENT_OR_WORKSHOP_PROMOTION"])("rejects %s with a disabled reason", (format) => {
    const result = artworkOnlyEligibility({ format, objective: "AWARENESS" });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("FORMAT_REQUIRES_OVERLAY");
    expect(result.message).toMatch(/Single Image and Carousel/);
  });

  it.each(["TRAFFIC", "LEADS", "PRODUCT_PROMOTION"])("rejects the %s objective", (objective) => {
    expect(artworkOnlyEligibility({ format: "SINGLE_IMAGE", objective }).reasons).toContain("OBJECTIVE_REQUIRES_OVERLAY");
  });

  it("rejects affiliate/product identity regardless of an otherwise eligible format", () => {
    expect(artworkOnlyEligibility({ format: "CAROUSEL", objective: "ENGAGEMENT", verifiedProductId: "catalog-1" }).reasons).toContain("PROMOTIONAL_OR_PRODUCT_CONTENT");
  });

  it("does not offer artwork-only until both format and objective are concrete", () => {
    expect(artworkOnlyEligibility({ format: "AUTO_CHOOSE", objective: "AUTO_CHOOSE" }).reasons).toEqual(expect.arrayContaining(["FORMAT_NOT_SELECTED", "OBJECTIVE_NOT_SELECTED"]));
    expect(artworkOnlyEligibility({ format: "SINGLE_IMAGE" }).reasons).toContain("OBJECTIVE_NOT_SELECTED");
  });
});

describe("truthful provenance labels", () => {
  it.each([
    ["AI_VISUAL_WITH_EXACT_OVERLAY", "Text · Verified overlay"],
    ["AI_ARTWORK_ONLY", "Artwork · AI — No overlay"],
    ["FULL_AI_GRAPHIC", "Headline · AI-rendered and validated"],
  ] as const)("labels %s accurately", (mode, expected) => {
    expect(provenanceLabels(draft("NEEDS_REVIEW", mode))).toContain(expected);
  });

  it("keeps legacy manual-template provenance readable", () => {
    expect(provenanceLabels(draft("NEEDS_REVIEW", "MANUAL_TEMPLATE"))).toContain("Legacy · Manual template");
  });

  it("labels the v2 FULL_AI_GRAPHIC contract as AI-native with no overlay", () => {
    const native = draft("NEEDS_REVIEW", "FULL_AI_GRAPHIC", {
      assets: [{
        provider: "OpenAI",
        model: "gpt-image-2",
        role: "FINAL_COMPOSED",
        visualMode: "FULL_AI_GRAPHIC",
        provenance: { full_ai_graphic_contract_version: 2 },
        sourceProvenance: "generated",
      }],
    });

    expect(isAiNativeFullGraphicAsset(native.assets[0])).toBe(true);
    expect(provenanceLabels(native)).toContain(AI_NATIVE_FULL_GRAPHIC_LABEL);
    expect(provenanceLabels(native)).not.toContain("Headline · AI-rendered and validated");
    expect(provenanceLabels(native)).not.toContain("Brand elements · Overlay");
  });

  it("recognizes the no-overlay AI-text provenance fallback", () => {
    const native = draft("NEEDS_REVIEW", "FULL_AI_GRAPHIC", {
      assets: [{
        provider: "OpenAI",
        model: "gpt-image-2",
        role: "FINAL_COMPOSED",
        visualMode: "FULL_AI_GRAPHIC",
        provenance: { overlay: { method: "none", image_ai_used_for_text: true } },
        sourceProvenance: "generated",
      }],
    });

    expect(isAiNativeFullGraphicAsset(native.assets[0])).toBe(true);
    expect(provenanceLabels(native)).toContain(AI_NATIVE_FULL_GRAPHIC_LABEL);
  });

  it("keeps legacy FULL_AI_GRAPHIC branded-finish provenance labels unchanged", () => {
    const legacy = draft("NEEDS_REVIEW", "FULL_AI_GRAPHIC", {
      assets: [{
        provider: "OpenAI",
        model: "gpt-image-2",
        role: "FINAL_COMPOSED",
        visualMode: "FULL_AI_GRAPHIC",
        provenance: {
          full_ai_graphic_contract_version: 1,
          overlay: { method: "sharp_branded_finish_after_validated_ai_headline", image_ai_used_for_text: true },
        },
        sourceProvenance: "generated",
      }],
    });

    expect(isAiNativeFullGraphicAsset(legacy.assets[0])).toBe(false);
    expect(provenanceLabels(legacy)).toEqual(expect.arrayContaining([
      "Headline · AI-rendered and validated",
      "Brand elements · Overlay",
    ]));
    expect(provenanceLabels(legacy)).not.toContain(AI_NATIVE_FULL_GRAPHIC_LABEL);
  });

  it.each([
    ["EDITORIAL_ICON_GRID", "Style · Editorial icon grid"],
    ["BOLD_EDITORIAL_COLLAGE", "Style · Bold editorial collage"],
  ])("shows the selected Pink Paisa creative system %s", (creativeStyle, expected) => {
    const styled = draft("NEEDS_REVIEW", "AI_VISUAL_WITH_EXACT_OVERLAY");
    styled.assets[0].provenance = { creative_style: { id: creativeStyle } };
    expect(provenanceLabels(styled)).toContain(expected);
  });
});
