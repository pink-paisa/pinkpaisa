import { ComponentProps } from "react";
import { CalendarDays, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "../AdminShared";
import { fromDateTimeLocal } from "./adapters";
import { provenanceLabels } from "./socialWorkflow";
import { SocialAuditView } from "./SocialSupportingViews";
import { SocialToday } from "./SocialToday";
import { SocialDraft } from "./types";

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SocialDraft | null;
  todayProps: ComponentProps<typeof SocialToday>;
  queueNavigation?: {
    remainingReviewCount: number;
    waitingGenerationCount: number;
    unresolvedFailureCount?: number;
    openManualBlockerCount?: number;
    firstFailureDraftId?: string;
    complete: boolean;
  };
  onOpenCalendar?: () => void;
  onOpenFailureDraft?: (draftId: string) => void;
};

export const SocialDraftReviewDrawer = ({ open, onOpenChange, draft, todayProps, queueNavigation, onOpenCalendar, onOpenFailureDraft }: Props) => {
  const scheduledFor = draft?.scheduledFor ? fromDateTimeLocal(draft.scheduledFor) || draft.scheduledFor : "";
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && todayProps.dirty && typeof window !== "undefined" && !window.confirm("Discard unsaved social draft edits?")) return;
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-none overflow-y-auto p-0 sm:max-w-[min(1120px,95vw)]">
        <SheetHeader className="sticky top-0 z-20 border-b bg-background/95 px-6 py-5 pr-14 backdrop-blur">
          {queueNavigation?.complete ? <>
            <div><Badge className="bg-emerald-600 text-white">Weekly queue complete</Badge></div>
            <SheetTitle className="font-serif text-2xl">Weekly review complete</SheetTitle>
            <SheetDescription>Every creative in this weekly review session has been approved and assigned to its frozen slot.</SheetDescription>
          </> : <>
            <div className="flex flex-wrap items-center gap-2">
              {draft ? <StatusBadge status={String(draft.status).toLowerCase()} /> : null}
              {scheduledFor ? <Badge variant="outline">{draft?.weeklyPlanId && String(draft.status).toUpperCase() !== "SCHEDULED" ? "Frozen slot" : "Scheduled"} {new Date(scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</Badge> : null}
              {draft ? provenanceLabels(draft).map((label) => <Badge key={label} variant="secondary">{label}</Badge>) : null}
              {draft?.visualModeResolution ? <Badge variant={draft.visualModeResolution.eligible ? "outline" : "destructive"}>Visual mode · {titleCase(draft.visualModeResolution.effective)}</Badge> : null}
            </div>
            <SheetTitle className="font-serif text-2xl">{draft?.primary.internalTitle || draft?.primary.topic || "Creative review"}</SheetTitle>
            <SheetDescription>Review the final media, complete caption, evidence and compliance result before the one-step approval and schedule action.</SheetDescription>
          </>}
          {!queueNavigation?.complete && draft?.visualModeResolution && (draft.visualModeResolution.requested !== draft.visualModeResolution.effective || draft.visualModeResolution.reasons.length > 0) ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs leading-5 text-amber-950">
              Requested {titleCase(draft.visualModeResolution.requested)} resolved to {titleCase(draft.visualModeResolution.effective)}. {draft.visualModeResolution.reasons.join(" · ")}
            </p>
          ) : null}
        </SheetHeader>
        <div className="p-5 md:p-7">
          {queueNavigation?.complete ? <div className="mb-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex flex-wrap items-center gap-3"><CheckCircle2 className="h-5 w-5" /><div className="flex-1"><p className="font-semibold">All weekly creatives reviewed</p><p className="mt-1 text-sm">The approved posts are scheduled in their frozen weekly slots.</p></div>{onOpenCalendar ? <Button variant="outline" onClick={onOpenCalendar}><CalendarDays className="h-4 w-4" /> Open Calendar</Button> : null}</div></div> : queueNavigation?.unresolvedFailureCount ? <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-4 text-sm"><p className="font-semibold text-destructive">Weekly review is blocked by {queueNavigation.unresolvedFailureCount} failed creative{queueNavigation.unresolvedFailureCount === 1 ? "" : "s"}.</p><p className="mt-1 text-muted-foreground">The queue cannot be marked complete until the failed generation is retried and returns to final review.</p>{queueNavigation.firstFailureDraftId && onOpenFailureDraft ? <Button className="mt-3" variant="outline" onClick={() => onOpenFailureDraft(queueNavigation.firstFailureDraftId)}>Retry failed creative</Button> : null}</div> : queueNavigation?.openManualBlockerCount ? <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">{queueNavigation.openManualBlockerCount} required manual action{queueNavigation.openManualBlockerCount === 1 ? " remains" : "s remain"} unresolved.</p><p className="mt-1">Complete the recorded action before this weekly queue can be marked reviewed.</p></div> : queueNavigation?.waitingGenerationCount ? <div className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin text-primary" /><span>{queueNavigation.waitingGenerationCount} weekly creative{queueNavigation.waitingGenerationCount === 1 ? " is" : "s are"} generating or waiting for a required generation action. This review session will open the next one automatically.</span></div> : queueNavigation?.remainingReviewCount ? <p className="mb-4 text-xs text-muted-foreground">{queueNavigation.remainingReviewCount} more creative{queueNavigation.remainingReviewCount === 1 ? "" : "s"} waiting in this review session.</p> : null}
          {!queueNavigation?.complete ? <SocialToday
            {...todayProps}
            reviewMode
            reviewAdvancedContent={<details className="rounded-3xl border border-border bg-card p-5">
              <summary className="cursor-pointer text-sm font-semibold">Advanced · raw provenance and audit history</summary>
              <div className="mt-6"><SocialAuditView draft={draft} /></div>
            </details>}
          /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};
