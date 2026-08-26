import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { normalizeDraft } from "./adapters";
import { SocialDraftReviewDrawer } from "./SocialDraftReviewDrawer";
import { EMPTY_READINESS } from "./types";

const fixture = () => normalizeDraft({
  _id: "draft-review-1",
  status: "NEEDS_REVIEW",
  visual_mode: "AI_ARTWORK_ONLY",
  current_package: {
    internal_title: "Emergency fund basics",
    format_content: {
      format: "SINGLE_IMAGE",
      objective: "EDUCATION",
      content_pillar: "Money Education",
      target_audience: "Women building a first emergency fund",
      selected_headline: "Start with one small buffer",
      supporting_text: "Build consistency before chasing a perfect number.",
      caption: "A practical first step.",
      cta: "Save this for payday.",
      hashtags: ["#PinkPaisa"],
      alt_text: "An abstract pink savings illustration",
    },
  },
  compliance_result: { passed: true, decision: "PASS" },
  assets: [],
})!;

describe("SocialDraftReviewDrawer", () => {
  it("is an accessible labelled dialog and protects dirty close", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const draft = fixture();

    render(<SocialDraftReviewDrawer
      open
      onOpenChange={onOpenChange}
      draft={draft}
      todayProps={{
        draft,
        previousDraft: null,
        generationRun: null,
        readiness: EMPTY_READINESS,
        loading: false,
        generating: false,
        busyAction: "",
        dirty: true,
        loadError: "",
        onGenerate: vi.fn(),
        onReload: vi.fn(),
        onRecommendationChange: vi.fn(),
        onScheduleChange: vi.fn(),
        onSave: vi.fn(),
        onAction: vi.fn(),
        onAdoptAlternative: vi.fn(),
        onExport: vi.fn(),
      }}
    />);

    expect(screen.getByRole("dialog", { name: "Creative review" })).toBeVisible();
    expect(screen.getByText(/A validated final creative asset is required/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved social draft edits?");
    expect(onOpenChange).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("renders only final Reel media by default and keeps audio controls beside it", async () => {
    const user = userEvent.setup();
    const draft = normalizeDraft({
      _id: "draft-reel-review",
      status: "NEEDS_REVIEW",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      current_package: {
        primary_recommendation: {
          internal_title: "A simple savings Reel",
          topic: "Savings habit",
          format: "REEL",
          objective: "EDUCATION",
          content_pillar: "Money Education",
          caption: "Build the habit one payday at a time.",
          cta: "Save this Reel.",
          hashtags: ["#PinkPaisa"],
          alt_text: "A short vertical savings explainer video",
        },
      },
      assets: [{
        _id: "final-reel-asset",
        asset_role: "FINAL_VIDEO",
        media_kind: "VIDEO",
        mime_type: "video/mp4",
        url: "/uploads/social/final-reel.mp4",
        original_asset_url: "/uploads/social/original-reel.png",
        aspect_ratio: "9:16",
      }],
    });
    if (!draft) throw new Error("The Reel fixture must normalize");

    render(<SocialDraftReviewDrawer
      open
      onOpenChange={vi.fn()}
      draft={draft}
      todayProps={{
        draft,
        previousDraft: null,
        generationRun: null,
        readiness: EMPTY_READINESS,
        loading: false,
        generating: false,
        busyAction: "",
        dirty: false,
        loadError: "",
        onGenerate: vi.fn(),
        onReload: vi.fn(),
        onRecommendationChange: vi.fn(),
        onScheduleChange: vi.fn(),
        onSave: vi.fn(),
        onAction: vi.fn(),
        onAdoptAlternative: vi.fn(),
        onExport: vi.fn(),
        reviewSupplementContent: <div>Audio controls beside media</div>,
      }}
    />);

    const video = document.querySelector('video[src="/uploads/social/final-reel.mp4"]');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("controls");
    expect(document.querySelector('img[src="/uploads/social/final-reel.mp4"]')).not.toBeInTheDocument();
    const mediaRegion = screen.getByRole("region", { name: "Final media review" });
    expect(within(mediaRegion).getByText("Audio controls beside media")).toBeVisible();
    const original = screen.getByAltText(/original AI visual/);
    expect(original).not.toBeVisible();
    await user.click(screen.getByText("Advanced · original AI-generated visual"));
    expect(original).toBeVisible();
  });

  it("shows queue progress and finishes with direct Calendar navigation", async () => {
    const user = userEvent.setup();
    const draft = fixture();
    const onOpenCalendar = vi.fn();
    const todayProps = {
      draft,
      previousDraft: null,
      generationRun: null,
      readiness: EMPTY_READINESS,
      loading: false,
      generating: false,
      busyAction: "",
      dirty: false,
      loadError: "",
      onGenerate: vi.fn(),
      onReload: vi.fn(),
      onRecommendationChange: vi.fn(),
      onScheduleChange: vi.fn(),
      onSave: vi.fn(),
      onAction: vi.fn(),
      onAdoptAlternative: vi.fn(),
      onExport: vi.fn(),
    };
    const view = render(<SocialDraftReviewDrawer open onOpenChange={vi.fn()} draft={draft} todayProps={todayProps} queueNavigation={{ remainingReviewCount: 0, waitingGenerationCount: 2, complete: false }} onOpenCalendar={onOpenCalendar} />);
    expect(screen.getByText(/2 weekly creatives are generating or waiting for a required generation action/)).toBeVisible();

    view.rerender(<SocialDraftReviewDrawer open onOpenChange={vi.fn()} draft={draft} todayProps={todayProps} queueNavigation={{ remainingReviewCount: 0, waitingGenerationCount: 0, complete: true }} onOpenCalendar={onOpenCalendar} />);
    expect(screen.getByText("All weekly creatives reviewed")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Weekly review complete" })).toBeVisible();
    expect(screen.queryByText(/A validated final creative asset is required/)).not.toBeInTheDocument();
    expect(screen.queryByText("No AI visual has been generated")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Calendar" }));
    expect(onOpenCalendar).toHaveBeenCalledOnce();
  });

  it("does not declare the weekly queue complete while a creative failed and exposes its retry path", async () => {
    const user = userEvent.setup();
    const draft = fixture();
    const onOpenFailureDraft = vi.fn();
    render(<SocialDraftReviewDrawer
      open
      onOpenChange={vi.fn()}
      draft={draft}
      todayProps={{
        draft,
        previousDraft: null,
        generationRun: null,
        readiness: EMPTY_READINESS,
        loading: false,
        generating: false,
        busyAction: "",
        dirty: false,
        loadError: "",
        onGenerate: vi.fn(),
        onReload: vi.fn(),
        onRecommendationChange: vi.fn(),
        onScheduleChange: vi.fn(),
        onSave: vi.fn(),
        onAction: vi.fn(),
        onAdoptAlternative: vi.fn(),
        onExport: vi.fn(),
      }}
      queueNavigation={{
        remainingReviewCount: 0,
        waitingGenerationCount: 0,
        unresolvedFailureCount: 1,
        openManualBlockerCount: 0,
        firstFailureDraftId: "draft-failed-weekly",
        complete: false,
      }}
      onOpenFailureDraft={onOpenFailureDraft}
    />);

    expect(screen.queryByText("All weekly creatives reviewed")).not.toBeInTheDocument();
    expect(screen.getByText(/blocked by 1 failed creative/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry failed creative" }));
    expect(onOpenFailureDraft).toHaveBeenCalledWith("draft-failed-weekly");
  });

  it("labels a weekly proposal as a frozen India-time slot before scheduling", () => {
    const draft = { ...fixture(), weeklyPlanId: "weekly-review", scheduledFor: "2026-09-01T12:30:00.000Z" };
    render(<SocialDraftReviewDrawer
      open
      onOpenChange={vi.fn()}
      draft={draft}
      todayProps={{
        draft,
        previousDraft: null,
        generationRun: null,
        readiness: EMPTY_READINESS,
        loading: false,
        generating: false,
        busyAction: "",
        dirty: false,
        loadError: "",
        onGenerate: vi.fn(),
        onReload: vi.fn(),
        onRecommendationChange: vi.fn(),
        onScheduleChange: vi.fn(),
        onSave: vi.fn(),
        onAction: vi.fn(),
        onAdoptAlternative: vi.fn(),
        onExport: vi.fn(),
        weeklyLinked: true,
      }}
    />);

    expect(screen.getByText(/Frozen slot .* IST/)).toBeVisible();
    expect(screen.queryByText(/^Scheduled /)).not.toBeInTheDocument();
  });
});
