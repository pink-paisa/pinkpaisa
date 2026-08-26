import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialGeneratedContentCleanup } from "./SocialGeneratedContentCleanup";

const phrase = "DELETE ALL GENERATED CONTENT";
let blockers: Array<{ code: string; count: number; message: string }> = [];

const apiFetch = vi.fn(async (path: string, options?: RequestInit) => {
  if (String(path).endsWith("cleanup-preview")) return {
    confirmation_phrase: phrase,
    purge_token: "signed-preview-token",
    generated_at: "2026-08-26T04:00:00.000Z",
    expires_at: "2026-08-26T04:10:00.000Z",
    counts: { drafts: 6, assets: 65, generation_runs: 25, weekly_plans: 1, research_sources: 102, manual_actions: 0 },
    total_count: 199,
    local_files: { count: 70, bytes: 13_721_862 },
    blockers,
    preserved: { audit_events: 75, publications: 0 },
    exclusions: ["Immutable audit history", "Catalog products and customers"],
  };
  if (String(path).endsWith("generated-content") && options?.method === "DELETE") return {
    deleted: { drafts: 6, assets: 65, generation_runs: 25, weekly_plans: 1, research_sources: 102, manual_actions: 0 },
    total_deleted: 199,
    usage_ledgers_created: 25,
    file_cleanup: { requested: 70, deleted: 70, missing: 0, failed: 0, failures: [] },
    retained_audit_event_id: "audit-cleanup-1",
    completed_at: "2026-08-26T04:01:00.000Z",
    reused: false,
    exclusions: ["Immutable audit history"],
  };
  return {};
});

vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args as [string, RequestInit?]) }));

describe("SocialGeneratedContentCleanup", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    blockers = [];
  });

  it("requires a reviewed scope and the exact typed phrase before one destructive request", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<SocialGeneratedContentCleanup onDeleted={onDeleted} />);

    expect(apiFetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Review deletion" }));
    expect(await screen.findByRole("dialog", { name: "Delete generated Social Manager content?" })).toBeVisible();
    expect(screen.getByText("199 database records")).toBeVisible();
    expect(screen.getByText(/70 local files/)).toBeVisible();

    const confirmation = screen.getByLabelText(/Type DELETE ALL GENERATED CONTENT/);
    const deleteButton = screen.getByRole("button", { name: "Delete generated content" });
    await user.type(confirmation, "delete all generated content");
    expect(deleteButton).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, phrase);
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/social-media-manager/admin/generated-content",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Idempotency-Key": "social-generated-content-purge:signed-preview-token" },
        body: JSON.stringify({ confirmation: phrase, purge_token: "signed-preview-token" }),
      }),
    ));
    expect(await screen.findByText("Generated content deleted")).toBeVisible();
    expect(screen.getByText(/199 database records and 70 local files were removed/)).toBeVisible();
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("never issues DELETE when preview has an active-work blocker or the dialog is cancelled", async () => {
    blockers = [{ code: "generation_in_progress", count: 1, message: "One generation is still running." }];
    const user = userEvent.setup();
    render(<SocialGeneratedContentCleanup onDeleted={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Review deletion" }));
    expect(await screen.findByText("Cleanup is blocked")).toBeVisible();
    expect(screen.getByText("One generation is still running.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete generated content" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(apiFetch.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
  });
});
