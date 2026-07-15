import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, ExternalLink, Images, RefreshCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./AdminShared";
import type { CampaignPostPreview } from "./CampaignPostLightbox";
import { fromIstDateTimeInput, toIstDateTimeInput, type CarouselTaskResponse } from "./CampaignCarouselComposer";

export default function CampaignCarouselStatusPanel({
  task,
  currentRunId,
  loading,
  actionLoading,
  onRefresh,
  onReschedule,
  onCancel,
  onRetry,
  onPreview,
}: {
  task: CarouselTaskResponse | null;
  currentRunId?: string | null;
  loading: boolean;
  actionLoading: boolean;
  onRefresh: () => void;
  onReschedule: (scheduledFor: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onPreview: (preview: CampaignPostPreview) => void;
}) {
  const [scheduleInput, setScheduleInput] = useState("");

  useEffect(() => {
    const value = task?.scheduled_for || task?.available_at;
    setScheduleInput(value ? toIstDateTimeInput(value) : toIstDateTimeInput(Date.now() + (10 * 60 * 1000)));
  }, [task?.available_at, task?.scheduled_for]);

  if (loading && !task) {
    return <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">Loading carousel status...</div>;
  }
  if (!task) return null;

  const items = task.carousel?.items || [];
  const permalink = task.instagram?.permalink || task.publish_attempt?.permalink || null;
  const mediaId = task.instagram?.media_id || task.publish_attempt?.media_id || null;
  const displayStatus = mediaId ? "published" : task.status;
  const externalOperationStarted = Boolean(
    task.publish_attempt?.creation_id
    || task.publish_attempt?.child_creation_ids?.length
    || ["container_created", "publishing", "uncertain"].includes(task.publish_attempt?.status || "")
  );
  const outcomeUncertain = task.publish_attempt?.status === "uncertain";
  const canManageQueued = task.task_status === "queued" && !externalOperationStarted;
  const canRetry = task.task_status === "failed" && !outcomeUncertain;
  const currentPosition = task.runs?.find((run) => run.id === currentRunId)?.carousel_position || null;

  const previewSlides = (index = 0) => {
    if (!items.length) return;
    onPreview({
      title: "Affiliate campaign carousel",
      assetUrls: items.map((item) => item.asset_url),
      startIndex: index,
      contentType: "carousel",
    });
  };

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Carousel publishing</p>
          <p className="mt-1 text-sm text-muted-foreground">This campaign is slide {currentPosition || "-"} of {items.length || task.runs?.length || "-"} in one shared post.</p>
        </div>
        <StatusBadge status={displayStatus} />
      </div>

      {items.length ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {items.map((item, index) => (
            <button key={item.run_id} type="button" onClick={() => previewSlides(index)} className="relative aspect-[4/5] h-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted" title={`Preview slide ${index + 1}`}>
              <img src={item.asset_url} alt={`${item.product_title} carousel slide`} className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}/{items.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs uppercase text-muted-foreground">Scheduled for</p>
          <p className="mt-1 text-sm font-medium">{task.scheduled_for ? `${new Date(task.scheduled_for).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : "Publish queue"}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs uppercase text-muted-foreground">Instagram result</p>
          <p className="mt-1 truncate text-sm font-medium">{mediaId || "Pending"}</p>
        </div>
      </div>

      {task.error_message ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{task.error_message}</p>
        </div>
      ) : null}

      {externalOperationStarted && !mediaId && !task.error_message ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Instagram container creation has started. Rescheduling and cancellation are locked.</p>
        </div>
      ) : null}

      {canManageQueued ? (
        <div className="mt-4 border-t border-border/70 pt-4">
          <label className="mb-2 block text-xs font-medium text-muted-foreground">Reschedule in IST</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="datetime-local" value={scheduleInput} min={toIstDateTimeInput(Date.now() + (6 * 60 * 1000))} onChange={(event) => setScheduleInput(event.target.value)} />
            <Button variant="outline" onClick={() => {
              const scheduledFor = fromIstDateTimeInput(scheduleInput);
              if (scheduledFor) onReschedule(scheduledFor);
            }} disabled={actionLoading || !scheduleInput}>
              <CalendarClock className="mr-2 h-4 w-4" /> Reschedule
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => previewSlides(0)} disabled={!items.length}>
          <Images className="mr-2 h-4 w-4" /> Preview
        </Button>
        <Button variant="outline" onClick={onRefresh} disabled={loading || actionLoading}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
        </Button>
        {canManageQueued ? (
          <Button variant="destructive" onClick={onCancel} disabled={actionLoading}>
            <XCircle className="mr-2 h-4 w-4" /> Cancel group
          </Button>
        ) : null}
        {canRetry ? (
          <Button onClick={onRetry} disabled={actionLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Retry group
          </Button>
        ) : null}
        {permalink ? (
          <Button asChild>
            <a href={permalink} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Open on Instagram</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
