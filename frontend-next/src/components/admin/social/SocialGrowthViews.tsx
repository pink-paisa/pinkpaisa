import { useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ExternalLink,
  FileSearch,
  Gauge,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "../AdminShared";
import { formatConfidence } from "./adapters";
import { SocialAuditView, SocialResearchView } from "./SocialSupportingViews";
import {
  SocialAnalyticsSummary,
  SocialCommunityItem,
  SocialConnection,
  SocialConnectionsSnapshot,
  SocialDraft,
  SocialWeeklyPlan,
  SocialWeeklyPlanItem,
  SocialWeeklyResearch,
} from "./types";

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDateTime = (value: string | null | undefined, dateOnly = false) => {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit" }),
  });
};

const ViewError = ({ message, onRetry }: { message: string; onRetry: () => void }) => message ? (
  <Alert variant="destructive" className="rounded-2xl">
    <AlertCircle className="h-4 w-4" />
    <AlertTitle>This workspace could not be refreshed</AlertTitle>
    <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button>
    </AlertDescription>
  </Alert>
) : null;

const requiredConnections = [
  ["internal_data", "Pink Paisa data"],
  ["openai", "OpenAI"],
  ["instagram", "Instagram / Meta"],
  ["meta_webhooks", "Meta webhooks"],
  ["ga4", "Google Analytics 4"],
  ["search_console", "Search Console"],
  ["n8n", "n8n orchestration"],
  ["research_sources", "Research sources"],
] as const;

const missingConnection = (key: string, label: string): SocialConnection => ({
  key,
  label,
  status: "NOT_CONFIGURED",
  connected: false,
  configured: false,
  accountLabel: "",
  lastCheckedAt: null,
  expiresAt: null,
  error: "",
  warnings: [],
  capabilities: [],
  metadata: {},
});

export const SocialConnectionsView = ({
  snapshot,
  loading,
  checking,
  error,
  onReload,
  onCheck,
}: {
  snapshot: SocialConnectionsSnapshot | null;
  loading: boolean;
  checking: boolean;
  error: string;
  onReload: () => void;
  onCheck: () => void;
}) => {
  const byKey = new Map((snapshot?.items || []).map((item) => [item.key, item]));
  const connections = requiredConnections.map(([key, label]) => byKey.get(key) || missingConnection(key, label));
  for (const connection of snapshot?.items || []) {
    if (!connections.some((item) => item.key === connection.key)) connections.push(connection);
  }
  const readyCount = connections.filter((connection) => connection.connected || connection.status.toUpperCase() === "READY").length;
  const hasConnectionFailure = Boolean(snapshot?.blockers.length) || connections.some((connection) => ["ERROR", "MISCONFIGURED", "EXPIRED"].includes(connection.status.toUpperCase()));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Control-plane health</p><h2 className="mt-1 font-serif text-3xl">Connections</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Inspect the systems used for research, creation, publishing, attribution and orchestration. Secrets remain server-side.</p></div>
        <div className="flex flex-col items-end gap-2"><span className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(snapshot?.checkedAt)}`}</span>{hasConnectionFailure ? <Button variant="destructive" onClick={onCheck} disabled={checking}>{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Retry failed checks</Button> : null}</div>
      </div>
      <details className="rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-xs font-semibold text-primary">Advanced · connection checks</summary><div className="mt-3"><Button variant="outline" onClick={onCheck} disabled={checking}><Gauge className={checking ? "h-4 w-4 animate-pulse" : "h-4 w-4"} /> Check connections now</Button></div></details>
      <ViewError message={error} onRetry={onReload} />
      {snapshot?.blockers.length ? <Alert variant="destructive" className="rounded-2xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>{snapshot.blockers.length} connection blocker(s)</AlertTitle><AlertDescription>{snapshot.blockers.join(" · ")}</AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3"><Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ready connections</p><p className="mt-1 text-2xl font-semibold tabular-nums">{readyCount} / {connections.length}</p></CardContent></Card><Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Last full check</p><p className="mt-1 font-medium">{formatDateTime(snapshot?.checkedAt)}</p></CardContent></Card><Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Policy</p><p className="mt-1 font-medium">Human approval required</p></CardContent></Card></div>
      {loading && !snapshot ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((connection) => (
            <Card key={connection.key} className="rounded-3xl shadow-none">
              <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-lg"><Link2 className="h-4 w-4 text-primary" /> {connection.label}</CardTitle><CardDescription className="mt-1">{connection.accountLabel || (connection.configured ? "Configured without an account label" : "Setup is not complete")}</CardDescription></div><StatusBadge status={connection.status.toLowerCase()} /></div></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">Checked {formatDateTime(connection.lastCheckedAt)}</Badge>{connection.expiresAt ? <Badge variant="outline">Expires {formatDateTime(connection.expiresAt)}</Badge> : null}</div>
                {connection.error ? <p className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{connection.error}</p> : null}
                {connection.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{warning}</p>)}
                {connection.capabilities.length ? <div className="flex flex-wrap gap-2">{connection.capabilities.map((capability) => <Badge key={capability.key} variant={capability.supported ? "default" : capability.supported === false ? "destructive" : "outline"} title={capability.detail}>{capability.label}</Badge>)}</div> : <p className="text-xs text-muted-foreground">Capability details have not been returned by the server.</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export const SocialWeeklyStrategyView = ({
  plan,
  loading,
  action,
  error,
  onReload,
  onGenerate,
  onApprove,
  onReject,
  onProduce,
  onOpenDraft,
  onReplaceSlot,
}: {
  plan: SocialWeeklyPlan | null;
  loading: boolean;
  action: string;
  error: string;
  onReload: () => void;
  onGenerate: () => void;
  onApprove: () => void;
  onReject: () => void;
  onProduce: (item: SocialWeeklyPlanItem) => void;
  onOpenDraft: (draftId: string) => void;
  onReplaceSlot: (item: SocialWeeklyPlanItem, candidateId: string) => Promise<boolean>;
}) => {
  const [replacementSlot, setReplacementSlot] = useState<SocialWeeklyPlanItem | null>(null);
  const status = String(plan?.status || "").toUpperCase();
  const running = ["QUEUED", "RESEARCHING", "PLANNING"].includes(status);
  const retrying = status === "REJECTED" || status.startsWith("FAILED");
  const locked = ["APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED"].includes(status);
  const reviewable = status === "NEEDS_REVIEW";
  const usedCandidateIds = new Set((plan?.items || []).map((item) => item.id));
  const primaryLabel = running
      ? "Planning in progress"
      : retrying
        ? "Retry weekly plan"
        : "Generate weekly plan";
  return (
  <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Three-post operating model</p><h2 className="mt-1 font-serif text-3xl">Weekly Strategy</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Approve the strongest weekly mix once. Creative generation starts automatically for every selected post.</p></div>
      <div className="flex flex-col items-end gap-2"><span className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(plan?.updatedAt)}`}</span>{retrying ? <Button onClick={onGenerate} disabled={Boolean(action)}>{action === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {primaryLabel}</Button> : running ? <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Planning in progress</Badge> : locked ? <Badge variant="outline">Plan history protected</Badge> : <Badge variant="outline">Automatic planning</Badge>}</div>
    </div>
    <ViewError message={error} onRetry={onReload} />
    {!retrying && !running && !locked ? <details className="rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-xs font-semibold text-primary">Advanced · planning controls</summary><div className="mt-3"><Button variant="outline" onClick={onGenerate} disabled={Boolean(action)}><Sparkles className="h-4 w-4" /> Generate plan manually</Button></div></details> : null}
    {locked ? <Alert className="rounded-2xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>{titleCase(status)} plan is protected</AlertTitle><AlertDescription>Approved, scheduled, active and completed plans cannot be force-regenerated. Retry only a visibly failed creative item, or create the next planning week instead of replacing this history.</AlertDescription></Alert> : null}
    {plan && (plan.generationError || String(plan.status).startsWith("FAILED")) ? (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>
          Weekly plan generation failed{plan.generationError?.stage ? ` at ${titleCase(plan.generationError.stage)}` : ""}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{plan.generationError?.message || "The weekly plan entered a failed generation state without a detailed server message."}</p>
          <div className="flex flex-wrap gap-2">
            {plan.generationError?.code ? <Badge variant="outline">{plan.generationError.code}</Badge> : null}
            <Badge variant="outline">{plan.generationError?.isRetriable ? "Retry permitted" : "Manual review required"}</Badge>
            {plan.generationError?.occurredAt ? <Badge variant="outline">Failed {formatDateTime(plan.generationError.occurredAt)}</Badge> : null}
          </div>
          {plan.generationError?.validationErrors.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.generationError.validationErrors.map((validationError, index) => <li key={`${validationError}-${index}`}>{validationError}</li>)}
            </ul>
          ) : null}
          <p className="text-sm">Use Retry weekly plan to queue a fresh run after resolving the reported issue.</p>
        </AlertDescription>
      </Alert>
    ) : null}
    {loading && !plan ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
    {!loading && !plan ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={CalendarClock} text="No weekly plan exists yet. Generate at least eight candidates and select up to three posts." /></Card> : null}
    {plan ? <>
      <Card className="rounded-3xl border-primary/20 bg-primary/[0.03] shadow-none"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><Badge>{titleCase(plan.status)}</Badge><Badge variant="outline">Maximum {plan.maxFeedPosts} feed posts</Badge><Badge variant="outline">{plan.timezone}</Badge></div><CardTitle className="mt-3 font-serif text-2xl">{formatDateTime(plan.weekStart, true)} – {formatDateTime(plan.weekEnd, true)}</CardTitle><CardDescription className="mt-2 max-w-3xl leading-6">{plan.rationale || "The weekly strategist did not return a concise rationale."}</CardDescription></div>{reviewable ? <div className="flex gap-2"><Button variant="outline" onClick={onReject} disabled={Boolean(action) || Boolean(plan.generationError)} className="text-destructive"><X className="h-4 w-4" /> Reject</Button><Button onClick={onApprove} disabled={Boolean(action) || plan.items.length > plan.maxFeedPosts || Boolean(plan.generationError)}><Check className="h-4 w-4" /> Approve plan &amp; start generation</Button></div> : <Badge variant="outline">{locked ? "Status only · plan history protected" : "Approval actions unavailable in this state"}</Badge>}</div></CardHeader></Card>
      {plan.items.length > plan.maxFeedPosts ? <Alert variant="destructive" className="rounded-2xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>Weekly publication maximum exceeded</AlertTitle><AlertDescription>This plan contains {plan.items.length} feed posts but permits {plan.maxFeedPosts}. Remove or defer a slot before approval.</AlertDescription></Alert> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        {[...plan.items].sort((left, right) => left.order - right.order).map((item) => <Card key={item.id} className="flex flex-col rounded-3xl shadow-none">
          <CardHeader><div className="flex items-center justify-between gap-2"><Badge variant="outline">Post {item.order}</Badge><StatusBadge status={String(item.status).toLowerCase()} /></div><CardTitle className="mt-3 font-serif text-xl">{item.internalTitle || item.topic || "Untitled weekly post"}</CardTitle><CardDescription>{item.scheduledFor ? formatDateTime(item.scheduledFor) : "Publication slot not assigned"}</CardDescription></CardHeader>
          <CardContent className="flex flex-1 flex-col space-y-4">
            <div className="flex flex-wrap gap-2"><Badge variant="secondary">{titleCase(item.format || "format pending")}</Badge><Badge variant="secondary">{item.contentPillar || "Pillar pending"}</Badge>{item.visualModeResolution ? <Badge variant={item.visualModeResolution.eligible ? "outline" : "destructive"}>{titleCase(item.visualModeResolution.effective)}</Badge> : null}</div>
            {item.visualModeResolution && !item.visualModeResolution.eligible ? <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Requested {titleCase(item.visualModeResolution.requested)} was resolved to {titleCase(item.visualModeResolution.effective)}: {item.visualModeResolution.reasons.join(" · ")}</p> : null}
            <p className="text-sm leading-6 text-muted-foreground">{item.whyThisWeek || "No why-this-week rationale returned."}</p>
            <div className="rounded-xl bg-muted/45 p-3 text-xs"><p><span className="font-medium">Primary KPI:</span> {item.primaryKpi || "Not set"}</p><p className="mt-1"><span className="font-medium">Secondary KPI:</span> {item.secondaryKpi || "Not set"}</p></div>
            {item.riskFlags.length ? <div className="flex flex-wrap gap-1">{item.riskFlags.map((risk) => <Badge key={risk} variant="destructive">{risk}</Badge>)}</div> : null}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{formatConfidence(item.confidence)} confidence</span><div className="flex flex-wrap gap-2">{reviewable ? <Button size="sm" variant={replacementSlot?.order === item.order ? "default" : "outline"} onClick={() => setReplacementSlot(replacementSlot?.order === item.order ? null : item)}>Replace this slot</Button> : null}{item.draftId ? <Button size="sm" variant="outline" onClick={() => onOpenDraft(item.draftId)}>Review creative</Button> : ["APPROVED", "SCHEDULED", "ACTIVE"].includes(String(plan.status).toUpperCase()) ? item.status === "FAILED" ? <Button size="sm" variant="destructive" onClick={() => onProduce(item)} disabled={action === `produce:${item.id}`}>{action === `produce:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Retry creative</Button> : <Badge variant="outline">Generation queued automatically</Badge> : <Badge variant="outline">Creative starts after approval</Badge>}</div></div>
          </CardContent>
        </Card>)}
      </div>
      <Card className="rounded-3xl shadow-none">
        <CardHeader><CardTitle className="text-lg">Candidate pool</CardTitle><CardDescription>{replacementSlot ? `Choose an unused candidate for Post ${replacementSlot.order}. Its frozen posting time will be preserved.` : `${plan.candidates.length} materially different candidate idea(s) retained with the plan.`}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {plan.candidates.map((candidate) => { const used = usedCandidateIds.has(candidate.id); return <div key={candidate.id} className="rounded-2xl border p-4"><div className="flex flex-wrap gap-2"><Badge variant="outline">{titleCase(candidate.disposition || "candidate")}</Badge>{candidate.format ? <Badge variant="secondary">{titleCase(candidate.format)}</Badge> : null}{candidate.totalScore !== null ? <Badge variant="outline">{Math.round(candidate.totalScore)}/100</Badge> : null}{candidate.visualModeResolution ? <Badge variant={candidate.visualModeResolution.eligible ? "outline" : "destructive"}>{titleCase(candidate.visualModeResolution.effective)}</Badge> : null}</div><p className="mt-3 font-medium">{candidate.topic || "Untitled candidate"}</p>{candidate.whyToday ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{candidate.whyToday}</p> : null}{replacementSlot ? <Button className="mt-3" size="sm" variant="outline" disabled={used || Boolean(action)} onClick={async () => { if (await onReplaceSlot(replacementSlot, candidate.id)) setReplacementSlot(null); }}>{used ? "Already selected" : `Use for Post ${replacementSlot.order}`}</Button> : null}</div>; })}
          {!plan.candidates.length ? <p className="text-sm text-muted-foreground">Candidate details were not returned.</p> : null}
        </CardContent>
      </Card>
    </> : null}
  </div>
  );
};

const InsightList = ({ title, values }: { title: string; values: string[] }) => <Card className="rounded-2xl shadow-none"><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{values.length ? <ul className="list-disc space-y-2 pl-4 text-sm leading-6">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul> : <p className="text-sm text-muted-foreground">No observations returned.</p>}</CardContent></Card>;

export const SocialResearchDeskView = ({ research, draft, loading, error, onReload }: { research: SocialWeeklyResearch | null; draft: SocialDraft | null; loading: boolean; error: string; onReload: () => void }) => (
  <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Weekly intelligence</p><h2 className="mt-1 font-serif text-3xl">Research Desk</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">A reusable weekly digest combines market, audience and Pink Paisa signals. Draft-specific evidence remains visible below.</p></div><p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(research?.generatedAt)}`}</p></div>
    <ViewError message={error} onRetry={onReload} />
    {loading && !research ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
    {!loading && !research ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={FileSearch} text="No weekly research digest is available yet." /></Card> : null}
    {research?.metaState && !["READY", "OK", "NOT_GENERATED"].includes(research.metaState.toUpperCase()) ? <Alert variant={["ERROR", "UNAVAILABLE"].includes(research.metaState.toUpperCase()) ? "destructive" : "default"} className="rounded-2xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>Official Meta research: {titleCase(research.metaState)}</AlertTitle><AlertDescription>{research.metaMessage || "Hashtag Search or Business Discovery is not currently available for every approved watchlist entry."}{research.metaErrors.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{research.metaErrors.map((item) => <li key={item}>{item}</li>)}</ul> : null}</AlertDescription></Alert> : null}
    {research ? <><Card className="rounded-3xl shadow-none"><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge>{titleCase(research.status)}</Badge><Badge variant="outline">Generated {formatDateTime(research.generatedAt)}</Badge></div><CardTitle className="mt-3 font-serif text-2xl">Weekly research digest</CardTitle><CardDescription className="leading-6">{research.summary || "No concise digest summary returned."}</CardDescription></CardHeader></Card><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><InsightList title="Audience questions" values={research.audienceQuestions} /><InsightList title="Audience themes" values={research.audienceThemes} /><InsightList title="Hashtag observations" values={research.hashtagObservations} /><InsightList title="Competitor observations" values={research.competitorObservations} /></div>{research.topicsToAvoid.length ? <Alert className="rounded-2xl border-amber-200 bg-amber-50"><ShieldAlert className="h-4 w-4" /><AlertTitle>Topics to avoid this week</AlertTitle><AlertDescription>{research.topicsToAvoid.join(" · ")}</AlertDescription></Alert> : null}</> : null}
    <div className="border-t border-border pt-6"><SocialResearchView draft={draft} /></div>
  </div>
);

export const SocialCreativeStudioShell = ({ draft, children }: { draft: SocialDraft | null; children: React.ReactNode }) => (
  <div className="space-y-6">
    {children}
    <details className="rounded-3xl border border-border bg-card p-5">
      <summary className="cursor-pointer text-sm font-semibold">Audit and generation traceability</summary>
      <div className="mt-5"><SocialAuditView draft={draft} /></div>
    </details>
  </div>
);

const queueStatuses = ["NEEDS_ACTION", "NEEDS_REVIEW", "FAILED", "DRAFT", "REJECTED", "SCHEDULED", "PUBLISHED", "ALL"];

export const SocialApprovalQueueView = ({ drafts, loading, error, filter, onFilterChange, onReload, onOpenDraft }: { drafts: SocialDraft[]; loading: boolean; error: string; filter: string; onFilterChange: (value: string) => void; onReload: () => void; onOpenDraft: (draft: SocialDraft) => void }) => {
  const priority: Record<string, number> = { NEEDS_REVIEW: 0, FAILED: 1 };
  const queue = drafts
    .filter((draft) => filter === "NEEDS_ACTION"
      ? ["NEEDS_REVIEW", "FAILED"].includes(String(draft.status).toUpperCase())
      : filter === "ALL" || String(draft.status).toUpperCase() === filter)
    .sort((left, right) => (priority[String(left.status).toUpperCase()] ?? 9) - (priority[String(right.status).toUpperCase()] ?? 9)
      || new Date(left.scheduledFor || left.updatedAt || 0).getTime() - new Date(right.scheduledFor || right.updatedAt || 0).getTime());
  const lastUpdated = drafts.reduce((latest, draft) => Math.max(latest, new Date(draft.updatedAt || 0).getTime() || 0), 0);
  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Human review boundary</p><h2 className="mt-1 font-serif text-3xl">Attention queue</h2><p className="mt-2 text-sm text-muted-foreground">Review completed creatives and keep compliance, image and publishing failures visible.</p></div><p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${lastUpdated ? formatDateTime(new Date(lastUpdated).toISOString()) : "not recorded"}`}</p></div><ViewError message={error} onRetry={onReload} /><div className="flex flex-wrap gap-2">{queueStatuses.map((status) => <Button key={status} size="sm" variant={filter === status ? "default" : "outline"} onClick={() => onFilterChange(status)}>{titleCase(status)}</Button>)}</div>{loading && !drafts.length ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}{!loading && !queue.length ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={Check} text="No drafts match this review filter." /></Card> : null}<div className="grid gap-4 lg:grid-cols-2">{queue.map((draft) => { const failure = draft.lastError && typeof draft.lastError === "object" ? String(draft.lastError.message || draft.lastError.code || "") : ""; return <Card key={draft.id} className="rounded-3xl shadow-none"><CardHeader><div className="flex items-center justify-between gap-2"><StatusBadge status={String(draft.status).toLowerCase()} /><Badge variant="outline">{titleCase(draft.primary.format || "format pending")}</Badge></div><CardTitle className="mt-3 font-serif text-xl">{draft.primary.internalTitle || draft.primary.topic || "Untitled draft"}</CardTitle><CardDescription>{draft.scheduledFor ? `Scheduled ${formatDateTime(draft.scheduledFor)}` : `Updated ${formatDateTime(draft.updatedAt)}`}</CardDescription></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">{draft.primary.whyToday || draft.primary.caption}</p>{failure ? <p className="rounded-xl bg-destructive/5 p-3 text-xs text-destructive">{failure}</p> : null}<Button onClick={() => onOpenDraft(draft)}>Review creative</Button></CardContent></Card>; })}</div></div>;
};

const MetricTiles = ({ values, percent = false }: { values: Record<string, number>; percent?: boolean }) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(values).map(([key, value]) => <Card key={key} className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{titleCase(key)}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{percent ? `${(value <= 1 ? value * 100 : value).toFixed(1)}%` : value.toLocaleString("en-IN")}</p></CardContent></Card>)}</div>;

export const SocialPublishedAnalyticsView = ({ summary, loading, refreshing, error, onReload, onRefresh, children }: { summary: SocialAnalyticsSummary | null; loading: boolean; refreshing: boolean; error: string; onReload: () => void; onRefresh: () => void; children: React.ReactNode }) => <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Publishing outcomes</p><h2 className="mt-1 font-serif text-3xl">Published & Analytics</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Measure reach quality, traffic and conversions—not likes alone—and carry concise learning into the next plan.</p></div><div className="flex flex-col items-end gap-2"><span className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(summary?.refreshedAt)}`}</span><Button onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Collect metrics</Button></div></div><ViewError message={error} onRetry={onReload} />{loading && !summary ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}{!loading && !summary ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={BarChart3} text="No aggregate analytics have been collected yet." /></Card> : null}{summary ? <><div className="flex flex-wrap gap-2"><Badge>{summary.rangeLabel}</Badge><Badge variant="outline">Refreshed {formatDateTime(summary.refreshedAt)}</Badge></div><MetricTiles values={summary.metrics} />{Object.keys(summary.rates).length ? <><h3 className="font-serif text-xl">Quality and conversion rates</h3><MetricTiles values={summary.rates} percent /></> : null}<div className="grid gap-4 lg:grid-cols-2">{summary.posts.map((post) => <Card key={post.id} className="rounded-3xl shadow-none"><CardHeader><div className="flex flex-wrap gap-2"><Badge variant="outline">{titleCase(post.format || "published")}</Badge><Badge variant="secondary">{formatDateTime(post.publishedAt)}</Badge></div><CardTitle className="mt-3 text-lg">{post.title}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2">{Object.entries(post.metrics).slice(0, 8).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/45 p-2"><p className="text-[10px] text-muted-foreground">{titleCase(key)}</p><p className="font-semibold tabular-nums">{value.toLocaleString("en-IN")}</p></div>)}</div>{post.learningSummary ? <p className="text-sm leading-6 text-muted-foreground">{post.learningSummary}</p> : null}{post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary"><ExternalLink className="h-3.5 w-3.5" /> Open Instagram post</a> : null}</CardContent></Card>)}</div>{summary.learnings.length ? <Alert className="rounded-2xl"><Bot className="h-4 w-4" /><AlertTitle>AI learning summary</AlertTitle><AlertDescription><ul className="mt-2 list-disc space-y-1 pl-4">{summary.learnings.map((learning) => <li key={learning}>{learning}</li>)}</ul></AlertDescription></Alert> : null}</> : null}<details className="rounded-3xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">Manual snapshots and historical detail</summary><div className="mt-5">{children}</div></details></div>;

const communityStatuses = ["ALL", "RECOMMENDED", "RECOMMENDATION_QUEUED", "SEND_QUEUED", "SEND_PROCESSING", "SEND_UNCERTAIN", "SENT", "ESCALATION_REQUIRED"];
type CommunityAction = "approve-and-send" | "recommend" | "approve" | "reject" | "send" | "reconcile" | "acknowledge-escalation" | "resolve-escalation";
type CommunityActionPayload = Record<string, string>;

const CommunityCard = ({ item, busy, onAction }: { item: SocialCommunityItem; busy: boolean; onAction: (item: SocialCommunityItem, action: CommunityAction, payload?: CommunityActionPayload) => void }) => {
  const [reply, setReply] = useState(item.suggestedReply || item.approvedReply);
  const [externalReplyId, setExternalReplyId] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const status = String(item.status).toUpperCase();
  const recommendationReady = status === "RECOMMENDED" && Boolean(item.suggestedReply);
  const drafting = ["OPEN", "RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING"].includes(status) && !item.suggestedReply;
  const sending = ["SEND_QUEUED", "SEND_PROCESSING"].includes(status);
  const unsafe = ["ESCALATION_REQUIRED", "SEND_UNCERTAIN"].includes(status)
    || ["SENSITIVE", "HIGH_RISK", "ESCALATION_REQUIRED", "UNSUPPORTED", "UNCERTAIN"].includes(String(item.classification).toUpperCase())
    || Boolean(item.escalationReason);
  return <Card className="rounded-3xl shadow-none">
    <CardHeader><div className="flex flex-wrap items-center gap-2"><StatusBadge status={status.toLowerCase()} /><Badge variant="outline">{titleCase(item.sourceType)}</Badge><Badge variant={unsafe ? "destructive" : "secondary"}>{titleCase(item.classification)}</Badge><span className="ml-auto text-xs text-muted-foreground">{formatDateTime(item.receivedAt)}</span></div><CardTitle className="mt-3 text-lg">{item.authorLabel}</CardTitle><CardDescription>{item.relatedMediaTitle || "Instagram community item"}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="rounded-2xl bg-muted/45 p-4 text-sm leading-6">{item.message || "No message text returned."}</p>
      {drafting ? <p className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin text-primary" /> AI reply drafting is queued automatically. Nothing will be sent without approval.</p> : null}
      {item.suggestedReply ? <div className="space-y-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Editable AI reply</p><span className="text-xs text-muted-foreground">{formatConfidence(item.confidence)} confidence</span></div><Textarea aria-label={`Reply to ${item.authorLabel}`} rows={4} value={reply} onChange={(event) => setReply(event.target.value)} disabled={unsafe || sending || status === "SENT"} /></div> : null}
      {item.riskFlags.length ? <div className="flex flex-wrap gap-2">{item.riskFlags.map((risk) => <Badge key={risk} variant="destructive">{risk}</Badge>)}</div> : null}
      {item.escalationReason ? <Alert variant="destructive" className="rounded-xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>Escalation required</AlertTitle><AlertDescription>{item.escalationReason}</AlertDescription></Alert> : null}
      {status === "SEND_UNCERTAIN" ? <><Alert variant="destructive" className="rounded-xl"><ShieldAlert className="h-4 w-4" /><AlertTitle>Delivery outcome is uncertain</AlertTitle><AlertDescription>The system will not retry blindly. Check Meta and record its actual reply/message identifier before confirming delivery.</AlertDescription></Alert>{item.availableActions.reconcileSend ? <div className="space-y-3 rounded-2xl border border-destructive/20 p-4"><p className="text-sm font-semibold">Reconcile Meta outcome</p><Input aria-label="Confirmed Meta reply identifier" value={externalReplyId} onChange={(event) => setExternalReplyId(event.target.value)} placeholder="Confirmed Meta reply/message ID" disabled={busy} /><Textarea aria-label="Community reconciliation notes" rows={3} value={operatorNotes} onChange={(event) => setOperatorNotes(event.target.value)} placeholder="Where and how the provider result was verified" disabled={busy} /><Button onClick={() => onAction(item, "reconcile", { external_reply_id: externalReplyId.trim(), notes: operatorNotes.trim() })} disabled={busy || !externalReplyId.trim() || !operatorNotes.trim()}><Check className="h-4 w-4" /> Confirm reconciled delivery</Button></div> : null}</> : null}
      {status === "SENT" && item.sendReconciliation ? <Alert className="rounded-xl"><Check className="h-4 w-4" /><AlertTitle>Delivery reconciled</AlertTitle><AlertDescription>Meta reply ID {String(item.sendReconciliation.external_reply_id || "recorded")} was verified without retrying the provider request.</AlertDescription></Alert> : null}
      {sending ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Approved reply is durably queued; SENT appears only after Meta returns a reply identifier.</p> : null}
      {status === "ESCALATION_REQUIRED" ? <div className="space-y-3 rounded-2xl border border-destructive/20 p-4"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">Human escalation</p><Badge variant="outline">{titleCase(item.escalationState)}</Badge>{item.escalationAcknowledgedAt ? <span className="text-xs text-muted-foreground">Acknowledged {formatDateTime(item.escalationAcknowledgedAt)}</span> : null}</div><Textarea aria-label="Escalation handling notes" rows={3} value={operatorNotes} onChange={(event) => setOperatorNotes(event.target.value)} placeholder={item.availableActions.resolveEscalation ? "Describe the verified human resolution" : "Record who accepted ownership and the next safe step"} disabled={busy} /><div className="flex flex-wrap gap-2">{item.availableActions.acknowledgeEscalation ? <Button variant="outline" onClick={() => onAction(item, "acknowledge-escalation", { notes: operatorNotes.trim() })} disabled={busy || !operatorNotes.trim()}><Check className="h-4 w-4" /> Acknowledge escalation</Button> : null}{item.availableActions.resolveEscalation ? <Button onClick={() => onAction(item, "resolve-escalation", { notes: operatorNotes.trim() })} disabled={busy || !operatorNotes.trim()}><Check className="h-4 w-4" /> Resolve escalation</Button> : null}</div></div> : null}
      <div className="flex flex-wrap gap-2">
        {recommendationReady && !unsafe ? <Button onClick={() => onAction(item, "approve-and-send", { reply: reply.trim() })} disabled={busy || !reply.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Approve &amp; send</Button> : null}
        {recommendationReady ? <Button variant="ghost" className="text-destructive" onClick={() => onAction(item, "reject")} disabled={busy}><X className="h-4 w-4" /> Reject</Button> : null}
        {item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 text-sm text-primary"><ExternalLink className="h-3.5 w-3.5" /> Open source</a> : null}
      </div>
      {["OPEN", "APPROVED"].includes(status) ? <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium text-primary">Advanced · compatibility recovery</summary><div className="mt-3 flex flex-wrap gap-2">{status === "OPEN" ? <Button size="sm" variant="outline" onClick={() => onAction(item, "recommend")} disabled={busy}><Bot className="h-4 w-4" /> Retry AI draft</Button> : null}{status === "APPROVED" ? <Button size="sm" variant="outline" onClick={() => onAction(item, "send")} disabled={busy}><Send className="h-4 w-4" /> Queue legacy approved reply</Button> : null}</div></details> : null}
    </CardContent>
  </Card>;
};

export const SocialCommunityInboxView = ({ items, loading, error, filter, actionId, onFilterChange, onReload, onAction }: { items: SocialCommunityItem[]; loading: boolean; error: string; filter: string; actionId: string; onFilterChange: (value: string) => void; onReload: () => void; onAction: (item: SocialCommunityItem, action: CommunityAction, payload?: CommunityActionPayload) => void }) => <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Human-approved engagement</p><h2 className="mt-1 font-serif text-3xl">Community Inbox</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">AI drafts supported replies automatically. One explicit Approve &amp; send decision commits an exact reply to the durable delivery queue.</p></div><p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(items[0]?.receivedAt)}`}</p></div><ViewError message={error} onRetry={onReload} /><div className="flex flex-wrap gap-2">{communityStatuses.map((status) => <Button key={status} size="sm" variant={filter === status ? "default" : "outline"} onClick={() => onFilterChange(status)}>{titleCase(status)}</Button>)}</div>{loading && !items.length ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}{!loading && !items.length ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={MessageCircle} text="No community items match this filter." /></Card> : null}<div className="space-y-4">{items.map((item) => <CommunityCard key={`${item.id}:${item.suggestedReply}:${item.status}`} item={item} busy={actionId === item.id} onAction={onAction} />)}</div></div>;
