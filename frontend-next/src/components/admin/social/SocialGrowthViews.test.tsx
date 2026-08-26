import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { normalizeCommunityItem, normalizeWeeklyPlanResponse } from "./adapters";
import { SocialCommunityInboxView, SocialWeeklyStrategyView } from "./SocialGrowthViews";

const planFor = (status: string) => normalizeWeeklyPlanResponse({
  data: {
    id: `plan-${status.toLowerCase()}`,
    status,
    week_start: "2026-08-24T00:00:00.000Z",
    week_end: "2026-08-30T23:59:59.000Z",
    timezone: "Asia/Kolkata",
    max_feed_posts: 3,
    rationale: "A balanced three-post education plan.",
    selected_posts: [],
    candidates: [],
  },
});

const props = {
  loading: false,
  action: "",
  error: "",
  onReload: vi.fn(),
  onGenerate: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onProduce: vi.fn(),
  onOpenDraft: vi.fn(),
  onReplaceSlot: vi.fn(async () => true),
};

describe("SocialWeeklyStrategyView", () => {
  it("shows review actions only while the plan is awaiting review", () => {
    const reviewable = planFor("NEEDS_REVIEW");
    if (!reviewable) throw new Error("Reviewable weekly plan fixture must normalize");
    const view = render(<SocialWeeklyStrategyView {...props} plan={reviewable} />);

    expect(screen.getByRole("button", { name: "Reject" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve plan & start generation" })).toBeVisible();

    const locked = planFor("APPROVED");
    if (!locked) throw new Error("Approved weekly plan fixture must normalize");
    view.rerender(<SocialWeeklyStrategyView {...props} plan={locked} />);

    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve plan & start generation" })).not.toBeInTheDocument();
    expect(screen.getByText("Status only · plan history protected")).toBeVisible();
  });

  it("replaces one reviewable slot from the unused retained candidate pool", async () => {
    const user = userEvent.setup();
    const onReplaceSlot = vi.fn(async () => true);
    const plan = normalizeWeeklyPlanResponse({
      plan: {
        id: "plan-replace",
        status: "NEEDS_REVIEW",
        week_start: "2026-08-24T00:00:00.000Z",
        week_end: "2026-08-30T23:59:59.000Z",
        selected_posts: [{ id: "candidate-1", slot_number: 1, topic: "First idea", scheduled_for: "2026-08-25T12:30:00.000Z" }],
        candidates: [{ id: "candidate-1", topic: "First idea", disposition: "SELECTED" }, { id: "candidate-2", topic: "Replacement idea", disposition: "RETAINED" }],
      },
    });
    if (!plan) throw new Error("Replacement fixture must normalize");
    render(<SocialWeeklyStrategyView {...props} plan={plan} onReplaceSlot={onReplaceSlot} />);

    expect(screen.queryByRole("button", { name: "Generate weekly plan" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace this slot" }));
    expect(screen.getByRole("button", { name: "Already selected" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use for Post 1" }));
    expect(onReplaceSlot).toHaveBeenCalledWith(expect.objectContaining({ order: 1, scheduledFor: "2026-08-25T12:30:00.000Z" }), "candidate-2");
  });

  it("blocks approval for a partial five-feed/daily-Story plan and shows the exact missing cadence", () => {
    const plan = normalizeWeeklyPlanResponse({ plan: {
      id: "partial-five-feed-plan",
      status: "NEEDS_REVIEW",
      maximum_feed_posts: 5,
      selected_posts: [1, 2, 3, 4, 5].map((slot) => ({
        candidate_id: `feed-${slot}`,
        slot_number: slot,
        candidate: { title: `Feed ${slot}`, topic: "Money", format: "SINGLE_IMAGE", objective: "EDUCATION" },
      })),
      story_plan: [{
        candidate_id: "story-1",
        parent_candidate_id: "feed-1",
        bundle_role: "COMPANION_STORY",
        candidate: { title: "Story 1", topic: "Money", format: "STORY", objective: "EDUCATION" },
      }],
    } });
    if (!plan) throw new Error("Partial cadence fixture must normalize");
    render(<SocialWeeklyStrategyView {...props} plan={plan} />);

    expect(screen.getByRole("button", { name: "Approve plan & start generation" })).toBeDisabled();
    expect(screen.getByText("Weekly cadence is incomplete")).toBeVisible();
    expect(screen.getByText(/5 feed post\(s\), 1 companion Story package\(s\) and 0 standalone Story package\(s\)/)).toBeVisible();
  });

  it("shows the accounted rolling four-week mix and its visible limitation", () => {
    const plan = normalizeWeeklyPlanResponse({ plan: {
      id: "mix-accounted-plan",
      status: "APPROVED",
      maximum_feed_posts: 3,
      selected_posts: [],
      config_snapshot: {
        content_mix_snapshot: {
          window_weeks: 4,
          history_weeks_found: 2,
          total_posts: 15,
          counts: { MONEY: 7, BODY_FITNESS: 3, WELLNESS_BEAUTY: 2, WOMEN_LIFE: 2, PINK_PAISA: 1 },
          target_percentages: { MONEY: 40, BODY_FITNESS: 20, WELLNESS_BEAUTY: 15, WOMEN_LIFE: 15, PINK_PAISA: 10 },
          actual_percentages: { MONEY: 46.7, BODY_FITNESS: 20, WELLNESS_BEAUTY: 13.3, WOMEN_LIFE: 13.3, PINK_PAISA: 6.7 },
          limitation: "Only 2 prior approved weeks were available; the rolling mix remains visibly accounted.",
        },
      },
    } });
    if (!plan) throw new Error("Mix fixture must normalize");
    render(<SocialWeeklyStrategyView {...props} plan={plan} />);

    expect(screen.getByText("Rolling four-week content mix")).toBeVisible();
    expect(screen.getByText((_text, element) => element?.tagName === "P" && element.textContent === "46.7% actual · 40% target")).toBeVisible();
    expect(screen.getByText(/Only 2 prior approved weeks were available/)).toBeVisible();
  });
});

describe("SocialCommunityInboxView", () => {
  it("edits and durably queues a recommended reply with one Approve & send action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const item = normalizeCommunityItem({
      id: "community-1",
      status: "RECOMMENDED",
      source_type: "COMMENT",
      message: "How do I begin?",
      author_label: "Ananya",
      reply_recommendation: { suggested_reply: "Start with one small step.", confidence: 0.94 },
    });
    render(<SocialCommunityInboxView items={[item]} loading={false} error="" filter="ALL" actionId="" onFilterChange={vi.fn()} onReload={vi.fn()} onAction={onAction} />);

    const editor = screen.getByRole("textbox", { name: "Reply to Ananya" });
    await user.clear(editor);
    await user.type(editor, "Start with a small emergency buffer.");
    await user.click(screen.getByRole("button", { name: "Approve & send" }));
    expect(onAction).toHaveBeenCalledWith(item, "approve-and-send", { reply: "Start with a small emergency buffer." });
    expect(screen.queryByRole("button", { name: "Approve reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send approved reply" })).not.toBeInTheDocument();
  });

  it("reconciles an uncertain delivery only with a confirmed Meta reply ID and notes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const item = normalizeCommunityItem({
      id: "community-uncertain",
      status: "SEND_UNCERTAIN",
      source_type: "COMMENT",
      message: "Thanks!",
      author_label: "Meera",
      reply_recommendation: { suggested_reply: "You are welcome.", confidence: 0.96 },
      available_actions: { reconcile_send: true },
    });
    render(<SocialCommunityInboxView items={[item]} loading={false} error="" filter="ALL" actionId="" onFilterChange={vi.fn()} onReload={vi.fn()} onAction={onAction} />);

    expect(screen.getByRole("button", { name: "Confirm reconciled delivery" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Confirmed Meta reply identifier" }), "meta-reply-123");
    await user.type(screen.getByRole("textbox", { name: "Community reconciliation notes" }), "Verified in Meta Business Suite.");
    await user.click(screen.getByRole("button", { name: "Confirm reconciled delivery" }));
    expect(onAction).toHaveBeenCalledWith(item, "reconcile", {
      external_reply_id: "meta-reply-123",
      notes: "Verified in Meta Business Suite.",
    });
  });

  it("acknowledges and resolves escalations without exposing a send action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const pending = normalizeCommunityItem({
      id: "community-escalated",
      status: "ESCALATION_REQUIRED",
      source_type: "DIRECT_MESSAGE",
      classification: "SENSITIVE",
      message: "I need personalised financial advice.",
      author_label: "Customer",
      escalation_reason: "A qualified human must handle this request.",
      escalation_state: "PENDING",
      available_actions: { acknowledge_escalation: true },
    });
    const view = render(<SocialCommunityInboxView items={[pending]} loading={false} error="" filter="ALL" actionId="" onFilterChange={vi.fn()} onReload={vi.fn()} onAction={onAction} />);

    expect(screen.queryByRole("button", { name: "Approve & send" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Escalation handling notes" }), "Assigned to the customer support lead.");
    await user.click(screen.getByRole("button", { name: "Acknowledge escalation" }));
    expect(onAction).toHaveBeenCalledWith(pending, "acknowledge-escalation", { notes: "Assigned to the customer support lead." });

    const acknowledged = normalizeCommunityItem({
      ...pending.metadata,
      id: pending.id,
      status: "ESCALATION_REQUIRED",
      escalation_state: "ACKNOWLEDGED",
      escalation_acknowledged_at: "2026-08-24T12:00:00.000Z",
      available_actions: { resolve_escalation: true },
    });
    view.rerender(<SocialCommunityInboxView items={[acknowledged]} loading={false} error="" filter="ALL" actionId="" onFilterChange={vi.fn()} onReload={vi.fn()} onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Resolve escalation" })).toBeVisible();
  });
});
