import { useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  FileText,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "../AdminShared";
import { SocialManualAction } from "./types";

export type SocialManualActionNextStatus = "COMPLETED" | "CANCELLED";

type SocialManualActionsPanelProps = {
  actions: SocialManualAction[];
  loading: boolean;
  error: string;
  actionId: string;
  onReload: () => void;
  onOpenDraft: (draftId: string) => void;
  onUpdate: (action: SocialManualAction, status: SocialManualActionNextStatus, note?: string) => Promise<boolean>;
};

type PendingNote = {
  action: SocialManualAction;
  status: "COMPLETED" | "CANCELLED";
};

const statusFilters = ["ACTIVE", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "ALL"] as const;
const activeStatuses = new Set(["OPEN", "IN_PROGRESS"]);

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "No due date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const isOverdue = (action: SocialManualAction) => {
  if (!action.dueAt || !activeStatuses.has(action.status)) return false;
  const dueAt = new Date(action.dueAt).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
};

const priorityVariant = (priority: string): "destructive" | "secondary" | "outline" => {
  if (["CRITICAL", "HIGH"].includes(priority)) return "destructive";
  return priority === "MEDIUM" ? "secondary" : "outline";
};

const linkedRecords = (action: SocialManualAction) => [
  ["Weekly plan", action.weeklyPlanId],
  ["Generation run", action.generationRunId],
  ["Draft", action.draftId],
  ["Publication", action.publicationId],
  ["Community item", action.communityItemId],
  ["Connection health", action.connectionHealthId],
  ["Provider reference", action.externalReferenceId],
].filter((entry): entry is [string, string] => Boolean(entry[1]));

const evidenceValue = (value: unknown) => {
  if (value == null) return "Not recorded";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export const SocialManualActionsPanel = ({
  actions,
  loading,
  error,
  actionId,
  onReload,
  onOpenDraft,
  onUpdate,
}: SocialManualActionsPanelProps) => {
  const [filter, setFilter] = useState<(typeof statusFilters)[number]>("ACTIVE");
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null);
  const [note, setNote] = useState("");

  const visibleActions = actions.filter((action) => {
    if (filter === "ALL") return true;
    if (filter === "ACTIVE") return activeStatuses.has(action.status);
    return action.status === filter;
  });
  const activeCount = actions.filter((action) => activeStatuses.has(action.status)).length;
  const overdueCount = actions.filter(isOverdue).length;
  const noteSubmitting = Boolean(pendingNote && actionId === pendingNote.action.id);

  const requestNote = (action: SocialManualAction, status: "COMPLETED" | "CANCELLED") => {
    setNote("");
    setPendingNote({ action, status });
  };

  const confirmNote = async () => {
    if (!pendingNote || !note.trim()) return;
    const updated = await onUpdate(pendingNote.action, pendingNote.status, note.trim());
    if (updated) {
      setPendingNote(null);
      setNote("");
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="manual-actions-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Human-only follow-through</p>
          <h2 id="manual-actions-heading" className="mt-1 font-serif text-3xl">Manual Actions</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Complete work that requires a person or a native provider surface. Every terminal update records an administrator note.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${actions[0]?.updatedAt ? new Date(actions[0].updatedAt).toLocaleString("en-IN") : "not recorded"}`}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active actions</p><p className="mt-1 text-2xl font-semibold tabular-nums">{activeCount}</p></CardContent></Card>
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overdue</p><p className="mt-1 text-2xl font-semibold tabular-nums text-destructive">{overdueCount}</p></CardContent></Card>
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">All recorded</p><p className="mt-1 text-2xl font-semibold tabular-nums">{actions.length}</p></CardContent></Card>
      </div>

      {error ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Manual actions could not be loaded</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={onReload}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2" aria-label="Manual action status filter">
        {statusFilters.map((status) => (
          <Button key={status} size="sm" variant={filter === status ? "default" : "outline"} onClick={() => setFilter(status)}>
            {titleCase(status)}
          </Button>
        ))}
      </div>

      {loading && !actions.length ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
      {!loading && !error && !visibleActions.length ? (
        <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={ListChecks} text="No manual actions match this filter." /></Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleActions.map((action) => {
          const overdue = isOverdue(action);
          const busy = actionId === action.id;
          const terminal = ["COMPLETED", "CANCELLED"].includes(action.status);
          const authoritativeReconciliation = action.actionKey.startsWith("social-community-send-reconciliation:")
            || (action.actionKey.startsWith("social-publish-reconciliation:") && action.actionKey.endsWith(":outcome-uncertain"));
          const links = linkedRecords(action);
          const evidence = Object.entries(action.resolutionEvidence || {});
          return (
            <Card key={action.id} className={overdue ? "rounded-3xl border-destructive/40 shadow-none" : "rounded-3xl shadow-none"}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={action.status.toLowerCase()} />
                  <Badge variant={priorityVariant(action.priority)}>{titleCase(action.priority)} priority</Badge>
                  {action.provider ? <Badge variant="outline">{action.provider}</Badge> : null}
                  {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                </div>
                <CardTitle className="mt-3 font-serif text-xl">{action.title || "Untitled manual action"}</CardTitle>
                <CardDescription>{titleCase(action.actionType || "other")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{action.description || "No description was recorded."}</p>

                <div className="rounded-2xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Instructions</div>
                  {action.instructions.length ? (
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                      {action.instructions.map((instruction, index) => <li key={`${action.id}-instruction-${index}`}>{instruction}</li>)}
                    </ol>
                  ) : <p className="mt-2 text-sm text-muted-foreground">No additional instructions were recorded.</p>}
                </div>

                <dl className="grid gap-3 rounded-2xl bg-muted/35 p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt><dd className="mt-1 font-medium">{action.status}</dd></div>
                  <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Priority</dt><dd className="mt-1 font-medium">{action.priority}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked context</dt><dd className="mt-1">{links.length ? `${links.length} linked record${links.length === 1 ? "" : "s"}` : "No linked record"}</dd></div>
                  <div className="sm:col-span-2"><dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Due date</dt><dd className={overdue ? "mt-1 font-medium text-destructive" : "mt-1 font-medium"}>{formatDateTime(action.dueAt)}</dd></div>
                </dl>

                {links.length || evidence.length ? <details className="rounded-2xl border border-border/70 p-4"><summary className="cursor-pointer text-sm font-semibold">Linked records &amp; resolution evidence</summary><div className="mt-3 space-y-4">{links.length ? <dl className="grid gap-3 sm:grid-cols-2">{links.map(([label, value]) => <div key={label}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-xs">{value}</dd></div>)}</dl> : null}{evidence.length ? <dl className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">{evidence.map(([key, value]) => <div key={key}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titleCase(key)}</dt><dd className="mt-1 break-words text-xs">{evidenceValue(value)}</dd></div>)}</dl> : null}</div></details> : null}

                {action.resolutionNote ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-medium">Completion note</p><p className="mt-1 whitespace-pre-wrap">{action.resolutionNote}</p></div> : null}
                {action.status === "COMPLETED" ? <Badge variant="outline">Completed by {action.completionSource === "SYSTEM" ? "verified system state" : "administrator"}</Badge> : null}
                {action.cancellationReason ? <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">Cancellation reason</p><p className="mt-1 whitespace-pre-wrap">{action.cancellationReason}</p></div> : null}

                <div className="flex flex-wrap gap-2">
                  {action.draftId ? <Button variant="outline" onClick={() => onOpenDraft(action.draftId)} disabled={busy}><FileText className="h-4 w-4" /> Open draft</Button> : null}
                  {!terminal && !authoritativeReconciliation ? <Button onClick={() => requestNote(action, "COMPLETED")} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Complete</Button> : null}
                  {!terminal && !authoritativeReconciliation ? <Button variant="ghost" className="text-destructive" onClick={() => requestNote(action, "CANCELLED")} disabled={busy}><XCircle className="h-4 w-4" /> Cancel</Button> : null}
                </div>
                {!terminal && authoritativeReconciliation ? <Alert className="rounded-xl"><AlertCircle className="h-4 w-4" /><AlertTitle>Authoritative provider evidence required</AlertTitle><AlertDescription>Use the {action.communityItemId ? "Community" : "Results"} reconciliation control and record the confirmed Meta identifier. This action closes automatically only with that evidence.</AlertDescription></Alert> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(pendingNote)} onOpenChange={(open) => { if (!open && !noteSubmitting) { setPendingNote(null); setNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingNote?.status === "COMPLETED" ? "Complete manual action" : "Cancel manual action"}</DialogTitle>
            <DialogDescription>
              {pendingNote?.status === "COMPLETED"
                ? "Record what was completed and any result the Social Growth Team should retain."
                : "Record why this action is being cancelled so the audit trail remains clear."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="manual-action-note">{pendingNote?.status === "COMPLETED" ? "Completion note" : "Cancellation reason"} *</Label>
            <Textarea
              id="manual-action-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              maxLength={pendingNote?.status === "COMPLETED" ? 4000 : 2000}
              placeholder={pendingNote?.status === "COMPLETED" ? "Describe the work completed and its outcome" : "Explain why this action should no longer be completed"}
              disabled={noteSubmitting}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">This note is required and will be recorded in the administrator audit trail.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingNote(null); setNote(""); }} disabled={noteSubmitting}>Keep action open</Button>
            <Button variant={pendingNote?.status === "CANCELLED" ? "destructive" : "default"} onClick={() => void confirmNote()} disabled={!note.trim() || noteSubmitting}>
              {noteSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : pendingNote?.status === "COMPLETED" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {pendingNote?.status === "COMPLETED" ? "Complete action" : "Cancel action"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
