import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { normalizeManualAction } from "./adapters";
import { SocialManualActionsPanel } from "./SocialManualActionsPanel";

describe("SocialManualActionsPanel evidence", () => {
  it("retains every linked entity and structured system evidence", async () => {
    const action = normalizeManualAction({
      _id: "action-1",
      action_key: "publication-reconcile:publication-1",
      action_type: "PUBLISHING_RECOVERY",
      status: "COMPLETED",
      priority: "CRITICAL",
      title: "Reconcile uncertain publication",
      description: "Confirm the provider outcome.",
      instructions: ["Check Meta"],
      provider: "META",
      weekly_plan_id: "plan-1",
      generation_run_id: "run-1",
      draft_id: "draft-1",
      publication_id: "publication-1",
      community_item_id: "community-1",
      connection_health_id: "connection-1",
      external_reference_id: "provider-123",
      completion_source: "SYSTEM",
      resolution_evidence: { external_reply_id: "reply-123", confirmed: true },
    });

    render(<SocialManualActionsPanel
      actions={[action]}
      loading={false}
      error=""
      actionId=""
      onReload={vi.fn()}
      onOpenDraft={vi.fn()}
      onUpdate={vi.fn(async () => true)}
    />);

    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByText("7 linked records")).toBeVisible();
    expect(screen.getByText("run-1")).toBeInTheDocument();
    expect(screen.getByText("publication-1")).toBeInTheDocument();
    expect(screen.getByText("community-1")).toBeInTheDocument();
    expect(screen.getByText("connection-1")).toBeInTheDocument();
    expect(screen.getByText("provider-123")).toBeInTheDocument();
    expect(screen.getByText("reply-123")).toBeInTheDocument();
    expect(screen.getByText("Completed by verified system state")).toBeVisible();
  });

  it("requires the dedicated provider-evidence flow for uncertain reconciliation actions", () => {
    const action = normalizeManualAction({
      _id: "action-reconcile",
      action_key: "social-community-send-reconciliation:community-1:checksum",
      action_type: "COMMUNITY_REPLY",
      status: "OPEN",
      priority: "CRITICAL",
      title: "Reconcile uncertain Meta reply",
      description: "Check the actual provider outcome.",
      instructions: [],
      community_item_id: "community-1",
    });

    render(<SocialManualActionsPanel
      actions={[action]}
      loading={false}
      error=""
      actionId=""
      onReload={vi.fn()}
      onOpenDraft={vi.fn()}
      onUpdate={vi.fn(async () => true)}
    />);

    expect(screen.getByText("Authoritative provider evidence required")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});
