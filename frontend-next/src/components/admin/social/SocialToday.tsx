import { ChangeEvent, ReactNode, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  Layers3,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "../AdminShared";
import { appendUtm, formatConfidence, fromDateTimeLocal, toDateTimeLocal } from "./adapters";
import {
  AI_NATIVE_FULL_GRAPHIC_LABEL,
  deriveDraftWorkflow,
  isAiNativeFullGraphicAsset,
} from "./socialWorkflow";
import { artworkOnlyEligibility } from "./socialVisualMode";
import {
  SocialDraft,
  SocialAsset,
  SocialFormatPreference,
  SocialGenerationRequest,
  SocialGenerationRun,
  SocialReadiness,
  SocialRecommendation,
  SocialSlide,
  SocialVisualMode,
} from "./types";

export type SocialDraftAction =
  | "submit-review"
  | "approve"
  | "approve-and-schedule"
  | "reject"
  | "schedule"
  | "publish"
  | "duplicate"
  | "regenerate"
  | "retry-run"
  | "render"
  | "audio-track";

type SocialTodayProps = {
  draft: SocialDraft | null;
  previousDraft: SocialDraft | null;
  generationRun: SocialGenerationRun | null;
  readiness: SocialReadiness;
  loading: boolean;
  generating: boolean;
  busyAction: string;
  dirty: boolean;
  loadError: string;
  onGenerate: (request: SocialGenerationRequest) => void;
  onReload: () => void;
  onRecommendationChange: (next: SocialRecommendation) => void;
  onScheduleChange: (value: string) => void;
  onSave: () => void;
  onAction: (action: SocialDraftAction, payload?: Record<string, unknown>) => void;
  onAdoptAlternative: (index: number) => void;
  onExport: () => void;
  reviewMode?: boolean;
  reviewAdvancedContent?: ReactNode;
  reviewSupplementContent?: ReactNode;
  weeklyLinked?: boolean;
  companionStoryReady?: boolean;
  companionDraft?: SocialDraft | null;
  companionLoading?: boolean;
  companionError?: string;
  defaultVisualMode?: SocialVisualMode;
};

const FORMAT_OPTIONS: Array<{ value: SocialFormatPreference; label: string }> = [
  { value: "AUTO_CHOOSE", label: "Auto Choose" },
  { value: "SINGLE_IMAGE", label: "Single Image" },
  { value: "CAROUSEL", label: "Carousel" },
  { value: "REEL", label: "Reel" },
  { value: "VIDEO_FEED", label: "Video Feed" },
  { value: "STORY", label: "Story" },
  { value: "INFOGRAPHIC", label: "Infographic" },
  { value: "MEME", label: "Meme" },
  { value: "POLL_CONCEPT", label: "Poll Concept" },
  { value: "QUIZ", label: "Quiz" },
  { value: "PRODUCT_FEATURE", label: "Product Feature" },
  { value: "RESOURCE_PROMOTION", label: "Resource Promotion" },
  { value: "WORKSHOP_PROMOTION", label: "Workshop Promotion" },
];

const OBJECTIVE_OPTIONS = [
  { value: "AUTO_CHOOSE", label: "Auto Choose" },
  { value: "AWARENESS", label: "Awareness" },
  { value: "EDUCATION", label: "Education" },
  { value: "ENGAGEMENT", label: "Engagement" },
  { value: "COMMUNITY_BUILDING", label: "Community building" },
  { value: "TRAFFIC", label: "Traffic" },
  { value: "LEADS", label: "Leads" },
] as const;

const requestVisualMode = (value: SocialDraft["visualMode"] | SocialVisualMode): SocialVisualMode => (
  ["AI_VISUAL_WITH_EXACT_OVERLAY", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC"].includes(String(value))
    ? value as SocialVisualMode
    : "AI_VISUAL_WITH_EXACT_OVERLAY"
);

const isVideoAsset = (asset: SocialAsset | undefined) => Boolean(asset && (
  asset.mediaKind.toUpperCase() === "VIDEO"
  || asset.mimeType.toLowerCase().startsWith("video/")
  || asset.role.toUpperCase() === "FINAL_VIDEO"
  || asset.type.toLowerCase().includes("video")
));

const isReviewableMediaAsset = (asset: SocialAsset) => {
  const role = asset.role.toUpperCase();
  if (!["FINAL_COMPOSED", "FINAL_VIDEO"].includes(role) || asset.mediaKind.toUpperCase() === "SUBTITLE") return false;
  return Boolean(asset.finalUrl || asset.previewUrl || asset.url)
    && (isVideoAsset(asset) || !asset.mimeType || asset.mimeType.toLowerCase().startsWith("image/") || asset.mediaKind.toUpperCase() === "IMAGE");
};

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const normalizedHashtag = (value: string) => {
  const tag = value.trim().replace(/^#+/, "");
  return tag ? `#${tag}` : "";
};

const localCaptionFallback = (recommendation: SocialRecommendation) => {
  const hashtags = recommendation.hashtags.map(normalizedHashtag).filter(Boolean).join(" ");
  return [
    recommendation.affiliateDisclosure,
    recommendation.caption,
    recommendation.cta,
    recommendation.financialDisclaimer,
    hashtags,
  ].map((value) => value.trim()).filter(Boolean).join("\n\n");
};

const formatDate = (value: string | null | undefined, withTime = false) => {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

const totalScore = (recommendation: SocialRecommendation) => {
  if (recommendation.score !== null) return recommendation.score;
  const values = Object.values(recommendation.scoreBreakdown);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
};

const editorialBlockers = (draft: SocialDraft) => {
  const recommendation = draft.primary;
  const blockers: string[] = [];
  if (!recommendation.topic.trim()) blockers.push("Topic is required");
  if (recommendation.hooks.length !== 3 || recommendation.hooks.some((hook) => !hook.trim())) blockers.push("Add exactly three complete hooks");
  if (!recommendation.caption.trim()) blockers.push("Caption is required");
  if (!recommendation.cta.trim()) blockers.push("CTA is required");
  if (recommendation.hashtags.length < 5 || recommendation.hashtags.length > 10) blockers.push("Use five to ten hashtags");
  if (!recommendation.imageGenerationPrompt.trim()) blockers.push("Visual prompt is required");
  if (!recommendation.altText.trim()) blockers.push("Alt text is required");
  if (recommendation.format === "CAROUSEL" && (recommendation.slides.length < 3 || recommendation.slides.length > 7 || recommendation.slides.some((slide) => !slide.headline.trim() || !slide.body.trim() || !slide.visualInstruction.trim() || !slide.imagePrompt.trim()))) {
    blockers.push("Carousel needs three to seven complete AI-directed slides");
  }
  if (recommendation.format === "STORY" && !recommendation.storyFrames.length) blockers.push("Story copy requires at least one frame");
  if (["REEL", "VIDEO_FEED"].includes(recommendation.format) && !recommendation.reelScenes.length) blockers.push("Video copy requires at least one scene");
  if (recommendation.format !== "CAROUSEL" && !recommendation.headline.trim() && !["REEL", "VIDEO_FEED", "STORY"].includes(recommendation.format)) blockers.push("On-post headline is required");
  if (/money|finance|invest|sip/i.test(recommendation.contentPillar) && !recommendation.financialDisclaimer.trim()) blockers.push("Financial content needs an educational disclaimer");
  if (/affiliate/i.test(recommendation.contentPillar) && !recommendation.affiliateDisclosure.trim()) blockers.push("Affiliate content needs a disclosure");
  if (/affiliate/i.test(recommendation.contentPillar) && (!recommendation.verifiedProductId.trim() || !recommendation.verifiedProductTitle.trim())) blockers.push("Affiliate content needs an exact verified catalog product");
  const completeCaption = recommendation.format === "STORY"
    ? ""
    : draft.captionContract?.caption ?? localCaptionFallback(recommendation);
  if (completeCaption.length > 2200) blockers.push("Complete Instagram caption must fit within 2,200 characters");
  if (/\b(current|latest|trend|news|rate|statistic|percent)\b|%/i.test(`${recommendation.whyToday} ${recommendation.caption}`) && !recommendation.sources.length) {
    blockers.push("Current or timely claims need a traceable source");
  }
  if (recommendation.recommendedLandingPage) {
    try {
      const appOrigin = typeof window === "undefined" ? "https://pinkpaisa.in" : window.location.origin;
      const url = new URL(recommendation.recommendedLandingPage, appOrigin);
      if (url.protocol !== "https:" && url.hostname !== "localhost") blockers.push("Landing page must use HTTPS");
      if (url.origin !== appOrigin) blockers.push("Landing page must be a Pink Paisa first-party destination");
    } catch {
      blockers.push("Landing page URL is invalid");
    }
  }
  return blockers;
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    {children}
    {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
  </div>
);

const GenerationControls = ({
  generating,
  generationEnabled,
  formatPreference,
  objectivePreference,
  visualMode,
  instructions,
  onFormatPreferenceChange,
  onObjectivePreferenceChange,
  onVisualModeChange,
  onInstructionsChange,
  onGenerate,
}: {
  generating: boolean;
  generationEnabled: boolean;
  formatPreference: SocialFormatPreference;
  objectivePreference: string;
  visualMode: SocialVisualMode;
  instructions: string;
  onFormatPreferenceChange: (value: SocialFormatPreference) => void;
  onObjectivePreferenceChange: (value: string) => void;
  onVisualModeChange: (value: SocialVisualMode) => void;
  onInstructionsChange: (value: string) => void;
  onGenerate: SocialTodayProps["onGenerate"];
}) => {
  const artworkEligibility = artworkOnlyEligibility({ format: formatPreference, objective: objectivePreference });
  const exactOverlayRequired = ["PRODUCT_FEATURE", "STORY"].includes(formatPreference);
  const effectiveVisualMode = exactOverlayRequired || (visualMode === "AI_ARTWORK_ONLY" && !artworkEligibility.eligible)
    ? "AI_VISUAL_WITH_EXACT_OVERLAY"
    : visualMode;
  const request = (generationType: SocialGenerationRequest["generation_type"], preference: SocialFormatPreference) => onGenerate({
    generation_type: generationType,
    requested_format: preference,
    ...(objectivePreference !== "AUTO_CHOOSE" ? { requested_post_type: objectivePreference } : {}),
    generation_scope: "FULL_POST",
    visual_mode: effectiveVisualMode,
    ...(instructions.trim() ? { admin_instructions: instructions.trim() } : {}),
  });

  return (
    <Card className="rounded-3xl border-primary/20 bg-primary/[0.03] shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="font-serif text-2xl">AI generation desk</CardTitle>
        <CardDescription>Auto Choose lets the AI select today’s strongest format. Forced formats trigger a fresh, format-appropriate strategy and copy package.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(180px,0.7fr)_minmax(180px,0.7fr)_minmax(0,1.4fr)]">
          <Field label="Format selector">
            <select value={formatPreference} onChange={(event) => onFormatPreferenceChange(event.target.value as SocialFormatPreference)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Objective" hint="Select an eligible objective before using artwork-only mode.">
            <select value={objectivePreference} onChange={(event) => onObjectivePreferenceChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Optional direction" hint="No private customer or vendor information.">
            <Input value={instructions} onChange={(event) => onInstructionsChange(event.target.value)} placeholder="Campaign priority, audience angle, or business goal" />
          </Field>
        </div>
        <details className="rounded-2xl border bg-background/70 p-4">
          <summary className="cursor-pointer text-sm font-medium">Advanced visual mode</summary>
          <div className="mt-3 max-w-md">
            <Field label="Visual treatment" hint={exactOverlayRequired ? "This format requires verified overlays." : !artworkEligibility.eligible ? artworkEligibility.message : "The complete AI-native graphic is the recommended default; no manual pixel overlay is added."}>
              <select value={effectiveVisualMode} onChange={(event) => onVisualModeChange(event.target.value as SocialVisualMode)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="AI_VISUAL_WITH_EXACT_OVERLAY">AI artwork + verified overlay — Required for protected formats</option>
                <option value="AI_ARTWORK_ONLY" disabled={!artworkEligibility.eligible}>AI artwork only — No overlay{!artworkEligibility.eligible ? " (not eligible yet)" : ""}</option>
                <option value="FULL_AI_GRAPHIC" disabled={exactOverlayRequired}>AI-native complete graphic — Recommended, no overlay</option>
              </select>
            </Field>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => request("TODAY", formatPreference)} disabled={generating || !generationEnabled}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />} Generate Today’s Post
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const GenerationRunPanel = ({ run, generating, onRetry }: { run: SocialGenerationRun | null; generating: boolean; onRetry: () => void }) => {
  if (!run) return null;
  const failed = ["FAILED", "FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_IMAGE", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION", "FAILED_PUBLISHING"].includes(run.status);
  const running = ["PENDING", "RUNNING"].includes(run.status);
  const visibleStage = failed && run.lastError?.stage ? run.lastError.stage : run.currentStage;
  const models = Array.from(new Set(run.stages.map((stage) => stage.model).filter(Boolean)));
  const prompts = Array.from(new Set(run.stages.map((stage) => stage.promptVersion).filter(Boolean)));
  const cost = run.usage.estimatedCost;
  return (
    <Card className={`rounded-3xl shadow-none ${failed ? "border-destructive/40" : running ? "border-primary/30" : "border-border"}`}>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">Generation run</CardTitle>
              <Badge variant={failed ? "destructive" : run.status === "SUCCEEDED" ? "default" : "secondary"}>{titleCase(run.status)}</Badge>
              {visibleStage ? <Badge variant="outline">{titleCase(visibleStage)}</Badge> : null}
            </div>
            <CardDescription className="mt-2">Run {run.id || "pending identifier"} · {run.triggerType ? titleCase(run.triggerType) : "Manual"}</CardDescription>
          </div>
          {failed ? <Button variant="outline" onClick={onRetry} disabled={generating}><RefreshCw className="h-4 w-4" /> Retry AI generation</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed ? (
          <Alert variant="destructive" className="rounded-2xl">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{run.status === "FAILED_COMPLIANCE"
              ? "AI compliance revisions were exhausted"
              : run.status === "FAILED_IMAGE_GENERATION"
                ? "AI image generation failed"
                : "AI generation failed"}</AlertTitle>
            <AlertDescription>{run.lastError?.message || "No completed draft was created. Review the stage details and retry with additional direction."}</AlertDescription>
          </Alert>
        ) : null}
        {failed && run.lastError?.details ? (
          <details className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-destructive">Failure details and exhausted attempts</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{JSON.stringify(run.lastError.details, null, 2)}</pre>
          </details>
        ) : null}
        <details className="rounded-2xl border border-border/70 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Advanced · models, prompts, cost and run history</summary>
          <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Attempts</p><p className="mt-1 font-semibold tabular-nums">{run.attemptCount}{run.maxAttempts ? ` / ${run.maxAttempts}` : ""}</p></div>
          <div className="rounded-xl bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Candidates</p><p className="mt-1 font-semibold tabular-nums">{run.candidateCount || run.candidates.length}</p></div>
          <div className="rounded-xl bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Token usage</p><p className="mt-1 font-semibold tabular-nums">{run.usage.totalTokens.toLocaleString("en-IN")}</p></div>
          <div className="rounded-xl bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Estimated API cost</p><p className="mt-1 font-semibold tabular-nums">{cost > 0 ? `${run.usage.costCurrency} ${cost.toFixed(4)}` : "Not available"}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.generationRequest ? <Badge variant="outline">Scope: {titleCase(run.generationRequest.generationScope)}</Badge> : null}
          {run.generationRequest ? <Badge variant="outline">Requested: {titleCase(run.generationRequest.requestedFormat)}</Badge> : null}
          {run.imageGenerationStatus && run.imageGenerationStatus !== "NOT_STARTED" ? <Badge variant="outline">Images: {titleCase(run.imageGenerationStatus)}</Badge> : null}
          {run.fullAiGeneration ? <Badge variant="secondary">Full AI</Badge> : null}
          {models.map((model) => <Badge key={model} variant="secondary">Model: {model}</Badge>)}
          {prompts.map((prompt) => <Badge key={prompt} variant="outline">Prompt: {prompt}</Badge>)}
          {run.retryCount ? <Badge variant="outline">{run.retryCount} retr{run.retryCount === 1 ? "y" : "ies"}</Badge> : null}
        </div>
        {run.candidates.length ? (
          <details open={failed} className="rounded-2xl border border-border/70 p-4">
            <summary className="cursor-pointer text-sm font-semibold">AI candidate ideas ({run.candidates.length})</summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {run.candidates.map((candidate, index) => (
                <div key={candidate.id || `${candidate.topic}-${index}`} className="rounded-xl bg-muted/35 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={candidate.disposition === "PRIMARY" ? "default" : "outline"}>{titleCase(candidate.disposition || `Candidate ${index + 1}`)}</Badge>
                    {candidate.format ? <Badge variant="secondary">{titleCase(candidate.format)}</Badge> : null}
                    {candidate.totalScore !== null ? <span className="ml-auto text-xs font-semibold">{Math.round(candidate.totalScore)}/100</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-medium">{candidate.topic || "Untitled candidate"}</p>
                  {candidate.whyToday ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{candidate.whyToday}</p> : null}
                  {candidate.rejectionReason ? <p className="mt-2 text-xs text-destructive">{candidate.rejectionReason}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {run.stages.length ? (
          <details className="rounded-2xl border border-border/70 p-4">
            <summary className="cursor-pointer text-sm font-semibold">Models, prompts, attempts and stage errors</summary>
            <div className="mt-4 space-y-2">
              {run.stages.map((stage, index) => (
                <div key={`${stage.stage}-${index}`} className="grid gap-2 rounded-xl bg-muted/35 p-3 text-xs md:grid-cols-[minmax(140px,1fr)_minmax(130px,1fr)_minmax(130px,1fr)_auto]">
                  <span className="font-medium">{titleCase(stage.stage || `Stage ${index + 1}`)} · {titleCase(stage.status || "unknown")}</span>
                  <span>{stage.model || "Model not recorded"}</span>
                  <span>{stage.promptVersion || "Prompt not recorded"}</span>
                  <span className="tabular-nums">Attempt {stage.attemptCount || 1}</span>
                  {stage.errorMessage ? <p className="text-destructive md:col-span-4">{stage.errorCode ? `${stage.errorCode}: ` : ""}{stage.errorMessage}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
          </div>
        </details>
      </CardContent>
    </Card>
  );
};

const CompliancePanel = ({ draft }: { draft: SocialDraft }) => {
  const compliance = draft.compliance || {};
  const aiReviewValue = compliance.ai_review || compliance.aiReview;
  const aiReview = aiReviewValue && typeof aiReviewValue === "object" && !Array.isArray(aiReviewValue)
    ? aiReviewValue as Record<string, unknown>
    : {};
  const decision = String(aiReview.decision || compliance.decision || compliance.status || (compliance.passed === true ? "PASS" : compliance.passed === false ? "REJECT" : "NOT_RECORDED")).toUpperCase();
  const issues = [aiReview.issues, aiReview.riskFlags, aiReview.unsupportedClaims, compliance.issues, compliance.risk_flags, compliance.riskFlags, compliance.unsupported_claims, compliance.unsupportedClaims]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => typeof value === "string" ? value : value && typeof value === "object" ? String((value as Record<string, unknown>).message || (value as Record<string, unknown>).code || "Compliance issue") : String(value));
  const revisions = [aiReview.requiredChanges, compliance.revision_instructions, compliance.revisionInstructions, compliance.required_changes, compliance.requiredChanges]
    .flatMap((value) => Array.isArray(value) ? value : typeof value === "string" ? [value] : []);
  const attempts = Number(compliance.attempt_count || compliance.attemptCount || compliance.revision_attempts || compliance.revisionAttempts || 0);
  const passed = decision === "PASS";
  return (
    <Card className="rounded-3xl shadow-none">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><CardTitle className="text-lg">AI compliance review</CardTitle><CardDescription>Independent review outcome and concise revision guidance.</CardDescription></div>
          <Badge variant={passed ? "default" : decision === "NOT_RECORDED" ? "outline" : "destructive"}>{titleCase(decision)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {attempts ? <Badge variant="outline">{attempts} review attempt{attempts === 1 ? "" : "s"}</Badge> : null}
          {compliance.model ? <Badge variant="secondary">Model: {String(compliance.model)}</Badge> : null}
          {compliance.prompt_version || compliance.promptVersion ? <Badge variant="outline">Prompt: {String(compliance.prompt_version || compliance.promptVersion)}</Badge> : null}
        </div>
        {issues.length ? <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-destructive">Issues</p><ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></div> : null}
        {revisions.length ? <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Revision instructions</p><ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{revisions.map((instruction, index) => <li key={`${instruction}-${index}`}>{String(instruction)}</li>)}</ul></div> : null}
        {aiReview.conciseRationale ? <p className="text-sm leading-6 text-muted-foreground">{String(aiReview.conciseRationale)}</p> : null}
        {!issues.length && passed ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> The current package passed the stored AI compliance review.</p> : null}
        {decision === "NOT_RECORDED" ? <p className="text-sm text-muted-foreground">No compliance result was returned for this revision. Run compliance before approval.</p> : null}
      </CardContent>
    </Card>
  );
};

const ScoreCard = ({ recommendation }: { recommendation: SocialRecommendation }) => {
  const score = totalScore(recommendation);
  const scoreEntries = Object.entries(recommendation.scoreBreakdown).filter(([key]) => !["total", "total_score", "final_score"].includes(key));
  return (
    <Card className="rounded-2xl border-border/70 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Decision score</CardTitle>
        <CardDescription>A concise business score, not hidden model reasoning.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="text-3xl font-semibold tabular-nums">{score === null ? "—" : Math.round(score)}</span>
            <span className="ml-1 text-sm text-muted-foreground">/ 100</span>
          </div>
          <Badge variant="outline">{formatConfidence(recommendation.confidence)} confidence</Badge>
        </div>
        <Progress value={score === null ? 0 : Math.max(0, Math.min(100, score))} className="h-2" />
        {scoreEntries.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {scoreEntries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{titleCase(key)}</span>
                <span className="font-semibold tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A breakdown will appear after a scored generation.</p>
        )}
      </CardContent>
    </Card>
  );
};

const ReadinessNotice = ({ readiness }: { readiness: SocialReadiness }) => {
  const draftOnly = !readiness.publishingEnabled || !readiness.instagramConnected;
  if (!readiness.blockers.length && !readiness.warnings.length && !draftOnly) return null;
  return (
    <Alert className="rounded-2xl border-amber-200 bg-amber-50/70 text-amber-950">
      <ShieldAlert className="h-4 w-4 text-amber-700" />
      <AlertTitle>{draftOnly ? "Draft-first mode is active" : "Readiness checks need attention"}</AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        {draftOnly ? (
          <p>
            You can generate, edit, review and export safely. Publishing stays unavailable until the publishing flag and Instagram connection are ready.
          </p>
        ) : null}
        {[...readiness.blockers, ...readiness.warnings].length ? (
          <ul className="list-disc space-y-1 pl-4">
            {[...readiness.blockers, ...readiness.warnings].map((blocker, index) => <li key={`${blocker}-${index}`}>{blocker}</li>)}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Badge variant="outline" className="border-amber-300">Research: {readiness.researchMode || "evergreen"}</Badge>
          <Badge variant="outline" className="border-amber-300">AI {readiness.aiConfigured ? "configured" : "required but not configured"}</Badge>
          <Badge variant="outline" className="border-amber-300">Instagram {readiness.instagramConnected ? "connected" : "not connected"}</Badge>
        </div>
      </AlertDescription>
    </Alert>
  );
};

const RecommendationSummary = ({ draft }: { draft: SocialDraft }) => {
  const recommendation = draft.primary;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
      <Card className="overflow-hidden rounded-3xl border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1.5"><Sparkles className="h-3 w-3" /> Primary recommendation</Badge>
            <StatusBadge status={draft.status.toLowerCase()} />
            {draft.revision !== null ? <Badge variant="outline">Revision {draft.revision}</Badge> : null}
          </div>
          <CardTitle className="pt-2 font-serif text-2xl leading-tight sm:text-3xl">
            {recommendation.internalTitle || recommendation.topic || "Today’s recommendation"}
          </CardTitle>
          <CardDescription className="text-sm">For {formatDate(draft.generationDate)} · {draft.timezone}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-primary/15 bg-background/75 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Why today?</p>
            <p className="leading-7">{recommendation.whyToday || "The generation will include a concise, evidence-backed reason for choosing this topic today."}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Objective", recommendation.objective],
              ["Format", recommendation.format],
              ["Content pillar", recommendation.contentPillar],
              ["Audience", recommendation.targetAudienceSegment],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border/60 bg-card/70 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                <p className="mt-1 text-sm font-medium">{value ? titleCase(value) : "Not set"}</p>
              </div>
            ))}
          </div>
          {recommendation.formatReason ? (
            <div className="rounded-xl border border-border/60 bg-card/70 p-3 text-sm">
              <span className="font-semibold">Why this format:</span> {recommendation.formatReason}
              {recommendation.postType ? <Badge variant="outline" className="ml-2">{titleCase(recommendation.postType)}</Badge> : null}
            </div>
          ) : null}
          {recommendation.verifiedProductTitle ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900">
              <span className="font-semibold">Verified catalog product:</span> {recommendation.verifiedProductTitle}
              <span className="ml-2 text-xs text-emerald-700">ID {recommendation.verifiedProductId}</span>
            </div>
          ) : null}
          {recommendation.riskFlags.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Risk flags</p>
              <div className="flex flex-wrap gap-2">
                {recommendation.riskFlags.map((risk) => <Badge key={risk} variant="destructive" className="font-medium">{risk}</Badge>)}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> No unresolved risk flags were returned.
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Supporting evidence</p>
            {recommendation.sources.length ? (
              <div className="flex flex-wrap gap-2">
                {recommendation.sources.slice(0, 3).map((source, index) => source.url ? (
                  <a key={source.id || `${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs transition hover:border-primary/40 hover:text-primary">
                    <ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{source.title}</span>
                  </a>
                ) : <Badge key={source.id || `${source.title}-${index}`} variant="outline">{source.title}</Badge>)}
                {recommendation.sources.length > 3 ? <Badge variant="secondary">+{recommendation.sources.length - 3} more in Research</Badge> : null}
              </div>
            ) : <p className="text-xs text-muted-foreground">No traceable sources are attached to this recommendation yet.</p>}
          </div>
        </CardContent>
      </Card>
      <ScoreCard recommendation={recommendation} />
    </div>
  );
};

const CreativePreview = ({
  draft,
  onExport,
  onAction,
  showProvenance = true,
  compactReview = false,
  mediaSupplement = null,
  readOnly = false,
}: {
  draft: SocialDraft;
  onExport: () => void;
  onAction: SocialTodayProps["onAction"];
  showProvenance?: boolean;
  compactReview?: boolean;
  mediaSupplement?: ReactNode;
  readOnly?: boolean;
}) => {
  const recommendation = draft.primary;
  const originalAsset = draft.assets.find((asset) => asset.originalUrl || asset.role.toUpperCase().includes("ORIGINAL"));
  const finalAssets = draft.assets
    .filter(isReviewableMediaAsset)
    .sort((left, right) => Number(isVideoAsset(right)) - Number(isVideoAsset(left)) || (left.slideNumber || 0) - (right.slideNumber || 0));
  const videoFormat = ["REEL", "VIDEO_FEED"].includes(String(recommendation.format).toUpperCase());
  const previewAsset = (videoFormat ? finalAssets.find(isVideoAsset) : null) || finalAssets[0] || draft.assets.find((asset) => asset.previewUrl || asset.url);
  const originalUrl = originalAsset?.originalUrl || (originalAsset?.role.toUpperCase().includes("ORIGINAL") ? originalAsset.url : "") || previewAsset?.originalUrl || "";
  const finalUrl = previewAsset?.finalUrl || previewAsset?.previewUrl || previewAsset?.url || "";
  const verticalMedia = videoFormat || String(recommendation.format).toUpperCase() === "STORY" || previewAsset?.aspectRatio === "9:16";
  const landingUrl = appendUtm(recommendation.recommendedLandingPage, recommendation.utmParameters);
  const storyMode = String(recommendation.format).toUpperCase() === "STORY";
  const completedCaption = storyMode
    ? [
      draft.captionContract?.components.affiliateDisclosure ?? recommendation.affiliateDisclosure,
      draft.captionContract?.components.cta ?? recommendation.cta,
      draft.captionContract?.components.financialDisclaimer ?? recommendation.financialDisclaimer,
    ].map((value) => value.trim()).filter(Boolean).join("\n\n")
    : draft.captionContract?.caption ?? localCaptionFallback(recommendation);
  const visualMode = String(draft.visualMode || previewAsset?.visualMode || "AI_VISUAL_WITH_EXACT_OVERLAY").toUpperCase();
  const aiNativeFullGraphic = visualMode === "FULL_AI_GRAPHIC" && isAiNativeFullGraphicAsset(previewAsset);
  const finalCreativeLabel = visualMode === "AI_ARTWORK_ONLY"
    ? "Normalized final · no overlay"
    : visualMode === "FULL_AI_GRAPHIC"
      ? aiNativeFullGraphic ? AI_NATIVE_FULL_GRAPHIC_LABEL : "AI-rendered headline · branded finish"
      : visualMode === "MANUAL_TEMPLATE"
        ? "Legacy manual-template creative"
        : "Final creative · verified text overlay";
  const visualDescription = visualMode === "AI_ARTWORK_ONLY"
    ? "The OpenAI original is retained; the final asset is crop/resize/encoding only, with no composited text or branding."
    : visualMode === "FULL_AI_GRAPHIC"
      ? aiNativeFullGraphic
        ? "The complete artwork and approved text are baked into the validated OpenAI image; no programmatic pixel overlay or logo composite is applied."
        : "The headline is rendered by AI and validated; only the branded finish is composited afterward."
      : visualMode === "MANUAL_TEMPLATE"
        ? "This historical asset used the retired manual-template pipeline and remains readable for compatibility."
        : "The OpenAI original is retained separately from the exact programmatic headline, supporting copy and brand overlay.";
  const visualProvenanceLabel = visualMode === "AI_ARTWORK_ONLY"
    ? "Artwork · AI — No overlay"
    : visualMode === "FULL_AI_GRAPHIC"
      ? aiNativeFullGraphic ? AI_NATIVE_FULL_GRAPHIC_LABEL : "Headline · AI-rendered and validated"
      : visualMode === "MANUAL_TEMPLATE"
        ? "Legacy · Manual template"
        : "Text · Verified overlay";
  const regenerationAllowed = ["DRAFT", "REJECTED", "NEEDS_REVIEW", "APPROVED"].includes(String(draft.status).toUpperCase());

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(completedCaption);
      toast.success("Caption package copied");
    } catch {
      toast.error("Could not copy the caption");
    }
  };

  return (
    <div className="space-y-4">
      <section aria-label="Final media review" className={mediaSupplement ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]" : "space-y-4"}>
      <Card className="rounded-3xl shadow-none">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">{compactReview ? "Final creative" : "AI artwork and final creative"}</CardTitle>
            <CardDescription>{visualDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {previewAsset ? <Badge variant={previewAsset.status.toLowerCase() === "valid" ? "default" : "secondary"}>{titleCase(previewAsset.status)}</Badge> : null}
            <Badge variant="outline">{previewAsset?.aspectRatio || recommendation.visualConcept.aspect_ratio || recommendation.visualConcept.aspectRatio || "4:5"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {originalUrl || finalUrl ? (
            compactReview ? <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{finalCreativeLabel}</p>{previewAsset ? <Badge variant={previewAsset.status.toLowerCase() === "valid" ? "default" : "secondary"}>{titleCase(previewAsset.status)}</Badge> : null}</div>
                <div className={`${verticalMedia ? "mx-auto aspect-[9/16] max-h-[70vh] max-w-md" : "mx-auto aspect-[4/5] max-h-[70vh] max-w-2xl"} overflow-hidden rounded-2xl border border-border bg-muted/30`}>
                  {finalUrl ? isVideoAsset(previewAsset) ? <video src={finalUrl} controls playsInline preload="metadata" aria-label={recommendation.altText || "Final Pink Paisa Instagram video"} className="h-full w-full bg-black object-contain" /> : <img src={finalUrl} alt={recommendation.altText || "Final Pink Paisa Instagram creative"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Final creative processing has not completed.</div>}
                </div>
              </div>
              {originalUrl ? <details className="rounded-xl border border-border/70 p-3 text-xs"><summary className="cursor-pointer font-medium text-primary">Advanced · original AI-generated visual</summary><div className={`${verticalMedia ? "aspect-[9/16]" : "aspect-[4/5]"} mx-auto mt-3 max-w-xs overflow-hidden rounded-2xl border border-border bg-muted/30`}><img src={originalUrl} alt={`${recommendation.altText || "Pink Paisa creative"} — original AI visual`} className="h-full w-full object-cover" /></div></details> : null}
            </div> : <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Original AI-generated visual</p>{originalAsset?.generationStatus ? <Badge variant="outline">{titleCase(originalAsset.generationStatus)}</Badge> : null}</div>
                <div className={`${verticalMedia ? "aspect-[9/16]" : "aspect-[4/5]"} overflow-hidden rounded-2xl border border-border bg-muted/30`}>
                  {originalUrl ? <img src={originalUrl} alt={`${recommendation.altText || "Pink Paisa creative"} — original AI visual`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Original visual URL was not returned. Regenerate the image before approval.</div>}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{finalCreativeLabel}</p>{previewAsset ? <Badge variant={previewAsset.status.toLowerCase() === "valid" ? "default" : "secondary"}>{titleCase(previewAsset.status)}</Badge> : null}</div>
                <div className={`${verticalMedia ? "aspect-[9/16]" : "aspect-[4/5]"} overflow-hidden rounded-2xl border border-border bg-muted/30`}>
                  {finalUrl ? isVideoAsset(previewAsset) ? <video src={finalUrl} controls playsInline preload="metadata" aria-label={recommendation.altText || "Final Pink Paisa Instagram video"} className="h-full w-full bg-black object-contain" /> : <img src={finalUrl} alt={recommendation.altText || "Final Pink Paisa Instagram creative"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Final creative processing has not completed.</div>}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No AI visual has been generated</p>
              <p className="mt-1 text-sm text-muted-foreground">Use Regenerate Image after the copy passes compliance. Template-only artwork is not shown as a completed creative.</p>
            </div>
          )}
          {finalAssets.length > 1 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Final asset set ({finalAssets.length})</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {finalAssets.map((asset, index) => <div key={asset.id || `${asset.url}-${index}`} className="space-y-1"><div className={`${isVideoAsset(asset) || asset.aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-[4/5]"} overflow-hidden rounded-xl border border-border`}>{isVideoAsset(asset) ? <video src={asset.finalUrl || asset.previewUrl || asset.url} controls playsInline preload="metadata" aria-label={`${recommendation.altText || "Generated video"} ${index + 1}`} className="h-full w-full bg-black object-contain" /> : <img src={asset.finalUrl || asset.previewUrl || asset.url} alt={`${recommendation.altText || "Generated creative"} ${index + 1}`} className="h-full w-full object-cover" />}</div><p className="text-center text-[10px] text-muted-foreground">{isVideoAsset(asset) ? "Final video" : asset.slideNumber ? `Slide ${asset.slideNumber}` : `Asset ${index + 1}`}</p></div>)}
              </div>
              {recommendation.format === "CAROUSEL" && regenerationAllowed ? <details className="mt-3 rounded-xl border border-border/70 p-3 text-xs"><summary className="cursor-pointer font-medium text-primary">Advanced · regenerate one slide</summary><div className="mt-3 flex flex-wrap gap-2">{finalAssets.map((asset, index) => <Button key={asset.id || index} type="button" size="sm" variant="outline" onClick={() => onAction("regenerate", { scope: "image", asset_sequence: asset.slideNumber || index + 1, visual_mode: requestVisualMode(draft.visualMode) })}>Slide {asset.slideNumber || index + 1}</Button>)}</div></details> : null}
            </div>
          ) : null}
          {showProvenance && (previewAsset?.provider || previewAsset?.model || previewAsset?.sourceProvenance || previewAsset?.prompt || recommendation.imageGenerationPrompt) ? <details className="rounded-xl border border-border/70 p-3 text-xs"><summary className="cursor-pointer font-medium text-primary">Advanced · AI provenance and prompt</summary><div className="mt-3 flex flex-wrap gap-2">{previewAsset?.provider ? <Badge variant="secondary">Artwork · AI — {previewAsset.provider}{previewAsset.model ? `/${previewAsset.model}` : ""}</Badge> : null}<Badge variant="outline">{visualProvenanceLabel}</Badge>{previewAsset?.sourceProvenance ? <Badge variant="outline">{titleCase(previewAsset.sourceProvenance)}</Badge> : null}{previewAsset?.generationAttempts ? <Badge variant="outline">{previewAsset.generationAttempts} image attempt{previewAsset.generationAttempts === 1 ? "" : "s"}</Badge> : null}</div>{previewAsset?.prompt || recommendation.imageGenerationPrompt ? <p className="mt-3 whitespace-pre-wrap leading-5 text-muted-foreground">{previewAsset?.prompt || recommendation.imageGenerationPrompt}</p> : null}</details> : null}
          {previewAsset?.validationFlags.length ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Visual review still has {previewAsset.validationFlags.length} flag(s)</p>
              <p className="mt-1 text-xs">{previewAsset.validationFlags.join(" · ")}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {mediaSupplement}
      </section>

      <Card className="rounded-3xl shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{storyMode ? "Story text package" : "Complete Instagram caption"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm leading-6">{completedCaption || "Caption copy will appear here."}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{storyMode ? <><Badge variant="outline">Story on-frame policy</Badge><span>Affiliate disclosure on first frame → CTA and general disclaimer on final frame; Stories publish without a caption.</span></> : <><Badge variant="outline">Caption-only policy</Badge><span>Affiliate disclosure → Caption → CTA → Financial disclaimer → Hashtags</span><span className="ml-auto tabular-nums">{draft.captionContract?.length ?? completedCaption.length} / 2,200</span></>}</div>
          {landingUrl ? (
            <a href={landingUrl} target="_blank" rel="noreferrer" className="flex items-start gap-2 break-all rounded-xl border border-border/60 p-3 text-xs text-primary hover:bg-accent">
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {landingUrl}
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">No landing page is attached to this post.</p>
          )}
          {!readOnly ? <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void copyCaption()}><Clipboard className="h-4 w-4" /> Copy package</Button>
            <Button variant="outline" onClick={onExport}><Download className="h-4 w-4" /> Export JSON</Button>
          </div> : null}
        </CardContent>
      </Card>
    </div>
  );
};

const CreativeProvenancePanel = ({ draft }: { draft: SocialDraft }) => {
  const asset = draft.assets
    .filter((item) => !item.role.toUpperCase().includes("ORIGINAL"))
    .sort((left, right) => (left.slideNumber || 0) - (right.slideNumber || 0))[0]
    || draft.assets[0];
  const mode = String(draft.visualMode || asset?.visualMode || "AI_VISUAL_WITH_EXACT_OVERLAY").toUpperCase();
  const aiNativeFullGraphic = mode === "FULL_AI_GRAPHIC" && isAiNativeFullGraphicAsset(asset);
  const visualProvenanceLabel = mode === "AI_ARTWORK_ONLY"
    ? "Artwork · AI — No overlay"
    : mode === "FULL_AI_GRAPHIC"
      ? aiNativeFullGraphic ? AI_NATIVE_FULL_GRAPHIC_LABEL : "Headline · AI-rendered and validated"
      : mode === "MANUAL_TEMPLATE"
        ? "Legacy · Manual template"
        : "Text · Verified overlay";
  const prompt = asset?.prompt || draft.primary.imageGenerationPrompt;
  return (
    <details className="rounded-3xl border border-border bg-card p-5">
      <summary className="cursor-pointer text-sm font-semibold">Advanced · AI provenance and prompt</summary>
      <div className="mt-4 space-y-3 text-xs">
        <div className="flex flex-wrap gap-2">
          {asset?.provider ? <Badge variant="secondary">Artwork · AI — {asset.provider}{asset.model ? `/${asset.model}` : ""}</Badge> : null}
          <Badge variant="outline">{visualProvenanceLabel}</Badge>
          {draft.primary.verifiedProductId ? <Badge variant="outline">Product · Authentic catalogue image</Badge> : null}
          {["REEL", "VIDEO_FEED"].includes(String(draft.primary.format).toUpperCase()) ? <Badge variant="outline">Video · FFmpeg assembled</Badge> : null}
          {asset?.sourceProvenance ? <Badge variant="outline">{titleCase(asset.sourceProvenance)}</Badge> : null}
          {asset?.renderer ? <Badge variant="outline">Renderer · {titleCase(asset.renderer)}</Badge> : null}
          {asset?.generationAttempts ? <Badge variant="outline">{asset.generationAttempts} image attempt{asset.generationAttempts === 1 ? "" : "s"}</Badge> : null}
        </div>
        {prompt ? <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 leading-5 text-muted-foreground">{prompt}</p> : <p className="text-muted-foreground">No image prompt was returned for this historical asset.</p>}
      </div>
    </details>
  );
};

const ContentEditor = ({
  draft,
  onChange,
  onScheduleChange,
  scheduleEditable = true,
}: {
  draft: SocialDraft;
  onChange: (next: SocialRecommendation) => void;
  onScheduleChange: (value: string) => void;
  scheduleEditable?: boolean;
}) => {
  const recommendation = draft.primary;
  const patch = (changes: Partial<SocialRecommendation>) => onChange({ ...recommendation, ...changes });
  const updateHook = (index: number, value: string) => {
    const hooks = Array.from({ length: Math.max(3, recommendation.hooks.length) }, (_, hookIndex) => recommendation.hooks[hookIndex] || "");
    hooks[index] = value;
    patch({ hooks });
  };
  const updateSlide = (index: number, changes: Partial<SocialSlide>) => {
    const slides = recommendation.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...changes } : slide);
    patch({ slides });
  };
  const removeSlide = (index: number) => {
    const slides = recommendation.slides.filter((_, slideIndex) => slideIndex !== index)
      .map((slide, slideIndex) => ({ ...slide, slideNumber: slideIndex + 1 }));
    patch({ slides });
  };
  const addSlide = () => patch({
    slides: [...recommendation.slides, {
      slideNumber: recommendation.slides.length + 1,
      headline: "",
      body: "",
      visualInstruction: "",
      imagePrompt: "",
      overlayInstructions: "",
    }],
  });
  const visualDirection = Object.entries(recommendation.visualConcept)
    .map(([key, value]) => `${titleCase(key.replace(/([a-z])([A-Z])/g, "$1_$2"))}: ${value}`)
    .join("\n");
  const setVisualDirection = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = Object.fromEntries(event.target.value.split("\n").map((line) => {
      const [key, ...rest] = line.split(":");
      const parts = key?.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) || [];
      const camelKey = parts.map((part, partIndex) => partIndex ? `${part[0]?.toUpperCase() || ""}${part.slice(1)}` : part).join("");
      return [camelKey || "direction", rest.join(":").trim()];
    }).filter(([, value]) => value));
    patch({ visualConcept: next });
  };
  const overlayDirection = Object.entries(recommendation.overlayInstructions)
    .map(([key, value]) => `${titleCase(key.replace(/([a-z])([A-Z])/g, "$1_$2"))}: ${value}`)
    .join("\n");
  const setOverlayDirection = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = Object.fromEntries(event.target.value.split("\n").map((line) => {
      const [key, ...rest] = line.split(":");
      const parts = key?.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) || [];
      const camelKey = parts.map((part, partIndex) => partIndex ? `${part[0]?.toUpperCase() || ""}${part.slice(1)}` : part).join("");
      return [camelKey || "instruction", rest.join(":").trim()];
    }).filter(([, value]) => value));
    patch({ overlayInstructions: next });
  };

  return (
    <Card className="rounded-3xl shadow-none">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-2xl">Content editor</CardTitle>
            <CardDescription>Edit the complete package. Changes remain local until you save.</CardDescription>
          </div>
          <Badge variant="outline" className="hidden sm:inline-flex">Editable draft</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-7">
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <MessageSquareText className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Strategy and hook</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Internal title"><Input value={recommendation.internalTitle} onChange={(event) => patch({ internalTitle: event.target.value })} /></Field>
            <Field label="Topic"><Input value={recommendation.topic} onChange={(event) => patch({ topic: event.target.value })} /></Field>
            <Field label="Objective">
              <select value={recommendation.objective} onChange={(event) => patch({ objective: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {["AWARENESS", "EDUCATION", "ENGAGEMENT", "TRAFFIC", "LEADS", "PRODUCT_PROMOTION", "COMMUNITY_BUILDING"].map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="AI-selected format" hint="Use “Change Format With AI” below so strategy and copy are rewritten together.">
              <Input value={recommendation.format ? titleCase(recommendation.format) : "Format not returned"} disabled />
            </Field>
            <Field label="Content pillar">
              <select value={recommendation.contentPillar} onChange={(event) => patch({ contentPillar: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {["Money Education", "Money Psychology", "Wealth and Wellness", "Relatable Money Moments", "Interactive", "Pink Paisa Resources", "Curated Wellness and Affiliate Products"].map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="Audience segment"><Input value={recommendation.targetAudienceSegment} onChange={(event) => patch({ targetAudienceSegment: event.target.value })} /></Field>
          </div>
          {recommendation.verifiedProductTitle ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900">
              Affiliate identity is locked to <span className="font-semibold">{recommendation.verifiedProductTitle}</span> ({recommendation.verifiedProductId}). The server rechecks active status, compliance, rights, and landing page before publishing.
            </div>
          ) : null}
          <Field label="Why today?" hint="Keep this concise and evidence-led; do not expose private model reasoning.">
            <Textarea rows={3} value={recommendation.whyToday} onChange={(event) => patch({ whyToday: event.target.value })} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Why this format?" hint="Concise AI rationale for the selected medium."><Textarea rows={3} value={recommendation.formatReason} onChange={(event) => patch({ formatReason: event.target.value })} /></Field>
            <Field label="Post type"><Input value={recommendation.postType} onChange={(event) => patch({ postType: event.target.value })} placeholder="AWARENESS, PRODUCT, QUIZ…" /></Field>
          </div>
          <div className="grid gap-3">
            {(recommendation.hooks.length ? recommendation.hooks : ["", "", ""]).slice(0, 3).map((hook, index) => (
              <Field key={index} label={`Hook ${index + 1}`}>
                <Input value={hook} onChange={(event) => updateHook(index, event.target.value)} placeholder="Understandable in about three seconds" />
              </Field>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Layers3 className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">On-post copy</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Headline"><Input value={recommendation.headline} onChange={(event) => patch({ headline: event.target.value })} /></Field>
            <Field label="Supporting copy"><Input value={recommendation.supportingCopy} onChange={(event) => patch({ supportingCopy: event.target.value })} /></Field>
          </div>
          {recommendation.format === "CAROUSEL" ? (
            <div className="space-y-3">
              {recommendation.slides.map((slide, index) => (
                <div key={`${slide.slideNumber}-${index}`} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="font-medium">Slide {index + 1}</p>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove slide ${index + 1}`} onClick={() => removeSlide(index)} disabled={recommendation.slides.length <= 3}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    <Input value={slide.headline} onChange={(event) => updateSlide(index, { headline: event.target.value })} placeholder="Slide headline" />
                    <Textarea rows={3} value={slide.body} onChange={(event) => updateSlide(index, { body: event.target.value })} placeholder="Exact slide copy" />
                    <Input value={slide.visualInstruction} onChange={(event) => updateSlide(index, { visualInstruction: event.target.value })} placeholder="Visual instruction" />
                    <Textarea rows={2} value={slide.imagePrompt} onChange={(event) => updateSlide(index, { imagePrompt: event.target.value })} placeholder="AI image prompt for this slide" />
                    <Input value={slide.overlayInstructions} onChange={(event) => updateSlide(index, { overlayInstructions: event.target.value })} placeholder="Exact overlay instructions" />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addSlide} disabled={recommendation.slides.length >= 7}><Plus className="h-4 w-4" /> Add slide</Button>
            </div>
          ) : null}
          {recommendation.format === "STORY" && recommendation.storyFrames.length ? <div className="space-y-2">{recommendation.storyFrames.map((frame, index) => <pre key={index} className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-xs">{JSON.stringify(frame, null, 2)}</pre>)}</div> : null}
          {["REEL", "VIDEO_FEED"].includes(recommendation.format) && recommendation.reelScenes.length ? <div className="space-y-2">{recommendation.reelScenes.map((scene, index) => <pre key={index} className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-xs">{JSON.stringify(scene, null, 2)}</pre>)}</div> : null}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Send className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Caption and destination</h3>
          </div>
          <Field label="Caption"><Textarea rows={9} value={recommendation.caption} onChange={(event) => patch({ caption: event.target.value })} /></Field>
          <Field label="CTA"><Input value={recommendation.cta} onChange={(event) => patch({ cta: event.target.value })} /></Field>
          <Field label="Hashtags" hint="Five to ten relevant hashtags, separated by commas.">
            <Input value={recommendation.hashtags.join(", ")} onChange={(event) => patch({ hashtags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Financial disclaimer"><Textarea rows={2} value={recommendation.financialDisclaimer} onChange={(event) => patch({ financialDisclaimer: event.target.value })} /></Field>
          <Field label="Affiliate disclosure"><Textarea rows={2} value={recommendation.affiliateDisclosure} onChange={(event) => patch({ affiliateDisclosure: event.target.value })} /></Field>
          <Field label="Landing page"><Input type="url" value={recommendation.recommendedLandingPage} onChange={(event) => patch({ recommendedLandingPage: event.target.value })} placeholder="https://pinkpaisa.in/..." /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["source", "medium", "campaign", "content"] as const).map((key) => (
              <Field key={key} label={`UTM ${key}`}>
                <Input value={recommendation.utmParameters[key]} onChange={(event) => patch({ utmParameters: { ...recommendation.utmParameters, [key]: event.target.value } })} />
              </Field>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Creative direction and timing</h3>
          </div>
          <Field label="Visual direction" hint="One “Label: direction” per line.">
            <Textarea rows={5} value={visualDirection} onChange={setVisualDirection} />
          </Field>
          <Field label="Image generation prompt" hint="Describe the text-free base image. Exact written copy is overlaid separately.">
            <Textarea rows={5} value={recommendation.imageGenerationPrompt} onChange={(event) => patch({ imageGenerationPrompt: event.target.value })} />
          </Field>
          <Field label="Elements the image model must avoid" hint="One prohibited element per line.">
            <Textarea rows={4} value={recommendation.negativeVisualInstructions.join("\n")} onChange={(event) => patch({ negativeVisualInstructions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Exact overlay instructions" hint="One “Placement: instruction” per line. These are applied after the AI creates the original visual.">
            <Textarea rows={4} value={overlayDirection} onChange={setOverlayDirection} />
          </Field>
          <Field label="Alt text"><Textarea rows={3} value={recommendation.altText} onChange={(event) => patch({ altText: event.target.value })} /></Field>
          {scheduleEditable ? <Field label="Posting date and time" hint={`${draft.timezone}. Scheduling is accepted only after approval.`}>
            <Input type="datetime-local" value={toDateTimeLocal(draft.scheduledFor)} onChange={(event) => onScheduleChange(event.target.value)} />
          </Field> : null}
        </section>
      </CardContent>
    </Card>
  );
};

const AlternativeIdeas = ({ draft, onAdopt }: { draft: SocialDraft; onAdopt: (index: number) => void }) => (
  <Card className="rounded-3xl shadow-none">
    <CardHeader>
      <CardTitle className="font-serif text-2xl">Two strong alternatives</CardTitle>
      <CardDescription>Useful backup angles, ranked behind today’s primary recommendation.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 lg:grid-cols-2">
      {draft.alternatives.slice(0, 2).map((alternative, index) => (
        <div key={alternative.id || `${alternative.topic}-${index}`} className="flex flex-col rounded-2xl border border-border/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline">Alternative {index + 1}</Badge>
            <span className="text-sm font-semibold tabular-nums">{totalScore(alternative) === null ? "Not scored" : `${Math.round(totalScore(alternative) || 0)}/100`}</span>
          </div>
          <h3 className="mt-4 font-serif text-xl">{alternative.internalTitle || alternative.topic || "Alternative idea"}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{alternative.whyToday || alternative.rationale || "No selection rationale returned."}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{titleCase(alternative.format)}</Badge>
            <Badge variant="secondary">{alternative.contentPillar || "Unassigned pillar"}</Badge>
            <Badge variant="secondary">{formatConfidence(alternative.confidence)}</Badge>
          </div>
          <Button type="button" variant="outline" className="mt-5" onClick={() => onAdopt(index)}>
            <ArrowUpRight className="h-4 w-4" /> Use as editable draft
          </Button>
        </div>
      ))}
      {!draft.alternatives.length ? (
        <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Alternatives were not included in this draft. Regenerate alternatives to add two backup ideas.
        </div>
      ) : null}
    </CardContent>
  </Card>
);

const LifecycleActions = ({
  draft,
  readiness,
  dirty,
  busyAction,
  onSave,
  onAction,
  generationRun,
  weeklyLinked = false,
  companionStoryReady = true,
}: {
  draft: SocialDraft;
  readiness: SocialReadiness;
  dirty: boolean;
  busyAction: string;
  onSave: () => void;
  onAction: SocialTodayProps["onAction"];
  generationRun: SocialGenerationRun | null;
  weeklyLinked?: boolean;
  companionStoryReady?: boolean;
}) => {
  const [scheduleOverrideOpen, setScheduleOverrideOpen] = useState(false);
  const [scheduleOverrideReason, setScheduleOverrideReason] = useState("");
  const [scheduleOverrideFor, setScheduleOverrideFor] = useState(draft.scheduledFor);
  useEffect(() => {
    setScheduleOverrideOpen(false);
    setScheduleOverrideReason("");
    setScheduleOverrideFor(draft.scheduledFor);
  }, [draft.id, draft.scheduledFor]);
  const status = draft.status;
  const working = Boolean(busyAction);
  const contentBlockers = editorialBlockers(draft);
  const compliancePassed = draft.compliance?.passed === true || String(draft.compliance?.decision || draft.compliance?.status || "").toUpperCase() === "PASS";
  const hasOriginalAiVisual = draft.assets.some((asset) => Boolean(asset.originalUrl) || asset.role.toUpperCase().includes("ORIGINAL") || ["generated", "generated_from_approved_source", "generated_without_reference"].includes(asset.sourceProvenance.toLowerCase()));
  const hasFinalMedia = draft.assets.some((asset) => !asset.role.toUpperCase().includes("ORIGINAL") && Boolean(asset.finalUrl || asset.url));
  const artworkEligibility = artworkOnlyEligibility({
    format: draft.primary.format,
    objective: draft.primary.objective,
    postType: draft.primary.postType,
    contentPillar: draft.primary.contentPillar,
    verifiedProductId: draft.primary.verifiedProductId,
  });
  const creativeBlockers = [
    ...(!draft.assets.length || !hasFinalMedia ? ["A validated final creative asset is required"] : []),
    ...(!hasOriginalAiVisual ? ["Traceable original AI artwork is required"] : []),
    ...(draft.assets.some((asset) => asset.status.toLowerCase() === "invalid") ? ["A creative asset failed validation"] : []),
    ...(draft.assets.some((asset) => asset.manualReviewStatus.toLowerCase() === "rejected") ? ["A creative asset was rejected during visual review"] : []),
    ...(draft.visualMode === "AI_ARTWORK_ONLY" && !artworkEligibility.eligible ? [artworkEligibility.message || "Artwork-only is not eligible for this draft"] : []),
  ];
  const approvalBlockers = [
    ...contentBlockers,
    ...(!compliancePassed ? ["Current revision needs a passing AI compliance review"] : []),
    ...creativeBlockers,
  ];
  const publicationBlockers = [
    ...approvalBlockers,
    ...readiness.blockers,
    ...(!readiness.publishingEnabled ? ["Publishing feature is disabled"] : []),
    ...(!readiness.instagramConnected ? ["Instagram is not connected"] : []),
  ];
  const canSubmit = (status === "DRAFT" || status === "REJECTED") && contentBlockers.length === 0;
  const canReject = ["DRAFT", "NEEDS_REVIEW", "APPROVED"].includes(status);
  const canSchedule = status === "APPROVED" && Boolean(draft.scheduledFor) && !dirty && approvalBlockers.length === 0;
  const canPublish = ["APPROVED", "SCHEDULED", "FAILED"].includes(status) && !dirty && publicationBlockers.length === 0;
  const busyIcon = (name: string) => busyAction === name ? <Loader2 className="h-4 w-4 animate-spin" /> : null;
  const workflow = deriveDraftWorkflow(draft, readiness, dirty, generationRun);
  const frozenSchedule = fromDateTimeLocal(draft.scheduledFor);
  const requestedScheduleOverride = fromDateTimeLocal(scheduleOverrideFor);
  const scheduleOverrideChanged = Boolean(requestedScheduleOverride && frozenSchedule && requestedScheduleOverride !== frozenSchedule);
  const primaryDisabled = working
    || (workflow.primaryAction === "submit-review" && !canSubmit)
    || (workflow.primaryAction === "generate-creative" && working)
    || (workflow.primaryAction === "approve-and-schedule" && (approvalBlockers.length > 0 || (!weeklyLinked && !draft.scheduledFor)))
    || (workflow.primaryAction === "approve-and-schedule" && draft.bundleRole === "PARENT_FEED" && !companionStoryReady)
    || (workflow.primaryAction === "approve-and-schedule" && scheduleOverrideOpen && (!scheduleOverrideChanged || !scheduleOverrideReason.trim()))
    || (workflow.primaryAction === "schedule" && !canSchedule);
  const runPrimary = () => {
    if (workflow.primaryAction === "save") return onSave();
    if (workflow.primaryAction === "submit-review") return onAction("submit-review");
    if (workflow.primaryAction === "generate-creative") return onAction("regenerate", { scope: "image" });
    if (workflow.primaryAction === "approve-and-schedule") return onAction("approve-and-schedule", weeklyLinked
      ? scheduleOverrideOpen
        ? { scheduled_for: requestedScheduleOverride, schedule_override_reason: scheduleOverrideReason.trim(), ...(draft.bundleRole === "PARENT_FEED" ? { include_companion_story: true } : {}) }
        : draft.bundleRole === "PARENT_FEED" ? { include_companion_story: true } : {}
      : { scheduled_for: draft.scheduledFor });
    if (workflow.primaryAction === "schedule") return onAction("schedule");
    if (workflow.primaryAction === "retry-generation-run") return onAction("retry-run");
  };

  return (
    <Card className="sticky bottom-3 z-10 rounded-2xl border-primary/20 bg-card/95 shadow-xl backdrop-blur">
      <CardContent className="p-4">
        {draft.scheduledFor ? <p className="mb-3 flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-primary" /><span className="font-medium">{weeklyLinked ? "Frozen weekly slot:" : "Posting time:"}</span> {new Date(fromDateTimeLocal(draft.scheduledFor) || draft.scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {workflow.primaryAction !== "none" && !["view-calendar", "view-results", "complete-manual-action"].includes(workflow.primaryAction) ? <Button onClick={runPrimary} disabled={primaryDisabled}><>{busyIcon(workflow.primaryAction) || (workflow.primaryAction === "save" ? <Save className="h-4 w-4" /> : workflow.primaryAction === "approve-and-schedule" || workflow.primaryAction === "schedule" ? <CalendarClock className="h-4 w-4" /> : workflow.primaryAction === "generate-creative" ? <Sparkles className="h-4 w-4" /> : <Check className="h-4 w-4" />)}</> {workflow.label}</Button> : <Badge variant="outline">{workflow.label}</Badge>}
          {canReject ? <Button variant="ghost" onClick={() => onAction("reject")} disabled={working} className="text-destructive"><>{busyIcon("reject") || <X className="h-4 w-4" />}</> Reject</Button> : null}
        </div>
        {weeklyLinked && status === "NEEDS_REVIEW" && draft.bundleRole === "PARENT_FEED" ? <div className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.03] p-3 text-sm"><span className="font-medium">Companion Story included</span><span className="mt-1 block text-xs text-muted-foreground">{companionStoryReady ? "The feed and companion Story shown above will be preflighted and committed in one transaction. If either fails, neither is approved." : "The companion Story is still loading or generating. This feed waits so the final approval remains one atomic decision."}</span></div> : null}
        {weeklyLinked && status === "NEEDS_REVIEW" ? <details className="mt-3 rounded-xl border border-border/70 p-3" open={scheduleOverrideOpen} onToggle={(event) => setScheduleOverrideOpen(event.currentTarget.open)}><summary className="cursor-pointer text-xs font-medium text-primary">Advanced · change frozen time</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="New posting date and time" hint="Must remain in this Asia/Kolkata plan week."><Input type="datetime-local" value={toDateTimeLocal(scheduleOverrideFor)} onChange={(event) => setScheduleOverrideFor(event.target.value)} /></Field><Field label="Required override reason" hint="Stored in the immutable audit trail."><Textarea rows={2} value={scheduleOverrideReason} onChange={(event) => setScheduleOverrideReason(event.target.value)} /></Field></div>{scheduleOverrideOpen && !scheduleOverrideChanged ? <p className="mt-2 text-xs text-amber-700">Choose a different Asia/Kolkata posting time to create an override.</p> : null}</details> : null}
        {status === "SCHEDULED" ? <details className="mt-3 rounded-xl border border-border/70 p-3"><summary className="cursor-pointer text-xs font-medium text-primary">Advanced · publishing override</summary><div className="mt-3"><Button size="sm" variant="outline" onClick={() => onAction("publish")} disabled={!canPublish || working}><Send className="h-4 w-4" /> Publish now</Button>{!canPublish && publicationBlockers.length ? <p className="mt-2 text-xs text-muted-foreground">Unavailable: {publicationBlockers.join(" · ")}</p> : null}</div></details> : null}
        {dirty ? <p className="mt-2 text-xs text-amber-700">Save edits and recheck before approving, scheduling or publishing.</p> : null}
        {contentBlockers.length ? <p className="mt-2 text-xs text-amber-700">Editorial readiness: {contentBlockers.join(" · ")}</p> : null}
        {!compliancePassed ? <p className="mt-2 text-xs text-amber-700">Compliance readiness: Current revision needs a passing AI compliance review.</p> : null}
        {creativeBlockers.length ? <p className="mt-2 text-xs text-amber-700">Creative readiness: {creativeBlockers.join(" · ")}</p> : null}
        {status === "NEEDS_REVIEW" && !weeklyLinked && !draft.scheduledFor ? <p className="mt-2 text-xs text-amber-700">Scheduling readiness: Choose a future posting date and time.</p> : null}
        {!canPublish && ["APPROVED", "SCHEDULED"].includes(status) && publicationBlockers.length ? (
          <p className="mt-2 text-xs text-muted-foreground">Publish blocked: {publicationBlockers.join(" · ")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
};

export const SocialToday = ({
  draft,
  previousDraft,
  generationRun,
  readiness,
  loading,
  generating,
  busyAction,
  dirty,
  loadError,
  onGenerate,
  onReload,
  onRecommendationChange,
  onScheduleChange,
  onSave,
  onAction,
  onAdoptAlternative,
  onExport,
  reviewMode = false,
  reviewAdvancedContent = null,
  reviewSupplementContent = null,
  weeklyLinked = false,
  companionStoryReady = true,
  companionDraft = null,
  companionLoading = false,
  companionError = "",
  defaultVisualMode = "FULL_AI_GRAPHIC",
}: SocialTodayProps) => {
  const [formatPreference, setFormatPreference] = useState<SocialFormatPreference>("AUTO_CHOOSE");
  const [objectivePreference, setObjectivePreference] = useState("AUTO_CHOOSE");
  const [visualMode, setVisualMode] = useState<SocialVisualMode>(defaultVisualMode);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const editableDraft = Boolean(draft && ["DRAFT", "REJECTED", "NEEDS_REVIEW", "APPROVED"].includes(String(draft.status).toUpperCase()));
  useEffect(() => {
    if (draft?.visualMode) setVisualMode(requestVisualMode(draft.visualMode));
    else setVisualMode(defaultVisualMode);
  }, [defaultVisualMode, draft?.id, draft?.visualMode]);
  const changeFormatWithAi = () => {
    if (formatPreference === "AUTO_CHOOSE") {
      toast.error("Choose a concrete target format before asking AI to rewrite this draft");
      return;
    }
    onAction("regenerate", {
      scope: "format",
      target_format: formatPreference,
      visual_mode: visualMode,
      ...(generationInstructions.trim() ? { instructions: generationInstructions.trim() } : {}),
    });
  };
  const reviseWithInstructions = () => {
    const instruction = window.prompt("Tell the AI what to revise. It will preserve verified facts, disclosures, and the approval boundary.", generationInstructions);
    if (instruction === null) return;
    if (!instruction.trim()) {
      toast.error("Revision instructions are required");
      return;
    }
    onAction("regenerate", { scope: "revision", instructions: instruction.trim(), visual_mode: visualMode });
  };
  const advancedDraftControls = editableDraft ? <details className="rounded-3xl border border-border bg-card shadow-none">
    <summary className="cursor-pointer px-6 py-5 text-sm font-semibold">Advanced · regeneration and overrides</summary>
    <CardContent className="flex flex-wrap gap-2 border-t pt-5">
      <Button variant="outline" onClick={() => onAction("regenerate", { scope: "strategy", instructions: generationInstructions.trim() || undefined })} disabled={Boolean(busyAction)}><Sparkles className="h-4 w-4" /> Regenerate Strategy</Button>
      <Button variant="outline" onClick={() => onAction("regenerate", { scope: "copy", instructions: generationInstructions.trim() || undefined })} disabled={Boolean(busyAction)}><MessageSquareText className="h-4 w-4" /> Regenerate Copy</Button>
      <Button variant="outline" onClick={() => onAction("regenerate", { scope: "image", visual_mode: visualMode, instructions: generationInstructions.trim() || undefined })} disabled={Boolean(busyAction)}><ImageIcon className="h-4 w-4" /> Regenerate Image</Button>
      <Button variant="outline" onClick={changeFormatWithAi} disabled={Boolean(busyAction)}><Layers3 className="h-4 w-4" /> Change Format With AI</Button>
      <Button variant="outline" onClick={reviseWithInstructions} disabled={Boolean(busyAction)}><WandSparkles className="h-4 w-4" /> Revise With Instructions</Button>
      <Button variant="outline" onClick={() => onAction("regenerate", { scope: "compliance" })} disabled={Boolean(busyAction)}><FileCheck2 className="h-4 w-4" /> Run Compliance Again</Button>
      <Button variant="ghost" onClick={() => onAction("duplicate")} disabled={Boolean(busyAction)}><Copy className="h-4 w-4" /> Duplicate draft</Button>
    </CardContent>
  </details> : null;
  if (loading && !draft) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-5">
      {!reviewMode ? <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Today-first content operations</p>
          <h2 className="mt-1 font-serif text-3xl">What should Pink Paisa post today?</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            One evidence-backed recommendation, a complete editable Instagram package and a guarded path from draft to publication.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Last updated {draft?.updatedAt ? formatDate(draft.updatedAt, true) : "automatically"}</p>
      </div> : null}

      {!reviewMode ? <GenerationControls generating={generating} generationEnabled={readiness.generationEnabled} formatPreference={formatPreference} objectivePreference={objectivePreference} visualMode={visualMode} instructions={generationInstructions} onFormatPreferenceChange={setFormatPreference} onObjectivePreferenceChange={setObjectivePreference} onVisualModeChange={setVisualMode} onInstructionsChange={setGenerationInstructions} onGenerate={onGenerate} /> : null}

      {loadError ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Today’s workspace could not be refreshed</AlertTitle>
          <AlertDescription className="space-y-3"><p>{loadError}. Existing local content is kept on screen when available.</p><Button size="sm" variant="outline" onClick={onReload} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Retry loading</Button></AlertDescription>
        </Alert>
      ) : null}
      {!reviewMode ? <ReadinessNotice readiness={readiness} /> : null}
      {!reviewMode ? <GenerationRunPanel run={generationRun} generating={generating} onRetry={() => onAction("retry-run")} /> : null}

      {!draft ? (
        <Card className="rounded-3xl border-dashed shadow-none">
          <CardContent>
            <EmptyState icon={Sparkles} text="No recommendation exists for today yet." />
            {previousDraft ? (
              <div className="mx-auto mb-8 max-w-2xl rounded-2xl border border-border bg-muted/35 p-4 text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Previous successful draft — not today’s completed result</p>
                <p className="mt-2 font-medium">{previousDraft.primary.internalTitle || previousDraft.primary.topic}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(previousDraft.generationDate)} · {titleCase(previousDraft.primary.format || "unknown format")}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        reviewMode ? <>
          <CreativePreview draft={draft} onExport={onExport} onAction={onAction} showProvenance={false} compactReview mediaSupplement={reviewSupplementContent} />
          <CompliancePanel draft={draft} />
          <ReadinessNotice readiness={readiness} />
          {draft.bundleRole === "PARENT_FEED" ? <section aria-label="Companion Story final review" className="space-y-4 rounded-3xl border border-primary/20 bg-primary/[0.025] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Bundled final review</p><h3 className="mt-1 font-serif text-2xl">Companion Story</h3><p className="mt-1 text-sm text-muted-foreground">Review this complete Story media set and on-frame text before the single atomic approval.</p></div><Badge variant={companionStoryReady ? "default" : "secondary"}>{companionStoryReady ? "Ready for bundled approval" : "Waiting"}</Badge></div>{companionLoading ? <div className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading companion Story for review</div> : companionError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Companion Story is not reviewable</AlertTitle><AlertDescription>{companionError}</AlertDescription></Alert> : companionDraft ? <div className="space-y-4"><CreativePreview draft={companionDraft} onExport={onExport} onAction={onAction} showProvenance={false} compactReview readOnly /><CompliancePanel draft={companionDraft} /></div> : <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">The companion Story is still generating. Final approval unlocks only after its complete media and copy can be reviewed here.</div>}</section> : null}
          {editableDraft ? <details className="rounded-3xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">Edit content</summary><div className="mt-5"><ContentEditor draft={draft} onChange={onRecommendationChange} onScheduleChange={onScheduleChange} scheduleEditable={!weeklyLinked} /></div></details> : null}
          <details className="rounded-3xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">Strategy, sources and readiness detail</summary><div className="mt-5"><RecommendationSummary draft={draft} /></div></details>
          <CreativeProvenancePanel draft={draft} />
          {generationRun && (generating || String(generationRun.status).startsWith("FAILED") || generationRun.status === "RUNNING") ? <GenerationRunPanel run={generationRun} generating={generating} onRetry={() => onAction("retry-run")} /> : generationRun ? <details className="rounded-3xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">Advanced · generation run and cost</summary><div className="mt-5"><GenerationRunPanel run={generationRun} generating={generating} onRetry={() => onAction("retry-run")} /></div></details> : null}
          {advancedDraftControls}
          {reviewAdvancedContent}
          <LifecycleActions key={draft.id} draft={draft} readiness={readiness} dirty={dirty} busyAction={busyAction} onSave={onSave} onAction={onAction} generationRun={generationRun} weeklyLinked={weeklyLinked} companionStoryReady={companionStoryReady} />
        </> : <>
          <RecommendationSummary draft={draft} />
          <CompliancePanel draft={draft} />
          {editableDraft ? <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]"><ContentEditor draft={draft} onChange={onRecommendationChange} onScheduleChange={onScheduleChange} scheduleEditable={!weeklyLinked} /><CreativePreview draft={draft} onExport={onExport} onAction={onAction} /></div> : <CreativePreview draft={draft} onExport={onExport} onAction={onAction} />}
          <LifecycleActions key={draft.id} draft={draft} readiness={readiness} dirty={dirty} busyAction={busyAction} onSave={onSave} onAction={onAction} generationRun={generationRun} weeklyLinked={weeklyLinked} companionStoryReady={companionStoryReady} />
          {advancedDraftControls}
          <AlternativeIdeas draft={draft} onAdopt={onAdoptAlternative} />
        </>
      )}
    </div>
  );
};
