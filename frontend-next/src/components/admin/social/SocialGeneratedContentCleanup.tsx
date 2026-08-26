import { useState } from "react";
import { AlertTriangle, Database, FileImage, Loader2, ShieldCheck, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import {
  normalizeGeneratedContentCleanupPreview,
  normalizeGeneratedContentCleanupResult,
} from "./adapters";
import {
  SocialGeneratedContentCleanupPreview,
  SocialGeneratedContentCleanupResult,
} from "./types";

const API_BASE = "/social-media-manager/admin";

const formatBytes = (value: number) => {
  if (!value) return "0 bytes";
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const countRows = (preview: SocialGeneratedContentCleanupPreview) => [
  ["Drafts", preview.counts.drafts],
  ["Creative assets", preview.counts.assets],
  ["Generation workflows", preview.counts.generationRuns],
  ["Weekly plans", preview.counts.weeklyPlans],
  ["Research evidence", preview.counts.researchSources],
  ["Linked actions", preview.counts.manualActions],
] as const;

export const SocialGeneratedContentCleanup = ({
  onDeleted,
}: {
  onDeleted: (result: SocialGeneratedContentCleanupResult) => Promise<void> | void;
}) => {
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<SocialGeneratedContentCleanupPreview | null>(null);
  const [result, setResult] = useState<SocialGeneratedContentCleanupResult | null>(null);
  const [error, setError] = useState("");

  const reviewDeletion = async () => {
    setReviewing(true);
    setError("");
    setResult(null);
    try {
      const response = await apiFetch(`${API_BASE}/generated-content/cleanup-preview`);
      setPreview(normalizeGeneratedContentCleanupPreview(response));
      setConfirmation("");
      setOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not review generated content");
    } finally {
      setReviewing(false);
    }
  };

  const deleteContent = async () => {
    if (!preview || confirmation !== preview.confirmationPhrase || preview.blockers.length || !preview.totalCount) return;
    setDeleting(true);
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/generated-content`, {
        method: "DELETE",
        headers: { "Idempotency-Key": `social-generated-content-purge:${preview.purgeToken}` },
        body: JSON.stringify({ confirmation, purge_token: preview.purgeToken }),
      });
      const normalized = normalizeGeneratedContentCleanupResult(response);
      setResult(normalized);
      setPreview(null);
      setConfirmation("");
      await onDeleted(normalized);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete generated content");
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = Boolean(preview
    && preview.totalCount > 0
    && preview.blockers.length === 0
    && confirmation === preview.confirmationPhrase
    && !deleting);

  return (
    <Card className="rounded-3xl border-destructive/20 shadow-none">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-destructive/10 p-2 text-destructive"><Trash2 className="h-5 w-5" /></div>
          <div>
            <CardTitle className="text-lg">Generated-content cleanup</CardTitle>
            <CardDescription className="mt-1 leading-5">Delete unpublished Social Manager drafts, plans, AI media and generation history. Published Instagram records and safety evidence remain protected.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="outline" onClick={() => void reviewDeletion()} disabled={reviewing || deleting}>
          {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Review deletion
        </Button>
        {error && !open ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => { if (!deleting) setOpen(next); }}>
        <DialogContent className="max-w-2xl rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Delete generated Social Manager content?</DialogTitle>
            <DialogDescription>This is a permanent local cleanup. Review the exact scope before typing the confirmation phrase.</DialogDescription>
          </DialogHeader>

          {preview ? <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {countRows(preview).map(([label, count]) => <div key={label} className="rounded-xl border border-border/70 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{count}</p></div>)}
            </div>
            <div className="flex flex-wrap gap-2"><Badge variant="outline"><Database className="mr-1 h-3 w-3" /> {preview.totalCount} database records</Badge><Badge variant="outline"><FileImage className="mr-1 h-3 w-3" /> {preview.localFiles.count} local files · {formatBytes(preview.localFiles.bytes)}</Badge></div>

            {preview.blockers.length ? <Alert className="border-destructive/30 bg-destructive/[0.04]" variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Cleanup is blocked</AlertTitle><AlertDescription><ul className="mt-2 list-disc space-y-1 pl-4">{preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul></AlertDescription></Alert> : null}
            {!preview.totalCount ? <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Nothing to delete</AlertTitle><AlertDescription>There is no unpublished generated Social Manager content.</AlertDescription></Alert> : null}

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950">
              <p className="font-medium">Always retained</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">{preview.exclusions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generated-content-confirmation">Type <span className="font-mono font-semibold">{preview.confirmationPhrase}</span></Label>
              <Input id="generated-content-confirmation" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting || Boolean(preview.blockers.length) || !preview.totalCount} />
            </div>
          </div> : null}

          {result ? <div className="space-y-3">
            <Alert className={result.fileCleanup.failed ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50/60"}>
              {result.fileCleanup.failed ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              <AlertTitle>{result.fileCleanup.failed ? "Records deleted; file cleanup needs attention" : "Generated content deleted"}</AlertTitle>
              <AlertDescription>{result.totalDeleted} database records and {result.fileCleanup.deleted} local files were removed. {result.fileCleanup.missing ? `${result.fileCleanup.missing} files were already absent. ` : ""}{result.usageLedgersCreated} cost-ledger record{result.usageLedgersCreated === 1 ? " was" : "s were"} retained for budget accuracy.</AlertDescription>
            </Alert>
            {result.fileCleanup.failures.map((failure) => <p key={failure.storageKey} className="break-all text-xs text-destructive">{failure.storageKey}: {failure.message}</p>)}
          </div> : null}

          {error && open ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            {result ? <Button type="button" onClick={() => setOpen(false)}>Done</Button> : <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={deleting}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => void deleteContent()} disabled={!canDelete}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete generated content
              </Button>
            </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
