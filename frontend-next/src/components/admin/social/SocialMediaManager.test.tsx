import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SocialMediaManager from "./SocialMediaManager";

const queuedDraft = {
  _id: "draft-queue-1",
  status: "NEEDS_REVIEW",
  generation_date: "2026-08-24",
  updated_at: "2026-08-24T06:00:00.000Z",
  current_package: {
    primary_recommendation: {
      internal_title: "Queue draft",
      topic: "Emergency savings",
      format_content: {
        format: "SINGLE_IMAGE",
        objective: "EDUCATION",
        content_pillar: "Money Education",
        target_audience: "Pink Paisa community",
        caption: "Build a small buffer first.",
        cta: "Save this post.",
        hashtags: ["#PinkPaisa"],
      },
    },
  },
};

const reviewReadyDraft = (id: string, title: string, weeklyPlanId: string | null, slot = 1) => ({
  _id: id,
  status: "NEEDS_REVIEW",
  ...(weeklyPlanId ? { weekly_plan_id: weeklyPlanId, candidate_id: `${id}-candidate`, weekly_slot_number: slot } : {}),
  scheduled_for: `2099-09-0${slot}T12:30:00.000Z`,
  compliance: { passed: true, decision: "PASS" },
  current_package: { primary_recommendation: {
    internal_title: title,
    topic: "Emergency buffer",
    format: "SINGLE_IMAGE",
    objective: "EDUCATION",
    post_type: "EDUCATION",
    content_pillar: "Community",
    target_audience_segment: "Pink Paisa community",
    hook_options: ["Start small", "Build slowly", "Keep going"],
    selected_headline: "Start with a small buffer",
    caption: "Build a small buffer first.",
    cta: "Save this post.",
    hashtags: ["#PinkPaisa", "#Savings", "#WomenAndMoney", "#MoneyHabits", "#EmergencyFund"],
    image_generation_prompt: "A warm editorial savings illustration",
    alt_text: "A pink savings illustration",
  } },
  assets: [{ _id: `${id}-asset`, role: "FINAL_COMPOSED", url: `/uploads/${id}.png`, original_asset_url: `/uploads/${id}-original.png`, source_provenance: "generated", status: "VALID" }],
});

let includeDrafts = false;
let detailGenerationRun: Record<string, unknown> | null = null;
let workSummaryResponse: Record<string, unknown> | null = null;
let customDrafts: Record<string, unknown>[] | null = null;
let approveScheduleResponse: Record<string, unknown> | null = null;
let draftDetailFailures: Record<string, number> = {};

const apiFetch = vi.fn(async (path: string, _options?: Record<string, unknown>) => {
  const requestPath = String(path || "");
  if (requestPath.includes("/today")) return { data: { draft: null, previous_draft: null, generation_run: null, readiness: {} } };
  if (requestPath.includes("weekly-plans/current")) return { data: { plan: null } };
  if (requestPath.includes("research/weekly")) return { data: { research: null } };
  if (requestPath.endsWith("/approve-and-schedule")) return approveScheduleResponse || {};
  if (requestPath.includes("/drafts?")) return { data: { drafts: customDrafts || (includeDrafts ? [queuedDraft] : []) } };
  const customDetail = customDrafts?.find((draft) => requestPath.endsWith(`/drafts/${String(draft._id)}`));
  if (customDetail) {
    const id = String(customDetail._id);
    if ((draftDetailFailures[id] || 0) > 0) {
      draftDetailFailures[id] -= 1;
      throw new Error("Temporary draft detail failure");
    }
    return { draft: customDetail };
  }
  if (requestPath.includes("/drafts/draft-next-review")) return { draft: customDrafts?.find((draft) => draft._id === "draft-next-review") };
  if (requestPath.includes("/drafts/draft-queue-1")) return { draft: { ...queuedDraft, generation_run: detailGenerationRun } };
  if (requestPath.includes("manual-actions")) return { data: { actions: [] } };
  if (requestPath.includes("analytics/summary")) return { data: { summary: null } };
  if (requestPath.includes("work-summary")) return workSummaryResponse || {};
  if (requestPath.includes("community")) return { data: { items: [] } };
  if (requestPath.includes("connections")) return { data: { connections: [] } };
  if (requestPath.includes("settings")) return { data: { settings: {}, readiness: {} } };
  return {};
});

vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args as [string, Record<string, unknown>?]) }));

describe("Social Media Manager workspace composition", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    includeDrafts = false;
    detailGenerationRun = null;
    workSummaryResponse = null;
    customDrafts = null;
    approveScheduleResponse = null;
    draftDetailFailures = {};
  });

  it("renders exactly the five simplified workspace tabs", async () => {
    render(<SocialMediaManager />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Strategy", "Content", "Results", "Community", "Setup"]);
  });

  it("composes list, calendar and one-off creation inside Content", async () => {
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(await screen.findByRole("button", { name: "List" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Create one-off/ })).toBeVisible();
  });

  it("preloads actionable badges and defaults Content to Needs Action", async () => {
    workSummaryResponse = { counts: { strategy: 1, content: 4, community: 2, results: 0, setup: 1 }, content: { actionable_count: 4, needs_review: 2, terminal_failure: 1, open_manual_action: 1, generating_waiting: 0 } };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    expect(await screen.findByRole("tab", { name: /Content\s*4/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Community\s*2/ })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /Content\s*4/ }));
    expect(await screen.findByRole("button", { name: "Needs Action" })).toHaveClass("bg-primary");
  });

  it("keeps drafts requiring fresh generation visible after higher-priority actions", async () => {
    customDrafts = [{ ...reviewReadyDraft("draft-generation-recovery", "Fresh image required", "weekly-recovery"), status: "DRAFT" }];
    workSummaryResponse = { content: { actionable_count: 2, generating_waiting: 2 } };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));

    const recovery = await screen.findByRole("region", { name: "Generation recovery" });
    expect(within(recovery).getByText("Fresh image required")).toBeVisible();
    expect(within(recovery).getByText(/1 creative is generating or waiting for a required generation action/)).toBeVisible();
    await user.click(within(recovery).getByRole("button", { name: "Open generation action" }));
    expect(await screen.findByRole("dialog", { name: "Fresh image required" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate required creative revision" })).toBeVisible();
  });

  it("surfaces unlinked generation and publication failures in their actionable workspaces", async () => {
    workSummaryResponse = {
      counts: { strategy: 0, content: 1, results: 1, community: 0, setup: 0 },
      content: {
        actionable_count: 1,
        terminal_failure: 1,
        terminal_failure_items: [{
          type: "GENERATION_RUN",
          id: "run-failed",
          generation_run_id: "run-failed",
          status: "FAILED_IMAGE_GENERATION",
          code: "image_provider_failed",
          message: "OpenAI image generation failed visibly.",
        }],
      },
      results: {
        actionable_count: 1,
        terminal_failure: 1,
        terminal_failure_items: [{
          type: "PUBLICATION",
          id: "publication-uncertain",
          publication_id: "publication-uncertain",
          status: "UNCERTAIN",
          code: "provider_outcome_uncertain",
          message: "Meta outcome requires reconciliation.",
        }],
      },
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);

    await user.click(await screen.findByRole("tab", { name: /Content\s*1/ }));
    expect(await screen.findByRole("region", { name: "Unlinked creative failures" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry generation" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/social-media-manager/admin/runs/run-failed/retry",
      expect.objectContaining({ method: "POST" }),
    ));

    await user.click(screen.getByRole("tab", { name: /Results\s*1/ }));
    expect(await screen.findByRole("region", { name: "Publishing failures" })).toBeVisible();
    expect(screen.getByText("Meta outcome requires reconciliation.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open recovery actions" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm published outcome" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Confirmed Meta media ID for publication-uncertain" }), "meta-media-456");
    await user.type(screen.getByRole("textbox", { name: "Publication reconciliation notes for publication-uncertain" }), "Verified on the Pink Paisa Instagram profile.");
    await user.click(screen.getByRole("button", { name: "Confirm published outcome" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/social-media-manager/admin/publications/publication-uncertain/reconcile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          external_publication_id: "meta-media-456",
          notes: "Verified on the Pink Paisa Instagram profile.",
        }),
      }),
    ));
  });

  it("keeps model, retry, full-AI and publishing overrides collapsed under Advanced", async () => {
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: "Setup" }));

    expect(await screen.findByText("Advanced · publishing override")).toBeVisible();
    expect(screen.getByText("Advanced · models, retries and visual overrides")).toBeVisible();
    expect(screen.getByText("Supervisor model")).not.toBeVisible();
    expect(screen.getByText("Image retries")).not.toBeVisible();
    expect(screen.getByText("Auto-publish")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: /^(Refresh|Reload)/i })).not.toBeInTheDocument();
  });

  it("opens list and calendar items in the same review drawer", async () => {
    includeDrafts = true;
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click(await screen.findByRole("button", { name: "Review creative" }));
    expect(await screen.findByRole("dialog", { name: "Queue draft" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close/i }));

    await user.click(screen.getByRole("button", { name: "Calendar" }));
    const calendarTitle = await screen.findByText("Queue draft");
    await user.click(calendarTitle.closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Queue draft" })).toBeVisible();
  });

  it("uses the selected draft's nested generation run and clears it when absent", async () => {
    includeDrafts = true;
    detailGenerationRun = {
      _id: "detail-run-1",
      status: "SUCCEEDED",
      current_stage: "COMPLETED",
      stage_executions: [],
      usage: {},
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click(await screen.findByRole("button", { name: "Review creative" }));
    await user.click(screen.getByText("Advanced · generation run and cost"));
    expect(await screen.findByText(/Run detail-run-1/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close/i }));

    detailGenerationRun = null;
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    const calendarTitle = await screen.findByText("Queue draft");
    await user.click(calendarTitle.closest("button")!);
    await screen.findByRole("dialog", { name: "Queue draft" });
    expect(screen.queryByText(/Run detail-run-1/)).not.toBeInTheDocument();
  });

  it("opens the next weekly creative automatically after Approve & schedule", async () => {
    const reviewDraft = (id: string, title: string) => ({
      _id: id,
      status: "NEEDS_REVIEW",
      weekly_plan_id: "weekly-queue-1",
      candidate_id: `${id}-candidate`,
      weekly_slot_number: id === "draft-first-review" ? 1 : 2,
      scheduled_for: id === "draft-first-review" ? "2099-09-01T12:30:00.000Z" : "2099-09-03T12:30:00.000Z",
      compliance: { passed: true, decision: "PASS" },
      current_package: { primary_recommendation: {
        internal_title: title,
        topic: "Emergency buffer",
        format: "SINGLE_IMAGE",
        objective: "EDUCATION",
        post_type: "EDUCATION",
        content_pillar: "Community",
        target_audience_segment: "Pink Paisa community",
        hook_options: ["Start small", "Build slowly", "Keep going"],
        selected_headline: "Start with a small buffer",
        caption: "Build a small buffer first.",
        cta: "Save this post.",
        hashtags: ["#PinkPaisa", "#Savings", "#WomenAndMoney", "#MoneyHabits", "#EmergencyFund"],
        image_generation_prompt: "A warm editorial savings illustration",
        alt_text: "A pink savings illustration",
      } },
      assets: [{ _id: `${id}-asset`, role: "FINAL_COMPOSED", url: `/uploads/${id}.png`, original_asset_url: `/uploads/${id}-original.png`, source_provenance: "generated", status: "VALID" }],
    });
    customDrafts = [reviewDraft("draft-first-review", "First weekly creative"), reviewDraft("draft-next-review", "Next weekly creative")];
    approveScheduleResponse = {
      draft: { ...customDrafts[0], status: "SCHEDULED" },
      queue_navigation: { next_review_draft_id: "draft-next-review", remaining_review_count: 2, waiting_generation_count: 0 },
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click((await screen.findAllByRole("button", { name: "Review creative" }))[0]);
    expect(await screen.findByRole("dialog", { name: "First weekly creative" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));
    expect(await screen.findByRole("dialog", { name: "Next weekly creative" })).toBeVisible();
    expect(screen.getByText(/1 more creative waiting/)).toBeVisible();
    const approveCall = apiFetch.mock.calls.find(([path]) => String(path).endsWith("/approve-and-schedule"));
    expect(approveCall?.[1]).toMatchObject({ body: "{}" });
  });

  it("does not start or complete weekly queue navigation for a one-off draft", async () => {
    customDrafts = [
      reviewReadyDraft("draft-one-off", "One-off creative", null),
      reviewReadyDraft("draft-unrelated", "Unrelated creative", null, 2),
    ];
    approveScheduleResponse = {
      draft: { ...customDrafts[0], status: "SCHEDULED" },
      queue_navigation: { next_review_draft_id: "draft-unrelated", remaining_review_count: 1, waiting_generation_count: 0 },
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click((await screen.findAllByRole("button", { name: "Review creative" }))[0]);
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));

    expect(await screen.findByRole("dialog", { name: "One-off creative" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Unrelated creative" })).not.toBeInTheDocument();
    expect(screen.queryByText("All weekly creatives reviewed")).not.toBeInTheDocument();
    expect(screen.getByText("Complete Instagram caption")).toBeVisible();
  });

  it("retries a failed next-draft open through a weekly-plan-scoped work summary", async () => {
    customDrafts = [
      reviewReadyDraft("draft-retry-first", "Retry queue first", "weekly-retry", 1),
      reviewReadyDraft("draft-retry-next", "Retry queue next", "weekly-retry", 2),
    ];
    draftDetailFailures = { "draft-retry-next": 1 };
    approveScheduleResponse = {
      draft: { ...customDrafts[0], status: "SCHEDULED" },
      queue_navigation: { next_review_draft_id: "draft-retry-next", remaining_review_count: 1, waiting_generation_count: 0 },
    };
    workSummaryResponse = {
      content: { needs_review: 1, generating_waiting: 0 },
      next_review_draft_id: "draft-retry-next",
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click((await screen.findAllByRole("button", { name: "Review creative" }))[0]);
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));

    expect(await screen.findByRole("dialog", { name: "Retry queue next" })).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith("/social-media-manager/admin/work-summary?weekly_plan_id=weekly-retry");
    expect(apiFetch.mock.calls.filter(([path]) => String(path).endsWith("/drafts/draft-retry-next"))).toHaveLength(2);
  });

  it("refuses a scoped poll result that belongs to another weekly plan", async () => {
    customDrafts = [
      reviewReadyDraft("draft-scope-first", "Scoped queue first", "weekly-scope-a", 1),
      reviewReadyDraft("draft-other-week", "Other week creative", "weekly-scope-b", 2),
    ];
    approveScheduleResponse = {
      draft: { ...customDrafts[0], status: "SCHEDULED" },
      queue_navigation: { next_review_draft_id: null, remaining_review_count: 0, waiting_generation_count: 1 },
    };
    workSummaryResponse = {
      content: { needs_review: 1, generating_waiting: 0 },
      next_review_draft_id: "draft-other-week",
    };
    const user = userEvent.setup();
    render(<SocialMediaManager />);
    await user.click(screen.getByRole("tab", { name: /Content/ }));
    await user.click((await screen.findAllByRole("button", { name: "Review creative" }))[0]);
    await user.click(screen.getByRole("button", { name: "Approve & schedule" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/social-media-manager/admin/work-summary?weekly_plan_id=weekly-scope-a"));
    expect(screen.getByRole("dialog", { name: "Scoped queue first" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Other week creative" })).not.toBeInTheDocument();
  });
});
