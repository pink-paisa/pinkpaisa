import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type BulkReviewCampaign = {
  id: string;
  title: string;
  sourceLabel: string;
  creativeUrl: string | null;
  caption: string;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
};

type CampaignBulkReviewDialogProps = {
  open: boolean;
  modal?: boolean;
  campaigns: BulkReviewCampaign[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (notes: string) => void;
  onPreview: (campaignId: string) => void;
};

const CampaignBulkReviewDialog = ({
  open,
  modal = true,
  campaigns,
  pending,
  onOpenChange,
  onApprove,
  onPreview,
}: CampaignBulkReviewDialogProps) => {
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const readyCount = useMemo(
    () => campaigns.filter((campaign) => campaign.blockers.length === 0).length,
    [campaigns],
  );
  const blockedCount = campaigns.length - readyCount;

  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    setNotes("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent className="w-[min(96vw,1120px)] max-w-none overflow-hidden rounded-[28px] border border-border/80 p-0 shadow-2xl">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 pr-14">
            <DialogTitle className="font-serif text-2xl">Review selected campaigns</DialogTitle>
            <DialogDescription>
              {readyCount} ready for approval{blockedCount ? `, ${blockedCount} blocked` : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              {campaigns.map((campaign) => {
                const ready = campaign.blockers.length === 0;
                return (
                  <section key={campaign.id} className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] gap-4 rounded-lg border border-border/80 bg-card p-4">
                    <div className="aspect-[4/5] w-28 overflow-hidden rounded-lg border border-border/70 bg-muted/30">
                      {campaign.creativeUrl ? (
                        <button
                          type="button"
                          className="group relative block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => onPreview(campaign.id)}
                          aria-label={`Preview ${campaign.title}`}
                          title="Preview generated post"
                        >
                          <img src={campaign.creativeUrl} alt={`${campaign.title} creative`} className="h-full w-full object-contain" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100" aria-hidden="true">
                            <Maximize2 className="h-5 w-5" />
                          </span>
                        </button>
                      ) : (
                        <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">No creative</div>
                      )}
                    </div>

                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="break-words text-sm font-semibold text-foreground">{campaign.title}</h3>
                          <p className="text-xs text-muted-foreground">{campaign.sourceLabel}</p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${ready ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                          {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                          {ready ? "Ready" : "Blocked"}
                        </span>
                      </div>

                      <p className="line-clamp-4 whitespace-pre-line break-words text-xs leading-5 text-muted-foreground">
                        {campaign.caption || "Caption unavailable"}
                      </p>

                      {campaign.blockers.length ? (
                        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                          {campaign.blockers.map((blocker) => <p key={blocker.code}>{blocker.message}</p>)}
                        </div>
                      ) : campaign.warnings.length ? (
                        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                          {campaign.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="space-y-2">
              <label htmlFor="bulk-review-notes" className="text-sm font-medium text-foreground">Approval note</label>
              <Textarea
                id="bulk-review-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Optional note applied to approved campaigns."
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 bg-background px-6 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex min-w-0 items-start gap-3 text-sm text-foreground">
                <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} disabled={pending || readyCount === 0} />
                <span>I reviewed the selected creatives and captions.</span>
              </label>
              <div className="flex shrink-0 justify-end gap-3">
                <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
                <Button className="rounded-xl" onClick={() => onApprove(notes)} disabled={pending || !confirmed || readyCount === 0}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {pending ? "Approving..." : `Approve ${readyCount} ready`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignBulkReviewDialog;
