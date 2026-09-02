import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileClock,
  Globe2,
  History,
  Loader2,
  Save,
  SearchCheck,
  ShieldCheck,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "../AdminShared";
import { formatConfidence } from "./adapters";
import { brandLogoContractReady } from "./socialBrandLogo";
import { SocialDraft, SocialReadiness, SocialSettings, SocialSignal, SocialSource } from "./types";

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDateTime = (value: string | null | undefined, includeTime = true) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    {children}
    {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
  </div>
);

const SourceCard = ({ source }: { source: SocialSource }) => (
  <div className="rounded-2xl border border-border/70 bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{titleCase(source.sourceType || "source")}</Badge>
          {source.freshness ? <Badge variant="secondary">{source.freshness}</Badge> : null}
          {source.influenced !== null ? (
            <Badge variant={source.influenced ? "default" : "outline"}>{source.influenced ? "Influenced decision" : "Context only"}</Badge>
          ) : null}
        </div>
        <h3 className="mt-3 font-medium leading-6">{source.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {[source.publisher, source.publishedAt ? `Published ${formatDateTime(source.publishedAt, false)}` : "", source.accessedAt ? `Accessed ${formatDateTime(source.accessedAt)}` : ""].filter(Boolean).join(" · ")}
        </p>
      </div>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-primary transition hover:bg-accent" aria-label={`Open ${source.title}`}>
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : null}
    </div>
    {source.claimSupported ? (
      <div className="mt-3 rounded-xl bg-muted/50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Claim supported</p>
        <p className="mt-1 text-sm leading-6">{source.claimSupported}</p>
      </div>
    ) : null}
    {source.summary ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{source.summary}</p> : null}
    {source.relevanceToPinkPaisa ? <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Pink Paisa relevance:</span> {source.relevanceToPinkPaisa}</p> : null}
    {source.influenceReason ? <p className="mt-2 text-xs text-muted-foreground">Decision note: {source.influenceReason}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Confidence</span>
      <span className="font-medium">{formatConfidence(source.confidence)}</span>
      {source.validationFlags.map((flag) => <Badge key={flag} variant="destructive">{flag}</Badge>)}
    </div>
  </div>
);

const SignalList = ({ title, icon: Icon, signals, empty }: { title: string; icon: typeof Globe2; signals: SocialSignal[]; empty: string }) => (
  <Card className="rounded-3xl shadow-none">
    <CardHeader>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <CardTitle className="text-lg">{title}</CardTitle>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {signals.map((signal, index) => (
        <div key={signal.id || `${signal.label}-${index}`} className="rounded-2xl border border-border/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{signal.label}</p>
            <div className="flex gap-1.5">
              {signal.included !== null ? <Badge variant={signal.included ? "default" : "outline"}>{signal.included ? "Used" : "Excluded"}</Badge> : null}
              {signal.freshness ? <Badge variant="secondary">{signal.freshness}</Badge> : null}
            </div>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{signal.summary || "No summary returned."}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {signal.relevance ? <span>Relevance: {signal.relevance}</span> : null}
            {signal.confidence !== null ? <span>Confidence: {formatConfidence(signal.confidence)}</span> : null}
          </div>
          {signal.reason ? <p className="mt-2 text-xs">{signal.reason}</p> : null}
        </div>
      ))}
      {!signals.length ? <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p> : null}
    </CardContent>
  </Card>
);

export const SocialResearchView = ({ draft }: { draft: SocialDraft | null }) => {
  if (!draft) return <EmptyState icon={SearchCheck} text="Generate or open a draft to inspect its research evidence." />;
  const sources = draft.sources.length ? draft.sources : draft.primary.sources;
  const marketAnalysis = draft.marketAnalysis || {};
  const marketValue = (...keys: string[]) => keys.map((key) => marketAnalysis[key]).find((value) => value !== undefined && value !== null);
  const textItems = (value: unknown) => Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String((item as Record<string, unknown>).summary || (item as Record<string, unknown>).headline || (item as Record<string, unknown>).format || "Insight") : String(item)) : [];
  const formatConsiderations = Array.isArray(marketValue("recommendedFormatConsiderations", "recommended_format_considerations"))
    ? marketValue("recommendedFormatConsiderations", "recommended_format_considerations") as Array<Record<string, unknown>>
    : [];
  const importantMarketSignals = Array.isArray(marketValue("importantMarketSignals", "important_market_signals"))
    ? marketValue("importantMarketSignals", "important_market_signals") as Array<Record<string, unknown>>
    : [];
  const relevantResources = Array.isArray(marketValue("relevantPinkPaisaResources", "relevant_pink_paisa_resources"))
    ? marketValue("relevantPinkPaisaResources", "relevant_pink_paisa_resources") as Array<Record<string, unknown>>
    : [];
  const sourceSignal = (source: SocialSource): SocialSignal => ({
    id: source.id,
    label: source.title,
    summary: source.claimSupported || source.summary,
    relevance: source.influenceReason,
    freshness: source.freshness,
    confidence: source.confidence,
    included: source.influenced,
    reason: source.influenceReason,
  });
  const internalSignals = draft.internalSignals.length
    ? draft.internalSignals
    : sources.filter((source) => source.sourceType.toUpperCase().startsWith("INTERNAL")).map(sourceSignal);
  const externalSignals = draft.externalSignals.length
    ? draft.externalSignals
    : sources.filter((source) => !source.sourceType.toUpperCase().startsWith("INTERNAL")).map(sourceSignal);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Evidence desk</p>
        <h2 className="mt-1 font-serif text-3xl">Research behind today’s decision</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Internal business signals and external context are shown as untrusted evidence, with freshness, confidence and influence notes.
        </p>
      </div>
      <Alert className="rounded-2xl border-emerald-200 bg-emerald-50/60">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <AlertTitle>Research cannot override brand or safety rules</AlertTitle>
        <AlertDescription>External pages are treated as data only. Unsupported current claims should be removed or replaced with an evergreen angle.</AlertDescription>
      </Alert>
      {Object.keys(marketAnalysis).length ? (
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="font-serif text-2xl">AI market and content analysis</CardTitle><CardDescription>Concise strategic reasoning only; no hidden chain-of-thought.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {importantMarketSignals.length ? <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Important signals</p><div className="grid gap-3 md:grid-cols-2">{importantMarketSignals.map((signal, index) => <div key={`${String(signal.headline)}-${index}`} className="rounded-xl border border-border/70 p-3"><div className="flex flex-wrap gap-2"><Badge variant="outline">{titleCase(String(signal.classification || "signal"))}</Badge>{signal.confidence !== undefined ? <Badge variant="secondary">{formatConfidence(Number(signal.confidence))}</Badge> : null}</div><p className="mt-2 text-sm font-medium">{String(signal.headline || "Market signal")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{String(signal.supportedClaim || signal.supported_claim || "")}</p>{signal.relevanceToPinkPaisa || signal.relevance_to_pink_paisa ? <p className="mt-2 text-xs"><span className="font-medium">Pink Paisa relevance:</span> {String(signal.relevanceToPinkPaisa || signal.relevance_to_pink_paisa)}</p> : null}</div>)}</div></div> : null}
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["Audience opportunity", marketValue("audienceProblemOrOpportunity", "audience_problem_or_opportunity")],
                ["Recommended direction", marketValue("recommendedContentDirection", "recommended_content_direction")],
                ["Promotional intensity", marketValue("recommendedPromotionalIntensity", "recommended_promotional_intensity")],
                ["Strategic rationale", marketValue("conciseRationale", "concise_rationale")],
              ].filter(([, value]) => value).map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border/70 p-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{String(label)}</p><p className="mt-2 text-sm leading-6">{String(value)}</p></div>)}
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {[
                ["Topics to avoid", textItems(marketValue("topicsToAvoid", "topics_to_avoid"))],
                ["Overused recent topics", textItems(marketValue("overusedRecentTopics", "overused_recent_topics"))],
                ["Weak or unconfirmed trends", textItems(marketValue("weakOrUnconfirmedTrends", "weak_or_unconfirmed_trends"))],
              ].map(([label, values]) => <div key={String(label)} className="rounded-xl bg-muted/40 p-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{String(label)}</p>{(values as string[]).length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{(values as string[]).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">None returned.</p>}</div>)}
            </div>
            {formatConsiderations.length ? <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Format considerations</p><div className="flex flex-wrap gap-2">{formatConsiderations.map((item, index) => <Badge key={`${String(item.format)}-${index}`} variant="outline">{titleCase(String(item.format || "format"))}: {String(item.fitReason || item.fit_reason || "")}</Badge>)}</div></div> : null}
            {relevantResources.length ? <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Relevant Pink Paisa resources</p><div className="grid gap-2 md:grid-cols-2">{relevantResources.map((resource, index) => <div key={`${String(resource.title)}-${index}`} className="rounded-xl bg-muted/40 p-3"><p className="text-sm font-medium">{String(resource.title || "Pink Paisa resource")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{String(resource.relevance || "")}</p>{resource.landingPage || resource.landing_page ? <a href={String(resource.landingPage || resource.landing_page)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" /> Open resource</a> : null}</div>)}</div></div> : null}
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-2">
        <SignalList title="Internal Pink Paisa signals" icon={Target} signals={internalSignals} empty="No itemised internal signals were stored with this draft." />
        <SignalList title="External market signals" icon={Globe2} signals={externalSignals} empty="No external signals were used. This may be an intentional evergreen recommendation." />
      </div>
      <Card className="rounded-3xl shadow-none">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Supporting sources</CardTitle>
          <CardDescription>{sources.length} traceable source{sources.length === 1 ? "" : "s"} attached to this recommendation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {sources.map((source, index) => <SourceCard key={source.id || `${source.url}-${index}`} source={source} />)}
          {!sources.length ? (
            <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
              <p className="mt-3 font-medium">No sources were attached</p>
              <p className="mt-1 text-sm text-muted-foreground">Do not publish current statistics, news, prices or trend claims until evidence is attached and fact-checked.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {draft.rejectedIdeas.length ? (
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">Rejected candidate ideas</CardTitle><CardDescription>Concise reasons retained for operational transparency.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {draft.rejectedIdeas.map((idea, index) => (
              <div key={`${idea.topic}-${index}`} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div><p className="text-sm font-medium">{idea.topic || "Untitled idea"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{idea.reasonRejected || "Rejected during strategy or compliance screening."}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

const CALENDAR_STATUSES = [
  "ALL",
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
] as const;

export const SocialCalendarView = ({
  drafts,
  loading,
  filter,
  onFilterChange,
  onOpenDraft,
}: {
  drafts: SocialDraft[];
  loading: boolean;
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenDraft: (draft: SocialDraft) => void;
}) => {
  const visibleDrafts = filter === "ALL" ? drafts : drafts.filter((draft) => draft.status === filter);
  const groups = useMemo(() => {
    const map = new Map<string, SocialDraft[]>();
    visibleDrafts.forEach((draft) => {
      const source = draft.scheduledFor || draft.generationDate || draft.createdAt || "Undated";
      const parsed = source === "Undated" ? null : new Date(source);
      const key = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : String(source).slice(0, 10) || "Undated";
      map.set(key, [...(map.get(key) || []), draft]);
    });
    return Array.from(map.entries()).sort(([left], [right]) => right.localeCompare(left));
  }, [visibleDrafts]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Agenda calendar</p>
          <h2 className="mt-1 font-serif text-3xl">Drafts through publication</h2>
          <p className="mt-2 text-sm text-muted-foreground">A status-first agenda for content operations in Asia/Kolkata.</p>
        </div>
        <p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(drafts[0]?.updatedAt)}`}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {CALENDAR_STATUSES.filter((status) => status !== "ALL").map((status) => (
          <button key={status} type="button" onClick={() => onFilterChange(status)} className={`rounded-xl border p-3 text-left transition hover:border-primary/40 ${filter === status ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{titleCase(status)}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{drafts.filter((draft) => draft.status === status).length}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {CALENDAR_STATUSES.map((status) => <Button key={status} size="sm" variant={filter === status ? "default" : "outline"} onClick={() => onFilterChange(status)}>{titleCase(status)}</Button>)}
      </div>
      {loading && !drafts.length ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
      {!loading && !visibleDrafts.length ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={CalendarDays} text="No social drafts match this agenda filter." /></Card> : null}
      <div className="space-y-5">
        {groups.map(([date, items]) => (
          <section key={date} className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
            <div className="pt-3">
              <p className="text-sm font-semibold">{date === "Undated" ? date : formatDateTime(`${date}T12:00:00`, false)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</p>
            </div>
            <div className="space-y-3 border-l border-border pl-4">
              {items.map((draft) => (
                <button key={draft.id} type="button" onClick={() => onOpenDraft(draft)} className="group flex w-full items-start gap-4 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/30 hover:shadow-sm">
                  <div className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-primary bg-background ring-4 ring-primary/10" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><StatusBadge status={draft.status.toLowerCase()} />{draft.scheduledFor ? <Badge variant="outline"><Clock3 className="mr-1 h-3 w-3" /> {formatDateTime(draft.scheduledFor)}</Badge> : null}</div>
                    <p className="mt-2 font-medium">{draft.primary.internalTitle || draft.primary.topic || "Untitled social draft"}</p>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{draft.primary.whyToday || draft.primary.caption || "No rationale saved."}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{titleCase(draft.primary.format)}</span><span>·</span><span>{draft.primary.contentPillar || "Unassigned pillar"}</span></div>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

const METRIC_FIELDS = [
  ["reach", "Reach"], ["impressions", "Impressions"], ["likes", "Likes"], ["comments", "Comments"],
  ["saves", "Saves"], ["shares", "Shares"], ["video_views", "Video views"], ["video_completions", "Video completions"], ["completion_rate", "Completion rate (%)"], ["profile_visits", "Profile visits"],
  ["follows", "Follows"], ["website_clicks", "Website clicks"], ["landing_page_sessions", "Landing sessions"],
  ["affiliate_cta_clicks", "Affiliate CTA clicks"], ["quiz_starts", "Quiz starts"], ["quiz_completions", "Quiz completions"],
  ["calculator_opens", "Calculator opens"], ["workshop_enquiries", "Workshop enquiries"], ["product_page_visits", "Product-page visits"], ["negative_feedback", "Negative feedback"],
] as const;

export const SocialPerformanceView = ({
  draft,
  drafts,
  submitting,
  onSelectDraft,
  onSubmit,
}: {
  draft: SocialDraft | null;
  drafts: SocialDraft[];
  submitting: boolean;
  onSelectDraft: (draft: SocialDraft) => void;
  onSubmit: (payload: { captured_at?: string; metrics: Record<string, number>; notes?: string }) => void;
}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [capturedAt, setCapturedAt] = useState("");
  const [notes, setNotes] = useState("");
  const update = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const metrics = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "").map(([key, value]) => [key, key === "completion_rate" ? Number(value) / 100 : Number(value)]));
    onSubmit({ captured_at: capturedAt ? new Date(capturedAt).toISOString() : undefined, metrics, notes: notes.trim() || undefined });
  };
  const selectable = drafts.filter((item) => ["PUBLISHED", "SCHEDULED", "APPROVED"].includes(item.status));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Learning loop</p>
        <h2 className="mt-1 font-serif text-3xl">Performance snapshots</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Record immutable snapshots. Historical performance informs future choices, but weak correlations are never presented as causation.</p>
      </div>
      <Alert className="rounded-2xl"><TrendingUp className="h-4 w-4" /><AlertTitle>Directional insight only</AlertTitle><AlertDescription>Saves, shares, clicks and posting time are useful signals. Audience mix, creative quality and external events may also influence outcomes.</AlertDescription></Alert>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="font-serif text-2xl">Add a manual snapshot</CardTitle><CardDescription>Platform imports can add more snapshots later without overwriting this one.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <Field label="Post draft">
              <select value={draft?.id || ""} onChange={(event) => { const selected = selectable.find((item) => item.id === event.target.value); if (selected) onSelectDraft(selected); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select a published or approved draft</option>
                {selectable.map((item) => <option key={item.id} value={item.id}>{item.primary.internalTitle || item.primary.topic || item.id} · {titleCase(item.status)}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {METRIC_FIELDS.map(([key, label]) => (
                <Field key={key} label={label}><Input type="number" min="0" max={key === "completion_rate" ? "100" : undefined} step={key === "completion_rate" ? "0.01" : "1"} value={values[key] || ""} onChange={(event) => update(key, event.target.value)} /></Field>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Captured at"><Input type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} /></Field>
              <Field label="Notes"><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Campaign context or data caveat" /></Field>
            </div>
            <Button onClick={submit} disabled={!draft?.id || submitting || !Object.values(values).some((value) => value !== "")}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Save immutable snapshot
            </Button>
          </CardContent>
        </Card>
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">Snapshot history</CardTitle><CardDescription>{draft ? draft.primary.internalTitle || draft.primary.topic : "Select a draft"}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {draft?.metricSnapshots.map((snapshot, index) => (
              <div key={snapshot.id || `${snapshot.capturedAt}-${index}`} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-2"><Badge variant="outline">{titleCase(snapshot.source)}</Badge><span className="text-xs text-muted-foreground">{formatDateTime(snapshot.capturedAt)}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {Object.entries(snapshot.metrics).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] uppercase text-muted-foreground">{titleCase(key)}</p><p className="font-semibold tabular-nums">{key === "completion_rate" ? `${(value * 100).toFixed(1)}%` : value.toLocaleString("en-IN")}</p></div>)}
                </div>
                {snapshot.notes ? <p className="mt-3 text-xs text-muted-foreground">{snapshot.notes}</p> : null}
              </div>
            ))}
            {!draft?.metricSnapshots.length ? <p className="py-10 text-center text-sm text-muted-foreground">No snapshots recorded for this draft yet.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export const SocialSettingsView = ({
  settings,
  readiness,
  loading,
  saving,
  onChange,
  onSave,
}: {
  settings: SocialSettings;
  readiness: SocialReadiness;
  loading: boolean;
  saving: boolean;
  onChange: (next: SocialSettings) => void;
  onSave: () => void;
}) => {
  const patch = (changes: Partial<SocialSettings>) => onChange({ ...settings, ...changes });
  const pillarTotal = settings.contentPillars.filter((pillar) => pillar.enabled).reduce((total, pillar) => total + pillar.ratio, 0);
  const updatePillar = (index: number, changes: Partial<SocialSettings["contentPillars"][number]>) => patch({
    contentPillars: settings.contentPillars.map((pillar, pillarIndex) => pillarIndex === index ? { ...pillar, ...changes } : pillar),
  });

  if (loading) return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const brandLogo = settings.brandLogoContract;
  const brandLogoReady = brandLogoContractReady(brandLogo);
  const brandLogoPreview = brandLogo.referenceUrl || "/pink-paisa-logo.png";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Control room</p><h2 className="mt-1 font-serif text-3xl">Strategy and automation settings</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Configure the brand, research boundaries, content mix, cost controls and approval policy. Auto-publish remains off by default.</p></div>
        <Button onClick={onSave} disabled={saving || pillarTotal !== 100}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings</Button>
      </div>
      {readiness.blockers.length ? <Alert className="rounded-2xl border-amber-200 bg-amber-50/70"><AlertTriangle className="h-4 w-4 text-amber-700" /><AlertTitle>Setup has {readiness.blockers.length} blocker(s)</AlertTitle><AlertDescription>{readiness.blockers.join(" · ")}</AlertDescription></Alert> : null}
      <Card className="rounded-3xl border-primary/20 shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><CardTitle className="text-lg">Approved Pink Paisa logo</CardTitle><CardDescription>Every newly generated final image must visibly include this approved reference. The requirement cannot be disabled.</CardDescription></div>
            <div className="flex flex-wrap gap-2"><Badge variant="secondary">Approved 512 badge</Badge><Badge variant={brandLogoReady ? "default" : "destructive"}>{brandLogoReady ? "Ready for AI generation" : "Logo setup incomplete"}</Badge></div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-3xl border border-border bg-white p-3">
            <img src={brandLogoPreview} alt="Approved Pink Paisa 512 pixel profile badge" className="h-full w-full object-contain" />
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 p-3"><p className="text-xs text-muted-foreground">Reference asset ID</p><p className="mt-1 break-all font-mono text-xs">{brandLogo.referenceAssetId || "Not configured"}</p></div>
              <div className="rounded-xl border border-border/70 p-3"><p className="text-xs text-muted-foreground">Contract version</p><p className="mt-1 font-mono text-xs">v{brandLogo.contractVersion || "—"}</p></div>
              <div className="rounded-xl border border-border/70 p-3"><p className="text-xs text-muted-foreground">Policy version</p><p className="mt-1 break-all font-mono text-xs">{brandLogo.policyVersion || "Not configured"}</p></div>
              <div className="rounded-xl border border-border/70 p-3 sm:col-span-3"><p className="text-xs text-muted-foreground">Reference SHA-256</p><p className="mt-1 break-all font-mono text-xs">{brandLogo.referenceChecksumSha256 || "Not configured"}</p></div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-medium">Mandatory logo policy</p><p className="text-xs text-muted-foreground">AI reference baked at high fidelity; no post-generation logo overlay.</p></div><Switch checked disabled aria-label="Approved Pink Paisa logo required on every new image" /></div>
            <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">{brandLogo.referenceWidth || 512} × {brandLogo.referenceHeight || 512} PNG</Badge><Badge variant="outline">Input fidelity · {titleCase(brandLogo.inputFidelity || "high")}</Badge><Badge variant="outline">Target width · {brandLogo.targetWidthPx || 210}px ({brandLogo.acceptedWidthRangePx.join("–") || "180–240"}px accepted)</Badge><Badge variant="outline">Placement · adaptive safe corner, locked per draft</Badge><Badge variant="outline">Settings corner · {brandLogo.lockedCorner || "Chosen and locked per draft"}</Badge><Badge variant="outline">Status · {titleCase(brandLogo.readinessStatus || "not configured")}</Badge></div>
            {!brandLogoReady ? <Alert variant="destructive" className="rounded-xl"><AlertTriangle className="h-4 w-4" /><AlertTitle>Generation must remain blocked</AlertTitle><AlertDescription>The approved 512 × 512 PNG, exact SHA-256 and ready server contract are required before creating new images.</AlertDescription></Alert> : null}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">Brand and audience</CardTitle><CardDescription>The daily strategy system treats this as policy, not optional inspiration.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Brand profile"><Textarea rows={7} value={settings.brandProfile} onChange={(event) => patch({ brandProfile: event.target.value })} /></Field>
            <Field label="Target audience"><Textarea rows={6} value={settings.targetAudience} onChange={(event) => patch({ targetAudience: event.target.value })} /></Field>
            <Field label="Financial disclaimer"><Textarea rows={3} value={settings.financialDisclaimer} onChange={(event) => patch({ financialDisclaimer: event.target.value })} /></Field>
            <Field label="Affiliate disclosure"><Textarea rows={3} value={settings.affiliateDisclosure} onChange={(event) => patch({ affiliateDisclosure: event.target.value })} /></Field>
          </CardContent>
        </Card>
        <Card className="rounded-3xl shadow-none">
          <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-lg">Content mix</CardTitle><CardDescription>Enabled pillars should total 100%.</CardDescription></div><Badge variant={pillarTotal === 100 ? "default" : "destructive"}>{pillarTotal}%</Badge></div></CardHeader>
          <CardContent className="space-y-3">
            {settings.contentPillars.map((pillar, index) => (
              <div key={`${pillar.name}-${index}`} className="grid items-center gap-3 rounded-xl border border-border/70 p-3 sm:grid-cols-[auto_minmax(0,1fr)_90px]">
                <Switch checked={pillar.enabled} onCheckedChange={(enabled) => updatePillar(index, { enabled })} aria-label={`Toggle ${pillar.name}`} />
                <Input value={pillar.name} disabled aria-label={`${pillar.name} content pillar`} />
                <div className="relative"><Input type="number" min="0" max="100" value={pillar.ratio} onChange={(event) => updatePillar(index, { ratio: Number(event.target.value) || 0 })} disabled={!pillar.enabled} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div>
              </div>
            ))}
            {pillarTotal !== 100 ? <p className="text-xs text-destructive">Adjust enabled pillar ratios to exactly 100 before saving.</p> : null}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">Timing and lifecycle</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Field label="Weekly planning"><Input type="time" value={settings.weeklyPlanningTime} onChange={(event) => patch({ weeklyPlanningTime: event.target.value })} /></Field>
              <Field label="Default posting"><Input type="time" value={settings.defaultPostingTime} onChange={(event) => patch({ defaultPostingTime: event.target.value })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Field label="Maximum feed posts / week"><Input type="number" min="1" max="5" value={settings.weeklyPublicationMaximum} onChange={(event) => patch({ weeklyPublicationMaximum: Math.min(Math.max(Number(event.target.value) || 5, 1), 5) })} /></Field>
              <Field label="Pre-publication lead (hours)"><Input type="number" min="1" max="168" value={settings.prePublicationLeadHours} onChange={(event) => patch({ prePublicationLeadHours: Number(event.target.value) || 24 })} /></Field>
            </div>
            <Field label="Posting days" hint="Comma-separated days used as planning preferences."><Input value={settings.postingDays.join(", ")} onChange={(event) => patch({ postingDays: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
            <Field label="Legacy daily generation time" hint="Retained for backward-compatible daily runs."><Input type="time" value={settings.dailyGenerationTime} onChange={(event) => patch({ dailyGenerationTime: event.target.value })} /></Field>
            <Field label="Timezone"><Input value={settings.timezone} onChange={(event) => patch({ timezone: event.target.value })} /></Field>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-medium">Approval required</p><p className="text-xs text-muted-foreground">Safety policy keeps human approval enabled.</p></div><Switch checked disabled aria-label="Human approval required" /></div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-medium">Daily Story planning</p><p className="text-xs text-muted-foreground">Required for the approved cadence. Companion Stories share the parent approval transaction; standalone weekend Stories keep separate final approval.</p></div><Switch checked aria-label="Daily Story planning enabled" disabled /></div>
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Advanced · publishing override</summary>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-medium">Auto-publish</p><p className="text-xs text-muted-foreground">Available only when publishing and Instagram are ready. Human strategy and creative approvals still remain mandatory.</p></div><Switch checked={settings.autoPublish} onCheckedChange={(autoPublish) => patch({ autoPublish })} disabled={!readiness.publishingEnabled || !readiness.instagramConnected} /></div>
            </details>
          </CardContent>
        </Card>
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">Advanced controls</CardTitle><CardDescription>Model selection, bounded retries, full-AI mode and other operator overrides.</CardDescription></CardHeader>
          <CardContent>
            <details className="rounded-2xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">Advanced · models, retries and visual overrides</summary>
              <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supervisor model"><Input value={settings.supervisorModel} onChange={(event) => patch({ supervisorModel: event.target.value })} /></Field>
              <Field label="Research model"><Input value={settings.researchModel} onChange={(event) => patch({ researchModel: event.target.value })} /></Field>
              <Field label="Strategy model"><Input value={settings.strategyModel} onChange={(event) => patch({ strategyModel: event.target.value })} /></Field>
              <Field label="Audience model"><Input value={settings.audienceModel} onChange={(event) => patch({ audienceModel: event.target.value })} /></Field>
              <Field label="Copy model"><Input value={settings.copyModel} onChange={(event) => patch({ copyModel: event.target.value })} /></Field>
              <Field label="Compliance model"><Input value={settings.complianceModel} onChange={(event) => patch({ complianceModel: event.target.value })} /></Field>
              <Field label="Visual direction model"><Input value={settings.visualDirectionModel} onChange={(event) => patch({ visualDirectionModel: event.target.value })} /></Field>
              <Field label="Assembly model"><Input value={settings.assemblyModel} onChange={(event) => patch({ assemblyModel: event.target.value })} /></Field>
              <Field label="Growth analyst model"><Input value={settings.growthModel} onChange={(event) => patch({ growthModel: event.target.value })} /></Field>
              <Field label="Community model"><Input value={settings.communityModel} onChange={(event) => patch({ communityModel: event.target.value })} /></Field>
            </div>
            <Field label="Image model"><Input value={settings.imageModel} onChange={(event) => patch({ imageModel: event.target.value })} /></Field>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900">
              <p className="font-medium">Full AI generation is enforced</p>
              <p className="mt-1 text-xs leading-5">Deterministic content and template-only visual fallbacks are disabled. Failed attempts remain visible for manual retry.</p>
            </div>
            <div className="grid grid-cols-2 gap-3"><Field label="Content revisions"><Input type="number" min="0" max="3" value={settings.maxContentRevisions} onChange={(event) => patch({ maxContentRevisions: Number(event.target.value) || 0 })} /></Field><Field label="Image retries"><Input type="number" min="0" max="3" value={settings.maxImageRetries} onChange={(event) => patch({ maxImageRetries: Number(event.target.value) || 0 })} /></Field></div>
            <Field label="Default visual mode" hint="Legacy artwork-only remains readable but cannot be selected for new generation."><select value={settings.defaultVisualMode} onChange={(event) => patch({ defaultVisualMode: event.target.value as SocialSettings["defaultVisualMode"] })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="AI_BRANDED_ARTWORK">AI-branded artwork — Approved logo reference, no overlay</option><option value="FULL_AI_GRAPHIC">AI-native complete graphic — Approved logo reference, no overlay</option><option value="AI_VISUAL_WITH_EXACT_OVERLAY">AI artwork + verified overlay — Protected formats</option></select></Field>
            <Field label="Monthly budget (₹)"><Input type="number" min="0" value={settings.monthlyCostLimit} onChange={(event) => patch({ monthlyCostLimit: Number(event.target.value) || 0 })} /></Field>
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-sky-900">
              <p className="font-medium">Request throttles are disabled</p>
              <p className="mt-1 text-xs leading-5">Social Manager API requests, generations, and AI images have no hourly or daily count caps. The monthly currency budget remains available as a spend control.</p>
            </div>
                <Field label="Duplicate lookback days"><Input type="number" min="60" max="90" value={settings.duplicateLookbackDays} onChange={(event) => patch({ duplicateLookbackDays: Number(event.target.value) || 90 })} /></Field>
              </div>
            </details>
          </CardContent>
        </Card>
        <Card className="rounded-3xl shadow-none">
          <CardHeader><CardTitle className="text-lg">UTMs and notifications</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="UTM source"><Input value={settings.utmSource} onChange={(event) => patch({ utmSource: event.target.value })} /></Field>
            <Field label="UTM medium"><Input value={settings.utmMedium} onChange={(event) => patch({ utmMedium: event.target.value })} /></Field>
            <Field label="Campaign prefix"><Input value={settings.utmCampaignPrefix} onChange={(event) => patch({ utmCampaignPrefix: event.target.value })} /></Field>
            <Field label="Notification recipients" hint="Comma-separated admin or reviewer email addresses."><Textarea rows={3} value={settings.notificationRecipients.join(", ")} onChange={(event) => patch({ notificationRecipients: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="text-lg">Trusted research domains</CardTitle><CardDescription>One domain per line. Keep the list selective and authoritative.</CardDescription></CardHeader><CardContent><Textarea rows={7} value={settings.researchDomains.join("\n")} onChange={(event) => patch({ researchDomains: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></CardContent></Card>
        <Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="text-lg">Blocked research domains</CardTitle><CardDescription>Sources from these domains are excluded from research.</CardDescription></CardHeader><CardContent><Textarea rows={7} value={settings.blockedDomains.join("\n")} onChange={(event) => patch({ blockedDomains: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></CardContent></Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="text-lg">Research volume</CardTitle><CardDescription>One substantial weekly digest, bounded candidate and source counts.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><Field label="Candidate ideas"><Input type="number" min="8" max="20" value={settings.candidateCount} onChange={(event) => patch({ candidateCount: Number(event.target.value) || 8 })} /></Field><Field label="Research result limit"><Input type="number" min="1" max="100" value={settings.researchResultLimit} onChange={(event) => patch({ researchResultLimit: Number(event.target.value) || 20 })} /></Field></CardContent></Card>
        <Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="text-lg">Watchlists</CardTitle><CardDescription>Official Meta research only; Instagram is never scraped. Discovery requires the Facebook Login capability family.</CardDescription></CardHeader><CardContent className="space-y-4"><Field label="Competitor and reference accounts" hint="One admin-approved public professional account per line."><Textarea rows={4} value={settings.competitorWatchlist.join("\n")} onChange={(event) => patch({ competitorWatchlist: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></Field><Field label="Hashtags" hint="One per line. Meta allows 30 unique hashtag queries per professional account in a rolling seven-day window."><Textarea rows={4} value={settings.hashtagWatchlist.join("\n")} onChange={(event) => patch({ hashtagWatchlist: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></Field></CardContent></Card>
        <Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="text-lg">Community safety</CardTitle><CardDescription>Human approval remains the initial production default.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">Auto-reply</p><p className="text-xs text-muted-foreground">Send approved replies automatically.</p></div><Switch checked={settings.autoReply} onCheckedChange={(autoReply) => patch({ autoReply })} /></div><div className="flex items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">Auto-DM</p><p className="text-xs text-muted-foreground">Send permitted private replies automatically.</p></div><Switch checked={settings.autoDm} onCheckedChange={(autoDm) => patch({ autoDm })} /></div><div className="flex items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">Auto-hide spam</p><p className="text-xs text-muted-foreground">Hide only confidently classified spam.</p></div><Switch checked={settings.autoHideSpam} onCheckedChange={(autoHideSpam) => patch({ autoHideSpam })} /></div><Field label="Metric snapshots (hours)" hint="Comma-separated intervals after publication."><Input value={settings.analyticsIntervalsHours.join(", ")} onChange={(event) => patch({ analyticsIntervalsHours: event.target.value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0) })} /></Field></CardContent></Card>
      </div>
    </div>
  );
};

export const SocialAuditView = ({ draft }: { draft: SocialDraft | null }) => {
  if (!draft) return <EmptyState icon={History} text="Generate or open a draft to view its audit trail." />;
  return (
    <div className="space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Traceability</p><h2 className="mt-1 font-serif text-3xl">Draft audit timeline</h2><p className="mt-2 text-sm text-muted-foreground">Generation, edits, approvals, scheduling, publishing and errors—without hidden chain-of-thought.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Draft</p><p className="mt-1 truncate font-medium">{draft.id}</p></CardContent></Card>
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Prompt version</p><p className="mt-1 font-medium">{draft.promptVersion || "Not recorded"}</p></CardContent></Card>
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Model</p><p className="mt-1 font-medium">{draft.model || "Not recorded"}</p></CardContent></Card>
        <Card className="rounded-2xl shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Last updated</p><p className="mt-1 font-medium">{formatDateTime(draft.updatedAt)}</p></CardContent></Card>
      </div>
      <Card className="rounded-3xl shadow-none">
        <CardHeader><CardTitle className="text-lg">Lifecycle events</CardTitle><CardDescription>{draft.auditLogs.length} recorded event{draft.auditLogs.length === 1 ? "" : "s"}.</CardDescription></CardHeader>
        <CardContent>
          {draft.auditLogs.length ? (
            <div className="relative ml-2 space-y-0 border-l border-border pl-6">
              {[...draft.auditLogs].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).map((event, index) => (
                <div key={event.id || `${event.action}-${index}`} className="relative pb-7 last:pb-0">
                  <span className="absolute -left-[31px] top-1 flex h-3 w-3 rounded-full border-2 border-primary bg-card ring-4 ring-card" />
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{titleCase(event.action)}</Badge><span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span></div>
                  <p className="mt-2 text-sm font-medium">{event.summary || titleCase(event.action)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">By {event.actor}</p>
                  {Object.keys(event.metadata).length ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">View event details</summary><pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-[11px]">{JSON.stringify(event.metadata, null, 2)}</pre></details> : null}
                </div>
              ))}
            </div>
          ) : <EmptyState icon={FileClock} text="No audit events were returned for this draft." />}
        </CardContent>
      </Card>
    </div>
  );
};
