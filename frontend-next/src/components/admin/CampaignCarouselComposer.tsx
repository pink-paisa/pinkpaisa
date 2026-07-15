import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, Eye, Images, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingSpinner } from "./AdminShared";
import type { CampaignPostPreview } from "./CampaignPostLightbox";
import { toast } from "sonner";

export type CarouselIssue = {
  run_id?: string;
  product_title?: string;
  code: string;
  message: string;
};

export type CarouselSlide = {
  run_id: string;
  campaign_id: string;
  product_title: string;
  asset_url: string;
  tracked_url: string;
};

export type CarouselComposition = {
  caption_body: string;
  hashtags: string[];
  final_caption: string | null;
  caption_character_count: number;
  disclosure: string | null;
  items: CarouselSlide[];
  scheduled_for?: string | null;
  publish_payload?: {
    content_type?: string;
    asset_urls?: string[];
    caption?: string;
  } | null;
};

export type CarouselPreviewResponse = {
  can_publish: boolean;
  blockers: CarouselIssue[];
  warnings: CarouselIssue[];
  carousel: CarouselComposition;
};

export type CarouselTaskResponse = {
  carousel_task_id: string;
  status: string;
  task_status: string;
  scheduled_for?: string | null;
  available_at?: string | null;
  carousel: CarouselComposition | null;
  runs?: Array<{
    id: string;
    campaign_id: string;
    product_title?: string | null;
    status: string;
    publish_status?: string | null;
    carousel_position?: number | null;
    carousel_size?: number | null;
  }>;
  publish_attempt?: {
    id: string;
    status: string;
    attempt_count: number;
    creation_id?: string | null;
    child_creation_ids?: string[];
    media_id?: string | null;
    permalink?: string | null;
    last_error?: string | null;
  } | null;
  instagram?: {
    media_id?: string | null;
    permalink?: string | null;
    creation_id?: string | null;
    child_creation_ids?: string[];
  } | null;
  error_message?: string | null;
};

const IST_OFFSET_MS = 330 * 60 * 1000;

export const toIstDateTimeInput = (value: Date | string | number) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
};

export const fromIstDateTimeInput = (value: string) => {
  if (!value) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseHashtags = (value: string) => value
  .split(/[\s,]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const getErrorIssues = (error: unknown) => {
  if (!(error instanceof ApiError)) return [];
  return Array.isArray(error.data?.blockers) ? error.data.blockers as CarouselIssue[] : [];
};

export default function CampaignCarouselComposer({
  open,
  runIds,
  modal = true,
  onOpenChange,
  onQueued,
  onPreview,
}: {
  open: boolean;
  runIds: string[];
  modal?: boolean;
  onOpenChange: (open: boolean) => void;
  onQueued: (task: CarouselTaskResponse) => void | Promise<void>;
  onPreview: (preview: CampaignPostPreview) => void;
}) {
  const [orderedRunIds, setOrderedRunIds] = useState<string[]>([]);
  const [captionBody, setCaptionBody] = useState("");
  const [hashtagInput, setHashtagInput] = useState("");
  const [preview, setPreview] = useState<CarouselPreviewResponse | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [scheduleInput, setScheduleInput] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const hashtags = useMemo(() => parseHashtags(hashtagInput), [hashtagInput]);
  const runIdsKey = runIds.join("|");
  const minimumSchedule = toIstDateTimeInput(Date.now() + (6 * 60 * 1000));

  useEffect(() => {
    if (!open) return;
    const initialRunIds = runIdsKey.split("|").filter(Boolean);
    let active = true;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setOrderedRunIds(initialRunIds);
    setCaptionBody("");
    setHashtagInput("");
    setPreview(null);
    setRequestError(null);
    setPublishMode("now");
    setScheduleInput(toIstDateTimeInput(Date.now() + (10 * 60 * 1000)));
    setInitialized(false);
    setInitializing(true);

    void apiFetch<CarouselPreviewResponse>("/marketing-campaigns/admin/carousels/preview", {
      method: "POST",
      body: JSON.stringify({ run_ids: initialRunIds }),
    }).then((response) => {
      if (!active || requestVersion.current !== version) return;
      setPreview(response);
      setRequestError(null);
      setCaptionBody(response.carousel.caption_body || "");
      setHashtagInput((response.carousel.hashtags || []).join(" "));
      setInitialized(true);
    }).catch((error) => {
      if (!active) return;
      const blockers = getErrorIssues(error);
      setPreview((current) => current ? { ...current, can_publish: false, blockers } : null);
      setRequestError(error instanceof Error ? error.message : "Could not prepare the carousel preview.");
    }).finally(() => {
      if (active) setInitializing(false);
    });

    return () => {
      active = false;
    };
  }, [open, runIdsKey]);

  useEffect(() => {
    if (!open || !initialized || orderedRunIds.length < 2) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    const timeout = window.setTimeout(() => {
      setValidating(true);
      void apiFetch<CarouselPreviewResponse>("/marketing-campaigns/admin/carousels/preview", {
        method: "POST",
        body: JSON.stringify({
          run_ids: orderedRunIds,
          caption_body: captionBody,
          hashtags,
        }),
      }).then((response) => {
        if (requestVersion.current === version) {
          setPreview(response);
          setRequestError(null);
        }
      }).catch((error) => {
        if (requestVersion.current !== version) return;
        const blockers = getErrorIssues(error);
        setPreview((current) => current ? {
          ...current,
          can_publish: false,
          blockers: blockers.length ? blockers : [{ code: "carousel_preview_failed", message: error instanceof Error ? error.message : "Carousel preview failed." }],
        } : null);
        setRequestError(error instanceof Error ? error.message : "Carousel preview failed.");
      }).finally(() => {
        if (requestVersion.current === version) setValidating(false);
      });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [captionBody, hashtags, initialized, open, orderedRunIds]);

  const moveSlide = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= orderedRunIds.length) return;
    setOrderedRunIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const submit = async () => {
    const scheduledFor = publishMode === "schedule" ? fromIstDateTimeInput(scheduleInput) : null;
    if (publishMode === "schedule" && !scheduledFor) return;
    try {
      setSubmitting(true);
      const response = await apiFetch<CarouselTaskResponse>("/marketing-campaigns/admin/post-carousel", {
        method: "POST",
        body: JSON.stringify({
          run_ids: orderedRunIds,
          caption_body: captionBody,
          hashtags,
          scheduled_for: scheduledFor,
        }),
      });
      await onQueued(response);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not queue the carousel.";
      setRequestError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const orderedItems = useMemo(() => {
    const itemMap = new Map((preview?.carousel.items || []).map((item) => [item.run_id, item]));
    return orderedRunIds.map((id) => itemMap.get(id)).filter((item): item is CarouselSlide => Boolean(item));
  }, [orderedRunIds, preview?.carousel.items]);

  const showFullPreview = (index: number) => {
    if (!orderedItems.length) return;
    onPreview({
      title: "Affiliate campaign carousel",
      assetUrls: orderedItems.map((item) => item.asset_url),
      startIndex: index,
      contentType: "carousel",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent className="w-[min(96vw,1180px)] max-w-none overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col bg-background">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 pr-14">
            <DialogTitle className="font-serif text-2xl">Create affiliate carousel</DialogTitle>
            <DialogDescription>
              Reorder approved campaign images, edit the shared caption, and publish now or schedule in IST.
            </DialogDescription>
          </DialogHeader>

          {initializing ? (
            <div className="px-6 py-12"><LoadingSpinner /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr),minmax(320px,0.85fr)]">
                <section className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Slides</p>
                      <h3 className="mt-1 text-lg font-semibold">Instagram order</h3>
                    </div>
                    <span className="text-sm text-muted-foreground">{orderedItems.length} images</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {orderedItems.map((item, index) => (
                      <div key={item.run_id} className="flex items-center gap-3 border-b border-border/70 pb-3 last:border-0">
                        <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums">{index + 1}</span>
                        <button
                          type="button"
                          onClick={() => showFullPreview(index)}
                          className="group relative aspect-[4/5] h-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title="Preview slide"
                        >
                          <img src={item.asset_url} alt={`${item.product_title} carousel slide`} className="h-full w-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                            <Eye className="h-4 w-4" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.product_title}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{item.tracked_url}</p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button size="icon" variant="ghost" onClick={() => moveSlide(index, -1)} disabled={index === 0 || validating} title="Move slide up" aria-label={`Move ${item.product_title} up`}>
                            <ArrowUp />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => moveSlide(index, 1)} disabled={index === orderedItems.length - 1 || validating} title="Move slide down" aria-label={`Move ${item.product_title} down`}>
                            <ArrowDown />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {orderedItems.length ? (
                    <Button variant="outline" className="mt-4" onClick={() => showFullPreview(0)}>
                      <Images className="mr-2 h-4 w-4" /> Preview full carousel
                    </Button>
                  ) : null}
                </section>

                <section className="min-w-0 space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium">Caption body</label>
                    <Textarea value={captionBody} onChange={(event) => setCaptionBody(event.target.value)} rows={5} />
                    <p className="mt-2 text-xs text-muted-foreground">Product names, Pink Paisa links, and the affiliate notice are added by the server.</p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium">Hashtags</label>
                    <Input value={hashtagInput} onChange={(event) => setHashtagInput(event.target.value)} placeholder="#PinkPaisa #PartnerPicks" />
                    <p className="mt-2 text-xs text-muted-foreground">Up to eight hashtags, separated by spaces or commas.</p>
                  </div>

                  <div className="border-y border-border/70 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Final Instagram caption</p>
                      <span className={`text-xs tabular-nums ${(preview?.carousel.caption_character_count || 0) > 2200 ? "text-rose-700" : "text-muted-foreground"}`}>
                        {preview?.carousel.caption_character_count || 0}/2200
                      </span>
                    </div>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-5">
                      {preview?.carousel.final_caption || "Waiting for a valid preview..."}
                    </pre>
                  </div>

                  {preview?.blockers.length ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                      <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Cannot publish</div>
                      <ul className="mt-2 space-y-1">
                        {preview.blockers.map((issue, index) => <li key={`${issue.run_id || "carousel"}-${issue.code}-${index}`}>{issue.product_title ? `${issue.product_title}: ` : ""}{issue.message}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {requestError && !preview?.blockers.length ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                      <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Preview unavailable</div>
                      <p className="mt-1">{requestError}</p>
                    </div>
                  ) : null}
                  {preview?.warnings.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-medium">Warnings</p>
                      {preview.warnings.map((issue, index) => <p key={`${issue.run_id || "carousel"}-${issue.code}-${index}`} className="mt-1">{issue.product_title ? `${issue.product_title}: ` : ""}{issue.message}</p>)}
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-2 text-sm font-medium">Publishing</p>
                    <div className="grid grid-cols-2 rounded-lg border border-border p-1">
                      <button type="button" onClick={() => setPublishMode("now")} className={`h-9 rounded-md text-sm font-medium ${publishMode === "now" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                        Publish now
                      </button>
                      <button type="button" onClick={() => setPublishMode("schedule")} className={`h-9 rounded-md text-sm font-medium ${publishMode === "schedule" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                        Schedule
                      </button>
                    </div>
                    {publishMode === "schedule" ? (
                      <div className="mt-3">
                        <label className="mb-2 block text-xs font-medium text-muted-foreground">Date and time in IST</label>
                        <Input type="datetime-local" value={scheduleInput} min={minimumSchedule} onChange={(event) => setScheduleInput(event.target.value)} />
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          )}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/70 px-6 py-4">
            <p className="text-xs text-muted-foreground">{validating ? "Checking the frozen composition..." : preview?.can_publish ? "Ready to queue" : "Resolve the blockers before continuing"}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={initializing || validating || submitting || !preview?.can_publish || (publishMode === "schedule" && !scheduleInput)}>
                {publishMode === "schedule" ? <CalendarClock className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                {submitting ? "Queuing..." : publishMode === "schedule" ? "Schedule carousel" : "Queue carousel"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
