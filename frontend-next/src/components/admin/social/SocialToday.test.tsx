import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SocialToday } from "./SocialToday";
import { normalizeDraft } from "./adapters";
import { EMPTY_READINESS } from "./types";

const renderToday = (
  onGenerate = vi.fn(),
  readiness = { ...EMPTY_READINESS, generationEnabled: true, manualGenerationEnabled: true },
) => {
  render(<SocialToday
    draft={null}
    previousDraft={null}
    generationRun={null}
    readiness={readiness}
    loading={false}
    generating={false}
    busyAction=""
    dirty={false}
    loadError=""
    onGenerate={onGenerate}
    onReload={vi.fn()}
    onRecommendationChange={vi.fn()}
    onScheduleChange={vi.fn()}
    onSave={vi.fn()}
    onAction={vi.fn()}
    onAdoptAlternative={vi.fn()}
    onExport={vi.fn()}
  />);
  return onGenerate;
};

const fullAiDraft = (provenance: Record<string, unknown>) => {
  const draft = normalizeDraft({
    _id: "draft-full-ai-provenance",
    status: "NEEDS_REVIEW",
    visual_mode: "FULL_AI_GRAPHIC",
    current_package: {
      primary_recommendation: {
        internal_title: "Pause before you scan",
        topic: "Payment safety",
        format: "SINGLE_IMAGE",
        objective: "EDUCATION",
        post_type: "EDUCATION",
        content_pillar: "Practical education",
        target_audience_segment: "Women using digital payments",
        selected_headline: "Pause before you scan",
        supporting_text: "Verify the recipient, amount and payment details.",
        caption: "Pause and verify before paying.",
        cta: "Save this checklist.",
        hashtags: ["#PinkPaisa", "#MoneySafety", "#DigitalPayments", "#WomenAndMoney", "#FinancialEducation"],
        image_generation_prompt: "A complete Pink Paisa editorial payment-safety graphic",
        alt_text: "A Pink Paisa payment-safety graphic",
      },
    },
    assets: [{
      _id: "asset-full-ai-final",
      role: "FINAL_COMPOSED",
      visual_mode: "FULL_AI_GRAPHIC",
      url: "/uploads/social/full-ai-final.jpg",
      original_asset_url: "/uploads/social/full-ai-original.jpg",
      validation_status: "valid",
      image_provider: "OpenAI",
      image_model: "gpt-image-2",
      image_generation_status: "VALIDATED",
      source_provenance: "generated",
      provenance,
    }],
  });
  if (!draft) throw new Error("The FULL_AI_GRAPHIC fixture must normalize");
  return draft;
};

const renderReviewDraft = (draft: ReturnType<typeof fullAiDraft>, onAction = vi.fn()) => render(<SocialToday
  draft={draft}
  previousDraft={null}
  generationRun={null}
  readiness={EMPTY_READINESS}
  loading={false}
  generating={false}
  busyAction=""
  dirty={false}
  loadError=""
  onGenerate={vi.fn()}
  onReload={vi.fn()}
  onRecommendationChange={vi.fn()}
  onScheduleChange={vi.fn()}
  onSave={vi.fn()}
  onAction={onAction}
  onAdoptAlternative={vi.fn()}
  onExport={vi.fn()}
  reviewMode
/>);

describe("SocialToday generation controls", () => {
  it("allows manual generation while the legacy daily scheduler is disabled", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    renderToday(onGenerate, {
      ...EMPTY_READINESS,
      generationEnabled: false,
      manualGenerationEnabled: true,
    });

    const generate = screen.getByRole("button", { name: /Generate Today’s Post/ });
    expect(generate).toBeEnabled();
    await user.click(generate);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("uses the dedicated manual readiness flag instead of the legacy generation flag", () => {
    renderToday(vi.fn(), {
      ...EMPTY_READINESS,
      generationEnabled: true,
      manualGenerationEnabled: false,
    });

    expect(screen.getByRole("button", { name: /Generate Today’s Post/ })).toBeDisabled();
  });

  it("defaults eligible generation to the complete AI-native no-overlay mode", async () => {
    const user = userEvent.setup();
    const onGenerate = renderToday();

    await user.click(screen.getByText("Advanced visual mode"));
    const visualMode = screen.getAllByRole("combobox")[2] as HTMLSelectElement;
    expect(visualMode).toHaveValue("FULL_AI_GRAPHIC");
    expect(screen.getByRole("option", { name: /AI-native complete graphic.*Recommended, no overlay/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Generate Today’s Post/ }));
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      visual_mode: "FULL_AI_GRAPHIC",
    }));
  });

  it("allows a general Story request to use complete AI-native no-overlay mode", async () => {
    const user = userEvent.setup();
    const onGenerate = renderToday();
    const selects = screen.getAllByRole("combobox");

    await user.selectOptions(selects[0], "STORY");
    await user.click(screen.getByText("Advanced visual mode"));
    expect(selects[2]).toHaveValue("FULL_AI_GRAPHIC");
    expect(screen.getByRole("option", { name: /AI-native complete graphic/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Generate Today’s Post/ }));
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      requested_format: "STORY",
      visual_mode: "FULL_AI_GRAPHIC",
    }));
  });

  it("keeps artwork-only disabled until format and objective are explicitly eligible", async () => {
    const user = userEvent.setup();
    const onGenerate = renderToday();
    const selects = screen.getAllByRole("combobox");
    const artworkOnly = screen.getByRole("option", { name: /AI artwork only/ }) as HTMLOptionElement;

    expect(artworkOnly).toBeDisabled();
    await user.click(screen.getByText("Advanced visual mode"));
    expect(screen.getByText(/Choose Single Image or Carousel/)).toBeVisible();

    await user.selectOptions(selects[0], "SINGLE_IMAGE");
    await user.selectOptions(selects[1], "EDUCATION");
    expect(artworkOnly).not.toBeDisabled();
    await user.selectOptions(selects[2], "AI_ARTWORK_ONLY");
    await user.click(screen.getByRole("button", { name: /Generate Today’s Post/ }));

    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      requested_format: "SINGLE_IMAGE",
      requested_post_type: "EDUCATION",
      visual_mode: "AI_ARTWORK_ONLY",
    }));
  });

  it("shows the v2 FULL_AI_GRAPHIC asset as AI-native with no overlay", () => {
    renderReviewDraft(fullAiDraft({
      full_ai_graphic_contract_version: 2,
      overlay: { method: "none", image_ai_used_for_text: true },
    }));

    expect(screen.getAllByText("Artwork & text · AI-native — No overlay").length).toBeGreaterThan(0);
    expect(screen.getByText(/no programmatic pixel overlay or logo composite is applied/i)).toBeVisible();
    expect(screen.queryByText("AI-rendered headline · branded finish")).not.toBeInTheDocument();
    expect(screen.queryByText("Headline · AI-rendered and validated")).not.toBeInTheDocument();
  });

  it("keeps the legacy FULL_AI_GRAPHIC branded-finish wording", () => {
    renderReviewDraft(fullAiDraft({
      full_ai_graphic_contract_version: 1,
      overlay: { method: "sharp_branded_finish_after_validated_ai_headline", image_ai_used_for_text: true },
    }));

    expect(screen.getAllByText("AI-rendered headline · branded finish").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Headline · AI-rendered and validated").length).toBeGreaterThan(0);
    expect(screen.getByText(/only the branded finish is composited afterward/i)).toBeVisible();
    expect(screen.queryByText("Artwork & text · AI-native — No overlay")).not.toBeInTheDocument();
  });

  it("offers an existing eligible Story a one-click AI-native no-overlay regeneration", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const draft = fullAiDraft({
      overlay: { method: "sharp_svg_overlay", image_ai_used_for_text: false },
    });
    draft.visualMode = "AI_VISUAL_WITH_EXACT_OVERLAY";
    draft.primary.format = "STORY";
    draft.primary.postType = "EDUCATION";
    draft.primary.affiliateDisclosure = "";
    draft.primary.verifiedProductId = "";
    renderReviewDraft(draft, onAction);

    await user.click(screen.getByText("Advanced · regeneration and overrides"));
    await user.click(screen.getByRole("button", { name: /Regenerate as AI-native — no overlay/i }));
    expect(onAction).toHaveBeenCalledWith("regenerate", {
      scope: "image",
      visual_mode: "FULL_AI_GRAPHIC",
    });
  });

  it("offers the safe AI-native conversion for an already scheduled eligible Story", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const draft = fullAiDraft({
      overlay: { method: "sharp_svg_overlay", image_ai_used_for_text: false },
    });
    draft.status = "SCHEDULED";
    draft.visualMode = "AI_VISUAL_WITH_EXACT_OVERLAY";
    draft.primary.format = "STORY";
    draft.primary.postType = "EDUCATION";
    draft.primary.affiliateDisclosure = "";
    draft.primary.verifiedProductId = "";
    draft.scheduledFor = "2099-09-10T12:30:00.000Z";
    renderReviewDraft(draft, onAction);

    await user.click(screen.getByText("Advanced · regeneration and overrides"));
    expect(screen.getByText(/preserves its frozen weekly slot, clears the current approval and schedule/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Regenerate as AI-native — no overlay/i }));
    expect(onAction).toHaveBeenCalledWith("regenerate", {
      scope: "image",
      visual_mode: "FULL_AI_GRAPHIC",
    });
  });

  it("bundles a ready companion Story into the parent feed approval by default", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const draft = fullAiDraft({
      full_ai_graphic_contract_version: 2,
      overlay: { method: "none", image_ai_used_for_text: true },
    });
    draft.primary.hooks = ["Pause", "Verify", "Decide"];
    draft.compliance = { passed: true, decision: "PASS" };
    draft.weeklyPlanId = "weekly-cadence-1";
    draft.candidateId = "feed-candidate-1";
    draft.weeklySlotNumber = 1;
    draft.scheduledFor = "2099-09-01T05:30:00.000Z";
    draft.bundleId = "weekly:weekly-cadence-1:feed:feed-candidate-1";
    draft.bundleRole = "PARENT_FEED";

    render(<SocialToday
      draft={draft}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
      weeklyLinked
      companionStoryReady
    />);

    expect(screen.getByText("Companion Story included")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Include companion Story" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", { include_companion_story: true });
  });

  it("waits for an unfinished companion while standalone Stories keep a separate approval", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const parent = fullAiDraft({
      full_ai_graphic_contract_version: 2,
      overlay: { method: "none", image_ai_used_for_text: true },
    });
    parent.primary.hooks = ["Pause", "Verify", "Decide"];
    parent.compliance = { passed: true, decision: "PASS" };
    parent.weeklyPlanId = "weekly-cadence-2";
    parent.candidateId = "feed-candidate-2";
    parent.weeklySlotNumber = 1;
    parent.scheduledFor = "2099-09-01T05:30:00.000Z";
    parent.bundleId = "weekly:weekly-cadence-2:feed:feed-candidate-2";
    parent.bundleRole = "PARENT_FEED";

    const props = {
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
      onAction,
      onAdoptAlternative: vi.fn(),
      onExport: vi.fn(),
      reviewMode: true,
      weeklyLinked: true,
    };
    const view = render(<SocialToday {...props} draft={parent} companionStoryReady={false} />);
    expect(screen.queryByRole("checkbox", { name: "Include companion Story" })).not.toBeInTheDocument();
    expect(screen.getByText(/companion Story is still generating/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve & schedule" })).toBeDisabled();

    const standalone = { ...parent, id: "standalone-story-1", bundleRole: "STANDALONE_STORY", bundleId: "weekly:weekly-cadence-2:story:saturday" };
    view.rerender(<SocialToday {...props} draft={standalone} companionStoryReady={false} />);
    expect(screen.queryByText("Companion Story included")).not.toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve & schedule" });
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {});
  });

  it("allows pending human visual review to approve-and-schedule, then keeps publish-now inside Advanced", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const canonicalCaption = "A practical first step for your next payday.\n\nSave this for payday.\n\nFor education only; not financial advice.\n\n#PinkPaisa #MoneyHabits #EmergencyFund #WomenAndMoney #FinancialEducation";
    const draft = normalizeDraft({
      _id: "draft-pending-visual-review",
      status: "NEEDS_REVIEW",
      scheduled_for: "2026-09-01T12:30:00.000Z",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      current_package: {
        primary_recommendation: {
          internal_title: "Build a first emergency buffer",
          topic: "Emergency fund basics",
          format: "SINGLE_IMAGE",
          objective: "EDUCATION",
          post_type: "EDUCATION",
          content_pillar: "Practical education",
          target_audience_segment: "Women building a first emergency fund",
          hook_options: ["Start small", "Make payday count", "Build a buffer"],
          selected_headline: "Start with one small buffer",
          supporting_text: "Build consistency before chasing a perfect number.",
          caption: "A practical first step for your next payday.",
          cta: "Save this for payday.",
          hashtags: ["##PinkPaisa", "MoneyHabits", "#EmergencyFund", "#WomenAndMoney", "#FinancialEducation"],
          image_generation_prompt: "A full-bleed warm pink editorial illustration of a growing savings buffer",
          alt_text: "An abstract pink illustration of steadily growing savings",
          financial_disclaimer: "For education only; not financial advice.",
        },
      },
      caption_contract: {
        policy: "CAPTION_ONLY",
        caption: canonicalCaption,
        checksum_sha256: "c".repeat(64),
        components: {
          affiliate_disclosure: "",
          caption: "A practical first step for your next payday.",
          cta: "Save this for payday.",
          financial_disclaimer: "For education only; not financial advice.",
          hashtags: "#PinkPaisa #MoneyHabits #EmergencyFund #WomenAndMoney #FinancialEducation",
        },
        component_order: ["affiliate_disclosure", "caption", "cta", "financial_disclaimer", "hashtags"],
        length: canonicalCaption.length,
        violations: [],
        valid: true,
      },
      compliance: { passed: true, decision: "PASS" },
      assets: [{
        _id: "asset-final-1",
        role: "FINAL_COMPOSED",
        url: "/uploads/social/final-1.png",
        original_asset_url: "/uploads/social/original-1.png",
        validation_status: "needs_manual_review",
        manual_review_required: true,
        manual_review_status: "pending",
        manual_review_flags: ["Reviewer must confirm visual fit"],
        image_provider: "OpenAI",
        image_model: "gpt-image-2",
        image_generation_status: "GENERATED",
        source_provenance: "generated",
      }],
    });

    if (!draft) throw new Error("The review fixture must normalize");
    const view = render(<SocialToday
      draft={draft}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
    />);

    const action = screen.getByRole("button", { name: "Approve & schedule" });
    expect(screen.getByText((_, element) => element?.getAttribute("class")?.includes("whitespace-pre-wrap") === true && element.textContent === canonicalCaption)).toBeVisible();
    expect(action).toBeEnabled();
    await user.click(action);
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {
      scheduled_for: "2026-09-01T12:30:00.000Z",
    });

    onAction.mockClear();
    view.rerender(<SocialToday
      draft={{ ...draft, weeklyPlanId: "weekly-1", weeklySlotNumber: 1 }}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
      weeklyLinked
    />);
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {});

    onAction.mockClear();
    view.rerender(<SocialToday
      draft={{ ...draft, scheduledFor: "", weeklyPlanId: "weekly-1", weeklySlotNumber: 1 }}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
      weeklyLinked
    />);
    expect(screen.getByRole("button", { name: "Approve & schedule" })).toBeEnabled();
    expect(screen.queryByText(/Choose a future posting date and time/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {});

    onAction.mockClear();
    view.rerender(<SocialToday
      draft={{ ...draft, weeklyPlanId: "weekly-1", weeklySlotNumber: 1 }}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
      weeklyLinked
    />);
    await user.click(screen.getByText("Advanced · change frozen time"));
    const weeklyAction = screen.getByRole("button", { name: "Approve & schedule" });
    expect(weeklyAction).toBeDisabled();
    const reason = screen.getByText("Required override reason").parentElement?.querySelector("textarea");
    const schedule = screen.getByText("New posting date and time").parentElement?.querySelector("input");
    if (!reason || !schedule) throw new Error("Override controls must be rendered");
    expect(schedule).toHaveValue("2026-09-01T18:00");
    await user.type(reason, "Coordinate with the live workshop timing");
    expect(weeklyAction).toBeDisabled();
    expect(screen.getByText(/Choose a different Asia\/Kolkata posting time/)).toBeVisible();
    await user.clear(schedule);
    await user.type(schedule, "2026-09-02T18:00");
    expect(weeklyAction).toBeEnabled();
    await user.click(weeklyAction);
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {
      scheduled_for: "2026-09-02T12:30:00.000Z",
      schedule_override_reason: "Coordinate with the live workshop timing",
    });

    view.rerender(<SocialToday
      draft={{ ...draft, id: "draft-second-weekly-review", scheduledFor: "2026-09-03T12:30:00.000Z", weeklyPlanId: "weekly-1", weeklySlotNumber: 2 }}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
      weeklyLinked
    />);
    const resetOverride = screen.getByText("Advanced · change frozen time").closest("details");
    expect(resetOverride).not.toHaveAttribute("open");
    await user.click(screen.getByText("Advanced · change frozen time"));
    expect(screen.getByText("Required override reason").parentElement?.querySelector("textarea")).toHaveValue("");
    expect(screen.getByText("New posting date and time").parentElement?.querySelector("input")).toHaveValue("2026-09-03T18:00");

    onAction.mockClear();
    view.rerender(<SocialToday
      draft={{ ...draft, weeklyPlanId: "weekly-1", weeklySlotNumber: 1 }}
      previousDraft={null}
      generationRun={null}
      readiness={EMPTY_READINESS}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      weeklyLinked
    />);
    expect(screen.queryByText("Posting date and time")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));
    expect(onAction).toHaveBeenCalledWith("approve-and-schedule", {});

    onAction.mockClear();
    view.rerender(<SocialToday
      draft={{ ...draft, status: "SCHEDULED" }}
      previousDraft={null}
      generationRun={null}
      readiness={{ ...EMPTY_READINESS, publishingEnabled: true, instagramConnected: true }}
      loading={false}
      generating={false}
      busyAction=""
      dirty={false}
      loadError=""
      onGenerate={vi.fn()}
      onReload={vi.fn()}
      onRecommendationChange={vi.fn()}
      onScheduleChange={vi.fn()}
      onSave={vi.fn()}
      onAction={onAction}
      onAdoptAlternative={vi.fn()}
      onExport={vi.fn()}
      reviewMode
    />);

    expect(screen.getByText("Advanced · publishing override")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish now" })).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Regenerate Strategy" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Advanced · publishing override"));
    const publishNow = screen.getByRole("button", { name: "Publish now" });
    expect(publishNow).toBeEnabled();
    await user.click(publishNow);
    expect(onAction).toHaveBeenCalledWith("publish");
  });
});
