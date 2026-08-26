import {
  AlertCircle,
  BarChart3,
  Bot,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "../AdminShared";
import {
  SocialAnalyticsAttributionRow,
  SocialAnalyticsBaseline,
  SocialAnalyticsSummary,
} from "./types";

type SocialPublishedAnalyticsViewProps = {
  summary: SocialAnalyticsSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  onReload: () => void;
  onRefresh: () => void;
  children: React.ReactNode;
};

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

const formatGa4Date = (value: string | null) => {
  if (!value) return "Date unavailable";
  if (/^\d{8}$/.test(value)) {
    const parsed = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
    return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return formatDateTime(value, true);
};

const formatNumber = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const MetricTiles = ({ values, percent = false }: { values: Record<string, number>; percent?: boolean }) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {Object.entries(values).map(([key, value]) => (
      <Card key={key} className="rounded-2xl shadow-none">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{titleCase(key)}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{percent ? `${(value <= 1 ? value * 100 : value).toFixed(1)}%` : formatNumber(value)}</p>
        </CardContent>
      </Card>
    ))}
  </div>
);

const AttributionRows = ({ title, rows }: { title: string; rows: SocialAnalyticsAttributionRow[] }) => {
  if (!rows.length) return null;
  const visibleRows = rows.slice(0, 6);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{title}</h4>
        <Badge variant="outline">{rows.length} aggregate row{rows.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visibleRows.map((row, index) => (
          <div key={`${row.date}-${row.campaign}-${row.content}-${row.eventName}-${index}`} className="rounded-2xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{formatGa4Date(row.date)}</Badge>
              <Badge variant="outline">{row.source} / {row.medium}</Badge>
              {row.eventName ? <Badge variant="outline">{row.eventName}</Badge> : null}
            </div>
            <p className="mt-3 text-sm font-medium">{row.campaign || "Campaign dimension unavailable"}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">Content: {row.content || "Not tagged"}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">Landing page: {row.landingPage || "Not returned"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(row.metrics).map(([metric, value]) => <Badge key={metric} variant="outline">{titleCase(metric)} {formatNumber(value)}</Badge>)}
              {!Object.keys(row.metrics).length ? <span className="text-xs text-muted-foreground">No numeric metrics returned for this row.</span> : null}
            </div>
          </div>
        ))}
      </div>
      {rows.length > visibleRows.length ? <p className="text-xs text-muted-foreground">Showing the first {visibleRows.length} of {rows.length} aggregate rows.</p> : null}
    </div>
  );
};

const BaselineComparisons = ({ rows }: { rows: SocialAnalyticsBaseline[] }) => {
  if (!rows.length) return <p className="text-xs text-muted-foreground">No eligible earlier posts exist for a like-for-like baseline yet.</p>;
  return (
    <details className="rounded-2xl border bg-muted/15 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Baseline comparisons ({rows.length})</summary>
      <div className="mt-4 space-y-3">
        {rows.map((baseline, index) => (
          <div key={`${baseline.postId}-${baseline.metric}-${baseline.baseline}-${index}`} className="rounded-xl bg-background p-3 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{titleCase(baseline.metric)}</span>
              <Badge variant="outline">{baseline.baseline}</Badge>
              <Badge variant="secondary">n={baseline.sampleSize}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div><p className="text-muted-foreground">Observed</p><p className="mt-1 font-semibold tabular-nums">{formatNumber(baseline.observedValue)}</p></div>
              <div><p className="text-muted-foreground">Baseline</p><p className="mt-1 font-semibold tabular-nums">{formatNumber(baseline.baselineValue)}</p></div>
              <div><p className="text-muted-foreground">Delta</p><p className="mt-1 font-semibold tabular-nums">{baseline.delta > 0 ? "+" : ""}{formatNumber(baseline.delta)}</p></div>
              <div><p className="text-muted-foreground">Ratio</p><p className="mt-1 font-semibold tabular-nums">{baseline.ratio === null ? "Unavailable" : `${baseline.ratio.toFixed(2)}×`}</p></div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
};

export const SocialPublishedAnalyticsView = ({
  summary,
  loading,
  refreshing,
  error,
  onReload,
  onRefresh,
  children,
}: SocialPublishedAnalyticsViewProps) => (
  <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Publishing outcomes</p>
        <h2 className="mt-1 font-serif text-3xl">Published & Analytics</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Measure reach quality, attributed traffic and conversions—not likes alone—and compare each post only with eligible earlier work.</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${formatDateTime(summary?.refreshedAt)}`}</span>
      </div>
    </div>
    <details className="rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-xs font-semibold text-primary">Advanced · metric collection</summary><div className="mt-3"><Button variant="outline" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Collect metrics now</Button></div></details>

    {error ? (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Analytics could not be loaded</AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3"><span>{error}</span><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onReload}><RefreshCw className="h-3.5 w-3.5" /> Reload results</Button><Button size="sm" variant="destructive" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />} Retry collection</Button></div></AlertDescription>
      </Alert>
    ) : null}
    {loading && !summary ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
    {!loading && !error && !summary ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={BarChart3} text="No aggregate analytics have been collected yet." /></Card> : null}

    {summary ? (
      <>
        <div className="flex flex-wrap gap-2"><Badge>{summary.rangeLabel}</Badge><Badge variant="outline">Refreshed {formatDateTime(summary.refreshedAt)}</Badge></div>
        {Object.keys(summary.metrics).length ? <MetricTiles values={summary.metrics} /> : <Card className="rounded-2xl border-dashed shadow-none"><CardContent className="p-5 text-sm text-muted-foreground">No aggregate social metrics are available for this reporting window.</CardContent></Card>}

        {Object.keys(summary.rates).length ? <><h3 className="font-serif text-xl">Quality and conversion rates</h3><MetricTiles values={summary.rates} percent /></> : null}

        {summary.attribution ? (
          <Card className="rounded-3xl border-primary/20 bg-primary/[0.02] shadow-none">
            <CardHeader>
              <div className="flex flex-wrap gap-2"><Badge>{summary.attribution.provider}</Badge><Badge variant="outline">{summary.attribution.source} / {summary.attribution.medium}</Badge></div>
              <CardTitle className="mt-3 font-serif text-2xl">Instagram organic-social attribution</CardTitle>
              <CardDescription>Aggregate GA4 traffic and conversion events from {formatDateTime(summary.attribution.periodStart, true)} to {formatDateTime(summary.attribution.periodEnd, true)} · captured {formatDateTime(summary.attribution.capturedAt)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.keys(summary.attribution.metrics).length ? <MetricTiles values={summary.attribution.metrics} /> : <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">GA4 returned no matching Instagram / organic_social aggregate metrics.</p>}
              <AttributionRows title="Attributed traffic rows" rows={summary.attribution.attributionRows} />
              <AttributionRows title="Conversion-event rows" rows={summary.attribution.conversionEventRows} />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-serif text-xl">Published post comparisons</h3><Badge variant="outline"><Gauge className="mr-1 h-3.5 w-3.5" /> {summary.baselines.length} baseline comparison{summary.baselines.length === 1 ? "" : "s"}</Badge></div>
        {!summary.posts.length ? <Card className="rounded-3xl border-dashed shadow-none"><EmptyState icon={BarChart3} text="No published posts fall inside this reporting window." /></Card> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {summary.posts.map((post) => (
            <Card key={post.id} className="rounded-3xl shadow-none">
              <CardHeader>
                <div className="flex flex-wrap gap-2"><Badge variant="outline">{titleCase(post.format || "published")}</Badge><Badge variant="secondary">{formatDateTime(post.publishedAt)}</Badge></div>
                <CardTitle className="mt-3 text-lg">{post.title}</CardTitle>
                <CardDescription>{post.contentPillar || "Content pillar unavailable"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">{Object.entries(post.metrics).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/45 p-2"><p className="text-[10px] text-muted-foreground">{titleCase(key)}</p><p className="font-semibold tabular-nums">{formatNumber(value)}</p></div>)}</div>
                {post.attribution ? (
                  <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">GA4 attributed</Badge><span>{post.attribution.matchedRows} matched aggregate row{post.attribution.matchedRows === 1 ? "" : "s"}</span></div>
                    {post.attribution.landingPages.length ? <p className="mt-2 break-all text-muted-foreground">Landing pages: {post.attribution.landingPages.join(" · ")}</p> : null}
                  </div>
                ) : null}
                <BaselineComparisons rows={post.baselines} />
                {post.learningSummary ? <p className="text-sm leading-6 text-muted-foreground">{post.learningSummary}</p> : null}
                {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary"><ExternalLink className="h-3.5 w-3.5" /> Open Instagram post</a> : null}
              </CardContent>
            </Card>
          ))}
        </div>

        {summary.learnings.length ? <Alert className="rounded-2xl"><Bot className="h-4 w-4" /><AlertTitle>AI learning summary</AlertTitle><AlertDescription><ul className="mt-2 list-disc space-y-1 pl-4">{summary.learnings.map((learning) => <li key={learning}>{learning}</li>)}</ul></AlertDescription></Alert> : null}
        {summary.warnings.length ? <Alert className="rounded-2xl border-amber-200 bg-amber-50"><ShieldAlert className="h-4 w-4" /><AlertTitle>Interpretation and availability notes</AlertTitle><AlertDescription><ul className="mt-2 list-disc space-y-1 pl-4">{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></AlertDescription></Alert> : null}
      </>
    ) : null}

    <details className="rounded-3xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">Manual snapshots and historical detail</summary><div className="mt-5">{children}</div></details>
  </div>
);
