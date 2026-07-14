import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, RefreshCcw, Rocket, ShieldCheck, XCircle } from "lucide-react";

type CampaignRunLite = {
  status: string;
  current_stage?: string | null;
  archived_at?: string | null;
  next_action?: string | null;
  review_status?: string | null;
  publish_status?: string | null;
  publish_readiness?: {
    can_publish: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    checked_at?: string | null;
  } | null;
};

const getNextActionLabel = (run: CampaignRunLite) => {
  const action = run.next_action || "wait_for_worker";
  if (action === "restore_campaign") return "Archived";
  if (action === "open_instagram") return "Published on Instagram";
  if (action === "wait_for_publish") return "Publishing";
  if (action === "review_draft") return "Ready for review";
  if (action === "approve_for_publish") return "Waiting for review approval";
  if (action === "fix_publish_blockers") return "Needs admin action";
  if (action === "retry_failed_task") return "Retry available";
  if (action === "wait_for_creative") return "Generating image";
  if (action === "wait_for_tracking") return "Tracking link";
  if (action.startsWith("wait_for_")) {
    const stage = action.slice("wait_for_".length).replace(/_/g, " ");
    return stage === "queued for daily batch" ? "Waiting in campaign queue" : `Running ${stage}`;
  }
  return action.replace(/_/g, " ");
};

const CampaignPublishActions = ({
  run,
  lastError,
  actionLoading,
  onRefresh,
  onRetry,
  onResetStuckTask,
  onRegenerate,
  onApproveReview,
  onRejectReview,
  onPostNow,
  onSchedule,
  canResetStuck = false,
  instagramConnected = true,
  instagramConnectionWarning = null,
}: {
  run: CampaignRunLite;
  lastError?: string | null;
  actionLoading: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onResetStuckTask: () => void;
  onRegenerate: () => void;
  onApproveReview: () => void;
  onRejectReview: () => void;
  onPostNow: () => void;
  onSchedule: (scheduledFor: string) => void;
  canResetStuck?: boolean;
  instagramConnected?: boolean;
  instagramConnectionWarning?: string | null;
}) => {
  const [scheduledFor, setScheduledFor] = useState("");
  const readinessBlockers = run.publish_readiness?.blockers || [];
  const readinessWarnings = run.publish_readiness?.warnings || [];
  const publishBlockers = [
    ...readinessBlockers,
    ...(!instagramConnected ? [{ code: "instagram_not_connected", message: "Instagram must be connected before publishing." }] : []),
  ];
  const canPublish = run.review_status === "approved"
    && !run.archived_at
    && ["ready", "failed", "scheduled", "draft"].includes(run.publish_status || "")
    && run.publish_readiness?.can_publish === true
    && publishBlockers.length === 0;
  const showRetry = run.status === "failed" || run.publish_status === "failed";
  const minimumScheduleValue = new Date(Date.now() + (5 * 60 * 1000)).toISOString().slice(0, 16);
  const publishFailed = run.publish_status === "failed";
  const publishStatusLabel = (run.publish_status || "not_ready").replace(/_/g, " ");
  const nextActionLabel = getNextActionLabel(run);

  return (
    <div className="rounded-[28px] border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Actions</p>
          <p className="mt-1 text-sm text-muted-foreground">{nextActionLabel}</p>
        </div>
        <div className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium capitalize text-muted-foreground">
          Publish: {publishStatusLabel}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Workflow tools</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Button variant="outline" className="w-full rounded-2xl justify-center" onClick={onRefresh} disabled={actionLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" className="w-full rounded-2xl justify-center" onClick={onRegenerate} disabled={actionLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Regenerate creative
          </Button>
          {canResetStuck && (
            <Button variant="outline" className="w-full rounded-2xl justify-center sm:col-span-2" onClick={onResetStuckTask} disabled={actionLoading}>
              <AlertTriangle className="mr-2 h-4 w-4" /> Reset stuck task
            </Button>
          )}
          {showRetry && (
            <Button variant="outline" className="w-full rounded-2xl justify-center sm:col-span-2" onClick={onRetry} disabled={actionLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Retry failed task
            </Button>
          )}
        </div>
      </div>

      {run.status === "waiting_review" && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-900">
            <ShieldCheck className="h-4 w-4" />
            <p className="font-medium">Review gate</p>
          </div>
          <p className="mt-1 text-sm text-amber-800">Approve this draft to unlock Instagram posting.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="outline" className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={onRejectReview} disabled={actionLoading}>
              <XCircle className="mr-2 h-4 w-4" /> Reject
            </Button>
            <Button className="rounded-2xl" onClick={onApproveReview} disabled={actionLoading}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Approve review
            </Button>
          </div>
        </div>
      )}

      {(publishBlockers.length > 0 || readinessWarnings.length > 0 || instagramConnectionWarning) && (
        <div className="mt-5 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${publishBlockers.length ? "text-rose-600" : "text-amber-600"}`} />
            <div className="min-w-0">
              <p className="font-medium text-foreground">Why can&apos;t I post?</p>
              {publishBlockers.length ? (
                <ul className="mt-2 space-y-1 text-sm text-rose-700">
                  {publishBlockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No hard blockers. Review the warnings below before posting.</p>
              )}
              {readinessWarnings.length || instagramConnectionWarning ? (
                <div className="mt-3 space-y-1 text-sm text-amber-700">
                  {readinessWarnings.map((warning) => (
                    <p key={warning.code}>{warning.message}</p>
                  ))}
                  {instagramConnectionWarning ? <p>{instagramConnectionWarning}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {canPublish && (
        <div className="mt-5 space-y-4 rounded-2xl border border-[#f0d3de] bg-[#fff8fa] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-[#6b4b57]">Instagram publishing</p>
              <p className="text-sm text-[#8a6775]">Post instantly or schedule a time. Once published, the media ID and permalink will be stored on this run.</p>
            </div>
            {publishFailed ? (
              <div className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">
                Publish needs attention
              </div>
            ) : null}
          </div>

          {publishFailed && lastError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Latest publish error</p>
                  <p className="mt-1 break-words">{lastError}</p>
                </div>
              </div>
            </div>
          ) : null}

          <Button className="w-full rounded-2xl justify-center" onClick={onPostNow} disabled={actionLoading}>
            <Rocket className="mr-2 h-4 w-4" /> Queue Instagram post
          </Button>

          <div className="grid gap-3 md:grid-cols-[1fr,auto]">
            <Input type="datetime-local" min={minimumScheduleValue} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={() => onSchedule(scheduledFor)}
              disabled={actionLoading || !scheduledFor}
            >
              Schedule
            </Button>
          </div>
          <p className="text-xs text-[#8a6775]">Schedule at least 5 minutes ahead so the worker can queue and confirm the Instagram post cleanly.</p>
        </div>
      )}

      {!canPublish && run.status !== "waiting_review" && !run.archived_at && (
        <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-4 w-4" />
            <p className="font-medium">{nextActionLabel}</p>
          </div>
          <p className="mt-1">The page updates automatically. Admin action is needed only when a blocker is listed above.</p>
        </div>
      )}
    </div>
  );
};

export default CampaignPublishActions;
