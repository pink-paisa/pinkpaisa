import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Check,
  Images,
  MessageCircle,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import {
  generationRequestPayload,
  fromDateTimeLocal,
  normalizeAnalyticsRefreshConnections,
  normalizeAnalyticsSummaryResponse,
  normalizeCommunityItem,
  normalizeCommunityResponse,
  normalizeConnectionsResponse,
  normalizeDraft,
  normalizeDraftList,
  normalizeGenerationRun,
  normalizeManualAction,
  normalizeManualActionsResponse,
  normalizeSettingsResponse,
  normalizeTodayResponse,
  normalizeWeeklyPlanResponse,
  normalizeWeeklyResearchResponse,
  normalizeWorkSummary,
  recommendationPayload,
  regenerationPayload,
  settingsPayload,
} from "./adapters";
import {
  SocialApprovalQueueView,
  SocialCommunityInboxView,
  SocialConnectionsView,
  SocialResearchDeskView,
  SocialWeeklyStrategyView,
} from "./SocialGrowthViews";
import { SocialManualActionsPanel, SocialManualActionNextStatus } from "./SocialManualActionsPanel";
import { SocialPublishedAnalyticsView } from "./SocialPublishedAnalyticsView";
import {
  SocialCalendarView,
  SocialPerformanceView,
  SocialSettingsView,
} from "./SocialSupportingViews";
import { SocialDraftAction, SocialToday } from "./SocialToday";
import { SocialDraftReviewDrawer } from "./SocialDraftReviewDrawer";
import { SocialAudioLibrary } from "./SocialAudioLibrary";
import { SocialGeneratedContentCleanup } from "./SocialGeneratedContentCleanup";
import { actionableDraftCount } from "./socialWorkflow";
import {
  acquirePaidMutationKey,
  PaidMutationKeyLease,
  releasePaidMutationKey,
  shouldRetainPaidMutationKey,
} from "./paidMutationIdempotency";
import {
  DEFAULT_SOCIAL_SETTINGS,
  EMPTY_READINESS,
  SocialAnalyticsSummary,
  SocialCommunityItem,
  SocialConnectionsSnapshot,
  SocialDraft,
  SocialGenerationRequest,
  SocialGenerationRun,
  SocialGeneratedContentCleanupResult,
  SocialManualAction,
  SocialReadiness,
  SocialRecommendation,
  SocialSettings,
  SocialWeeklyPlan,
  SocialWeeklyPlanItem,
  SocialWeeklyResearch,
  SocialWorkFailureItem,
  SocialWorkSummary,
} from "./types";

const API_BASE = "/social-media-manager/admin";
const WEEKLY_PLAN_POLL_STATUSES = new Set(["QUEUED", "RESEARCHING", "PLANNING"]);
const WEEKLY_PLAN_POLL_INTERVAL_MS = 4_000;
const WEEKLY_PLAN_POLL_WINDOW_MS = 5 * 60 * 1_000;

type WorkspaceTab =
  | "strategy"
  | "content"
  | "results"
  | "community"
  | "setup";

type ContentView = "list" | "calendar" | "create";

const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

const responseDraft = (response: unknown) => {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  return normalizeDraft(data.draft) || normalizeDraft(data.item) || normalizeDraft(data);
};

const responseRun = (response: unknown) => {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const nestedDraft = data.draft && typeof data.draft === "object" ? data.draft as Record<string, unknown> : {};
  return normalizeGenerationRun(data.generation_run || data.generationRun || nestedDraft.generation_run || nestedDraft.generationRun);
};

const responseData = (response: unknown) => {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
  return root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
};

const responseQueueNavigation = (response: unknown) => {
  const data = responseData(response);
  const value = data.queue_navigation && typeof data.queue_navigation === "object"
    ? data.queue_navigation as Record<string, unknown>
    : data.queueNavigation && typeof data.queueNavigation === "object"
      ? data.queueNavigation as Record<string, unknown>
      : {};
  return {
    nextReviewDraftId: String(value.next_review_draft_id || value.nextReviewDraftId || ""),
    remainingReviewCount: Number(value.remaining_review_count || value.remainingReviewCount || 0),
    waitingGenerationCount: Number(value.waiting_generation_count || value.waitingGenerationCount || 0),
    unresolvedFailureCount: Number(value.unresolved_failure_count || value.unresolvedFailureCount || 0),
    openManualBlockerCount: Number(value.open_manual_blocker_count || value.openManualBlockerCount || 0),
    firstFailureDraftId: String(value.first_failure_draft_id || value.firstFailureDraftId || ""),
  };
};

const emptyReviewQueueNavigation = () => ({
  remainingReviewCount: 0,
  waitingGenerationCount: 0,
  unresolvedFailureCount: 0,
  openManualBlockerCount: 0,
  firstFailureDraftId: "",
  complete: false,
});

const mergeDraft = (items: SocialDraft[], draft: SocialDraft) => {
  const next = items.filter((item) => item.id !== draft.id);
  return [draft, ...next];
};

const PublicationFailureRecovery = ({
  item,
  busy,
  onOpenDraft,
  onOpenActions,
  onReconcile,
}: {
  item: SocialWorkFailureItem;
  busy: boolean;
  onOpenDraft: (draftId: string) => void;
  onOpenActions: () => void;
  onReconcile: (item: SocialWorkFailureItem, payload: Record<string, string>) => void;
}) => {
  const [externalPublicationId, setExternalPublicationId] = useState("");
  const [externalPermalink, setExternalPermalink] = useState("");
  const [notes, setNotes] = useState("");
  const uncertain = String(item.status).toUpperCase() === "UNCERTAIN";
  return <div className="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="font-medium">{item.code || item.status || "Publication failure"}</p><p className="mt-1 text-sm text-muted-foreground">{item.message || "The provider outcome needs reconciliation."}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.publicationId || item.id}</p></div><div className="flex gap-2">{item.draftId ? <Button variant="outline" onClick={() => onOpenDraft(item.draftId)}>Open draft</Button> : null}<Button variant="outline" onClick={onOpenActions}>Open recovery actions</Button></div></div>{uncertain ? <div className="grid gap-3 border-t border-destructive/15 pt-3 sm:grid-cols-2"><Input aria-label={`Confirmed Meta media ID for ${item.publicationId || item.id}`} value={externalPublicationId} onChange={(event) => setExternalPublicationId(event.target.value)} placeholder="Confirmed Meta media ID" disabled={busy} /><Input aria-label={`Instagram permalink for ${item.publicationId || item.id}`} value={externalPermalink} onChange={(event) => setExternalPermalink(event.target.value)} placeholder="Instagram permalink (optional)" disabled={busy} /><Textarea aria-label={`Publication reconciliation notes for ${item.publicationId || item.id}`} className="sm:col-span-2" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Where and how the published media was verified" disabled={busy} /><div className="sm:col-span-2"><Button onClick={() => onReconcile(item, { external_publication_id: externalPublicationId.trim(), ...(externalPermalink.trim() ? { external_permalink: externalPermalink.trim() } : {}), notes: notes.trim() })} disabled={busy || !externalPublicationId.trim() || !notes.trim()}><Check className="h-4 w-4" /> Confirm published outcome</Button></div></div> : null}</div>;
};

const SocialMediaManager = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("strategy");
  const [contentView, setContentView] = useState<ContentView>("list");
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<SocialDraft | null>(null);
  const [companionDraft, setCompanionDraft] = useState<SocialDraft | null>(null);
  const [companionDraftLoading, setCompanionDraftLoading] = useState(false);
  const [companionDraftError, setCompanionDraftError] = useState("");
  const companionDraftRequestRef = useRef(0);
  const [previousDraft, setPreviousDraft] = useState<SocialDraft | null>(null);
  const [generationRun, setGenerationRun] = useState<SocialGenerationRun | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness>(EMPTY_READINESS);
  const [loadingToday, setLoadingToday] = useState(true);
  const [todayError, setTodayError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [dirty, setDirty] = useState(false);

  const [calendarDrafts, setCalendarDrafts] = useState<SocialDraft[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("ALL");
  const [calendarError, setCalendarError] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("NEEDS_ACTION");
  const [manualActions, setManualActions] = useState<SocialManualAction[]>([]);
  const [manualActionsLoading, setManualActionsLoading] = useState(false);
  const [manualActionsLoaded, setManualActionsLoaded] = useState(false);
  const [manualActionsError, setManualActionsError] = useState("");
  const [manualActionId, setManualActionId] = useState("");

  const [settings, setSettings] = useState<SocialSettings>(DEFAULT_SOCIAL_SETTINGS);
  const [settingsReadiness, setSettingsReadiness] = useState<SocialReadiness>(EMPTY_READINESS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [metricsSubmitting, setMetricsSubmitting] = useState(false);

  const [connections, setConnections] = useState<SocialConnectionsSnapshot | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsChecking, setConnectionsChecking] = useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [connectionsError, setConnectionsError] = useState("");

  const [weeklyPlan, setWeeklyPlan] = useState<SocialWeeklyPlan | null>(null);
  const [weeklyPlanLoading, setWeeklyPlanLoading] = useState(false);
  const [weeklyPlanLoaded, setWeeklyPlanLoaded] = useState(false);
  const [weeklyPlanAction, setWeeklyPlanAction] = useState("");
  const [weeklyPlanError, setWeeklyPlanError] = useState("");
  const weeklyPlanPollKeyRef = useRef("");
  const weeklyPlanPollStartedAtRef = useRef(0);

  const [weeklyResearch, setWeeklyResearch] = useState<SocialWeeklyResearch | null>(null);
  const [weeklyResearchLoading, setWeeklyResearchLoading] = useState(false);
  const [weeklyResearchLoaded, setWeeklyResearchLoaded] = useState(false);
  const [weeklyResearchError, setWeeklyResearchError] = useState("");

  const [analyticsSummary, setAnalyticsSummary] = useState<SocialAnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  const [communityItems, setCommunityItems] = useState<SocialCommunityItem[]>([]);
  const [communityStatus, setCommunityStatus] = useState("ALL");
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [communityActionId, setCommunityActionId] = useState("");
  const [workSummary, setWorkSummary] = useState<SocialWorkSummary | null>(null);
  const [reviewQueueNavigation, setReviewQueueNavigation] = useState(emptyReviewQueueNavigation);
  const [reviewSessionPlanId, setReviewSessionPlanId] = useState("");
  const [pendingReviewDraftId, setPendingReviewDraftId] = useState("");
  const reviewSessionActiveRef = useRef(false);

  const applyDraft = useCallback((nextDraft: SocialDraft | null, markClean = true) => {
    setDraft(nextDraft);
    if (nextDraft) setCalendarDrafts((current) => mergeDraft(current, nextDraft));
    if (markClean) setDirty(false);
  }, []);

  const loadToday = useCallback(async () => {
    setLoadingToday(true);
    setTodayError("");
    try {
      const response = await apiFetch(`${API_BASE}/today`);
      const normalized = normalizeTodayResponse(response);
      applyDraft(normalized.draft);
      setPreviousDraft(normalized.previousDraft);
      setGenerationRun(normalized.generationRun);
      setReadiness(normalized.readiness);
    } catch (error) {
      setTodayError(errorMessage(error, "Could not load today’s recommendation"));
    } finally {
      setLoadingToday(false);
    }
  }, [applyDraft]);

  const loadCalendar = useCallback(async (includeSelectedDraft = true) => {
    setCalendarLoading(true);
    setCalendarError("");
    try {
      const from = new Date();
      from.setDate(from.getDate() - 120);
      const to = new Date();
      to.setDate(to.getDate() + 180);
      const response = await apiFetch(`${API_BASE}/drafts?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}&limit=250`);
      const items = normalizeDraftList(response);
      // Treat the server response as authoritative so archived/superseded
      // failures disappear instead of being resurrected from stale UI state.
      // A currently selected draft may be retained only when explicitly asked.
      const selectedDraft = includeSelectedDraft && draft ? [draft] : [];
      setCalendarDrafts(Array.from(new Map(
        [...selectedDraft, ...items].filter((item) => item.id).map((item) => [item.id, item]),
      ).values()));
      setCalendarLoaded(true);
    } catch (error) {
      const message = errorMessage(error, "Could not load the social agenda");
      setCalendarError(message);
      toast.error(message);
    } finally {
      setCalendarLoaded(true);
      setCalendarLoading(false);
    }
  }, [draft]);

  const loadManualActions = useCallback(async () => {
    setManualActionsLoading(true);
    setManualActionsError("");
    try {
      const response = await apiFetch(`${API_BASE}/manual-actions?limit=200`);
      setManualActions(normalizeManualActionsResponse(response));
      setManualActionsLoaded(true);
    } catch (error) {
      const message = errorMessage(error, "Could not load manual actions");
      setManualActionsError(message);
      toast.error(message);
    } finally {
      setManualActionsLoaded(true);
      setManualActionsLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const response = await apiFetch(`${API_BASE}/settings`);
      const normalized = normalizeSettingsResponse(response);
      setSettings(normalized.settings);
      setSettingsReadiness(normalized.readiness);
      setReadiness((current) => ({
        ...current,
        ...normalized.readiness,
        blockers: normalized.readiness.blockers.length ? normalized.readiness.blockers : current.blockers,
      }));
      setSettingsLoaded(true);
    } catch (error) {
      toast.error(errorMessage(error, "Could not load Social Media Manager settings"));
    } finally {
      setSettingsLoaded(true);
      setSettingsLoading(false);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError("");
    try {
      const response = await apiFetch(`${API_BASE}/connections`);
      setConnections(normalizeConnectionsResponse(response));
      setConnectionsLoaded(true);
    } catch (error) {
      setConnectionsError(errorMessage(error, "Could not load connection health"));
    } finally {
      setConnectionsLoaded(true);
      setConnectionsLoading(false);
    }
  }, []);

  const loadWeeklyPlan = useCallback(async () => {
    setWeeklyPlanLoading(true);
    setWeeklyPlanError("");
    try {
      const response = await apiFetch(`${API_BASE}/weekly-plans/current`);
      setWeeklyPlan(normalizeWeeklyPlanResponse(response));
      setWeeklyPlanLoaded(true);
    } catch (error) {
      setWeeklyPlanError(errorMessage(error, "Could not load the current weekly plan"));
    } finally {
      setWeeklyPlanLoaded(true);
      setWeeklyPlanLoading(false);
    }
  }, []);

  const loadWeeklyResearch = useCallback(async () => {
    setWeeklyResearchLoading(true);
    setWeeklyResearchError("");
    try {
      const response = await apiFetch(`${API_BASE}/research/weekly`);
      setWeeklyResearch(normalizeWeeklyResearchResponse(response));
      setWeeklyResearchLoaded(true);
    } catch (error) {
      setWeeklyResearchError(errorMessage(error, "Could not load the weekly research digest"));
    } finally {
      setWeeklyResearchLoaded(true);
      setWeeklyResearchLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const response = await apiFetch(`${API_BASE}/analytics/summary`);
      const summary = normalizeAnalyticsSummaryResponse(response);
      if (!summary) throw new Error("The analytics summary was not returned");
      setAnalyticsSummary(summary);
      setAnalyticsLoaded(true);
      return true;
    } catch (error) {
      setAnalyticsError(errorMessage(error, "Could not load social analytics"));
      return false;
    } finally {
      setAnalyticsLoaded(true);
      setAnalyticsLoading(false);
    }
  }, []);

  const loadCommunity = useCallback(async (status = communityStatus) => {
    setCommunityLoading(true);
    setCommunityError("");
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      const response = await apiFetch(`${API_BASE}/community${params.toString() ? `?${params.toString()}` : ""}`);
      setCommunityItems(normalizeCommunityResponse(response));
      setCommunityLoaded(true);
    } catch (error) {
      setCommunityError(errorMessage(error, "Could not load the Community Inbox"));
    } finally {
      setCommunityLoaded(true);
      setCommunityLoading(false);
    }
  }, [communityStatus]);

  const loadWorkSummary = useCallback(async (weeklyPlanId = "") => {
    try {
      const response = await apiFetch(`${API_BASE}/work-summary${weeklyPlanId ? `?weekly_plan_id=${encodeURIComponent(weeklyPlanId)}` : ""}`);
      const summary = normalizeWorkSummary(response);
      if (!weeklyPlanId) setWorkSummary(summary);
      return summary;
    } catch {
      // The detailed workspaces remain usable if the lightweight summary is temporarily unavailable.
      return null;
    }
  }, []);

  useEffect(() => {
    void loadToday();
    void loadWorkSummary();
  }, [loadToday, loadWorkSummary]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (activeTab === "strategy" && !weeklyPlanLoaded && !weeklyPlanLoading) void loadWeeklyPlan();
    if (activeTab === "strategy" && !weeklyResearchLoaded && !weeklyResearchLoading) void loadWeeklyResearch();
    if (["content", "results"].includes(activeTab) && !calendarLoaded && !calendarLoading) void loadCalendar();
    if (activeTab === "content" && !manualActionsLoaded && !manualActionsLoading) void loadManualActions();
    if (activeTab === "results" && !analyticsLoaded && !analyticsLoading) void loadAnalytics();
    if (activeTab === "community" && !communityLoaded && !communityLoading) void loadCommunity();
    if (activeTab === "setup" && !connectionsLoaded && !connectionsLoading) void loadConnections();
    if (activeTab === "setup" && !settingsLoaded && !settingsLoading) void loadSettings();
  }, [
    activeTab,
    analyticsLoaded,
    analyticsLoading,
    calendarLoaded,
    calendarLoading,
    communityLoaded,
    communityLoading,
    connectionsLoaded,
    connectionsLoading,
    loadAnalytics,
    loadCalendar,
    loadCommunity,
    loadConnections,
    loadManualActions,
    loadSettings,
    loadWeeklyPlan,
    loadWeeklyResearch,
    manualActionsLoaded,
    manualActionsLoading,
    settingsLoaded,
    settingsLoading,
    weeklyPlanLoaded,
    weeklyPlanLoading,
    weeklyResearchLoaded,
    weeklyResearchLoading,
  ]);

  useEffect(() => {
    if (activeTab !== "community" || !communityItems.some((item) => ["RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING", "SEND_QUEUED", "SEND_PROCESSING"].includes(String(item.status).toUpperCase()))) return;
    const interval = window.setInterval(() => void loadCommunity(), 4_000);
    return () => window.clearInterval(interval);
  }, [activeTab, communityItems, loadCommunity]);

  useEffect(() => {
    const status = String(weeklyPlan?.status || "").toUpperCase();
    const pollKey = weeklyPlan?.id || "";
    if (!pollKey || !WEEKLY_PLAN_POLL_STATUSES.has(status)) {
      weeklyPlanPollKeyRef.current = "";
      weeklyPlanPollStartedAtRef.current = 0;
      return;
    }
    if (weeklyPlanPollKeyRef.current !== pollKey) {
      weeklyPlanPollKeyRef.current = pollKey;
      weeklyPlanPollStartedAtRef.current = Date.now();
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (!cancelled) timer = setTimeout(() => void poll(), WEEKLY_PLAN_POLL_INTERVAL_MS);
    };
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - weeklyPlanPollStartedAtRef.current >= WEEKLY_PLAN_POLL_WINDOW_MS) {
        setWeeklyPlanError("Automatic weekly-plan refresh paused after five minutes. Use Refresh to check the current server state.");
        return;
      }
      try {
        const response = await apiFetch(`${API_BASE}/weekly-plans/current`);
        if (cancelled) return;
        const nextPlan = normalizeWeeklyPlanResponse(response);
        if (nextPlan) {
          const nextStatus = String(nextPlan.status || "").toUpperCase();
          setWeeklyPlan(nextPlan);
          setWeeklyPlanLoaded(true);
          setWeeklyPlanError("");
          if (WEEKLY_PLAN_POLL_STATUSES.has(nextStatus)) schedule();
          else if (nextStatus === "NEEDS_REVIEW" || nextStatus === "PLANNED") toast.success("Weekly strategy is ready for review");
          else if (nextStatus.startsWith("FAILED")) toast.error("Weekly plan generation stopped with a visible failure. Review the failure card before retrying.");
          return;
        }
      } catch (error) {
        if (Date.now() - weeklyPlanPollStartedAtRef.current >= WEEKLY_PLAN_POLL_WINDOW_MS) {
          setWeeklyPlanError(errorMessage(error, "Automatic weekly-plan refresh stopped. Use Refresh to try again."));
          return;
        }
      }
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [weeklyPlan?.id, weeklyPlan?.status]);

  const generate = async (request: SocialGenerationRequest) => {
    if (draft && !window.confirm(dirty
      ? "Generate a fresh revision and discard unsaved edits? The existing saved draft remains in the audit history."
      : "Generate a fresh revision for today? The existing draft remains in the audit history.")) return;
    setGenerating(true);
    try {
      const response = await apiFetch(`${API_BASE}/generate`, {
        method: "POST",
        body: JSON.stringify(generationRequestPayload({ ...request, force: Boolean(request.force || draft) })),
      });
      const queuedRun = responseRun(response);
      if (queuedRun) setGenerationRun(queuedRun);
      const nextDraft = responseDraft(response);
      if (nextDraft) applyDraft(nextDraft);
      else {
        let completedDraft: SocialDraft | null = null;
        for (let attempt = 0; attempt < 45 && !completedDraft; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          const statusResponse = await apiFetch(`${API_BASE}/today`);
          const normalized = normalizeTodayResponse(statusResponse);
          setReadiness(normalized.readiness);
          setPreviousDraft(normalized.previousDraft);
          setGenerationRun(normalized.generationRun);
          const runStatus = normalized.generationRun?.status || "";
          if (runStatus === "SUCCEEDED") completedDraft = normalized.draft;
          if (["FAILED", "FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_IMAGE", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION", "FAILED_PUBLISHING"].includes(runStatus)) {
            throw new Error(normalized.generationRun?.lastError?.message || (runStatus === "FAILED_COMPLIANCE"
              ? "AI generation exhausted its compliance revisions"
              : runStatus === "FAILED_IMAGE_GENERATION"
                ? "AI image generation failed before a reviewable draft could be completed"
                : "Social recommendation generation failed"));
          }
        }
        if (completedDraft) {
          applyDraft(completedDraft);
          toast.success("Today’s recommendation is ready");
        }
        else toast.info("Generation is still running in the background. Today’s panel will show it when ready.");
      }
      if (nextDraft) toast.success((response as Record<string, unknown>)?.message as string || "Today’s recommendation is ready");
    } catch (error) {
      toast.error(errorMessage(error, "Could not generate today’s recommendation"));
    } finally {
      setGenerating(false);
    }
  };

  const updateRecommendation = (next: SocialRecommendation) => {
    setDraft((current) => current ? { ...current, primary: next, captionContract: null } : current);
    setDirty(true);
  };

  const updateSchedule = (value: string) => {
    const scheduledFor = fromDateTimeLocal(value);
    setDraft((current) => current ? { ...current, scheduledFor: scheduledFor || value } : current);
  };

  const saveDraft = async () => {
    if (!draft?.id) return;
    setBusyAction("save");
    try {
      const response = await apiFetch(`${API_BASE}/drafts/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ primary_recommendation: recommendationPayload(draft.primary) }),
      });
      const nextDraft = responseDraft(response);
      applyDraft(nextDraft || draft);
      toast.success((response as Record<string, unknown>)?.message as string || "Draft saved");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save this draft"));
    } finally {
      setBusyAction("");
    }
  };

  const lifecycleAction = async (action: SocialDraftAction, payload: Record<string, unknown> = {}) => {
    if (action === "retry-run") {
      if (dirty) {
        toast.error("Save or discard your edits before retrying generation");
        return;
      }
      if (!generationRun?.id) {
        toast.error("The failed generation run is unavailable. Reopen this creative and try again.");
        return;
      }
      setBusyAction("retry-run");
      try {
        const response = await apiFetch(`${API_BASE}/runs/${encodeURIComponent(generationRun.id)}/retry`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const nextRun = responseRun(response);
        if (nextRun) setGenerationRun(nextRun);
        const nextDraft = responseDraft(response);
        if (nextDraft) applyDraft(nextDraft);
        await Promise.all([loadWorkSummary(), loadCalendar(false)]);
        if (reviewDrawerOpen && !nextDraft) setReviewDrawerOpen(false);
        toast.success((response as Record<string, unknown>)?.message as string || "Generation retry queued");
      } catch (error) {
        toast.error(errorMessage(error, "Could not retry this generation run"));
      } finally {
        setBusyAction("");
      }
      return;
    }
    if (!draft?.id) return;
    const weeklyQueuePlanId = draft.weeklyPlanId
      || (weeklyPlan?.items.some((item) => item.draftId === draft.id) ? weeklyPlan.id : "");
    if (dirty && ["submit-review", "approve", "approve-and-schedule", "schedule", "publish", "regenerate", "render", "duplicate", "audio-track"].includes(action)) {
      toast.error("Save your edits before continuing");
      return;
    }

    let body: Record<string, unknown> = payload;
    let route: string = action;
    let actionKey: string = action;
    if (action === "reject") {
      const notes = window.prompt("Why is this draft being rejected? This note will be added to the audit trail.");
      if (notes === null) return;
      if (!notes.trim()) {
        toast.error("A rejection reason is required");
        return;
      }
      body = { notes: notes.trim() };
    }
    if (action === "schedule" || action === "approve-and-schedule") {
      const weeklyNormalApproval = action === "approve-and-schedule" && Boolean(weeklyQueuePlanId) && typeof payload.scheduled_for !== "string";
      if (weeklyNormalApproval) {
        body = payload.include_companion_story === true ? { include_companion_story: true } : {};
      } else {
        const requestedSchedule = typeof payload.scheduled_for === "string" ? payload.scheduled_for : draft.scheduledFor;
        if (!requestedSchedule) {
          toast.error("Choose a posting date and time first");
          return;
        }
        const scheduledFor = fromDateTimeLocal(requestedSchedule);
        const scheduled = new Date(scheduledFor);
        if (!scheduledFor || Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
          toast.error("Choose a valid future posting time");
          return;
        }
        if (Boolean(weeklyQueuePlanId) && action === "approve-and-schedule" && !String(payload.schedule_override_reason || "").trim()) {
          toast.error("Explain why the frozen weekly posting time must change");
          return;
        }
        body = {
          scheduled_for: scheduledFor,
          ...(payload.schedule_override_reason ? { schedule_override_reason: String(payload.schedule_override_reason).trim() } : {}),
          ...(payload.include_companion_story === true ? { include_companion_story: true } : {}),
        };
      }
    }
    if (action === "publish" && !window.confirm("Publish this approved post to the connected Instagram account now?")) return;
    if (action === "regenerate") {
      actionKey = `regenerate-${String(payload.scope || "part")}`;
      body = regenerationPayload(payload);
    }
    if (action === "render") route = "assets/render";
    if (action === "audio-track") {
      route = "audio-track";
      actionKey = "audio-track";
      body = { ...payload, rebuild: true };
    }

    setBusyAction(actionKey);
    const paidMutation = ["regenerate", "render", "duplicate"].includes(action);
    let paidMutationLease: PaidMutationKeyLease | null = null;
    try {
      paidMutationLease = paidMutation
        ? acquirePaidMutationKey({
          actionKey,
          draftId: draft.id,
          revision: draft.revision,
          body,
        })
        : null;
      const idempotencyKey = action === "approve-and-schedule"
        ? `${draft.id}:${draft.updatedAt || draft.createdAt}:${String(body.scheduled_for || "weekly-slot")}:${body.include_companion_story === true ? "with-companion" : "single"}`
        : paidMutation
          ? paidMutationLease?.key || ""
          : "";
      const response = await apiFetch(`${API_BASE}/drafts/${encodeURIComponent(draft.id)}/${route}`, {
        method: "POST",
        ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
        body: JSON.stringify(body),
      });
      if (paidMutationLease) releasePaidMutationKey(paidMutationLease);
      const nextDraft = responseDraft(response);
      const nextRun = responseRun(response);
      if (nextRun) setGenerationRun(nextRun);
      if (nextDraft) applyDraft(nextDraft);
      else if (action !== "duplicate") await loadToday();
      if (action === "duplicate" && nextDraft) {
        applyDraft(nextDraft);
        setActiveTab("content");
        setReviewDrawerOpen(true);
      }
      if (action === "approve-and-schedule" && weeklyQueuePlanId) {
        const navigation = responseQueueNavigation(response);
        setReviewSessionPlanId(weeklyQueuePlanId);
        setReviewQueueNavigation({
          remainingReviewCount: navigation.remainingReviewCount,
          waitingGenerationCount: navigation.waitingGenerationCount,
          unresolvedFailureCount: navigation.unresolvedFailureCount,
          openManualBlockerCount: navigation.openManualBlockerCount,
          firstFailureDraftId: navigation.firstFailureDraftId,
          complete: !navigation.nextReviewDraftId
            && navigation.remainingReviewCount === 0
            && navigation.waitingGenerationCount === 0
            && navigation.unresolvedFailureCount === 0
            && navigation.openManualBlockerCount === 0,
        });
        setCalendarLoaded(false);
        setManualActionsLoaded(false);
        void loadWorkSummary();
        if (navigation.nextReviewDraftId) {
          setPendingReviewDraftId(navigation.nextReviewDraftId);
          const opened = await openDraftById(navigation.nextReviewDraftId, true, weeklyQueuePlanId);
          if (opened) {
            setPendingReviewDraftId("");
            setReviewQueueNavigation((current) => ({
              ...current,
              remainingReviewCount: Math.max(0, current.remainingReviewCount - 1),
            }));
          }
        } else if (navigation.waitingGenerationCount > 0) {
          toast.info("Approved and scheduled. The next creative will open when generation finishes.");
        }
      } else if (action === "approve-and-schedule") {
        setReviewSessionPlanId("");
        setPendingReviewDraftId("");
        setReviewQueueNavigation(emptyReviewQueueNavigation());
      }
      toast.success((response as Record<string, unknown>)?.message as string || `${action.replace(/-/g, " ")} complete`);
    } catch (error) {
      if (paidMutationLease && !shouldRetainPaidMutationKey(error)) releasePaidMutationKey(paidMutationLease);
      toast.error(errorMessage(error, `Could not ${action.replace(/-/g, " ")} this draft`));
    } finally {
      setBusyAction("");
    }
  };

  const adoptAlternative = (index: number) => {
    if (!draft?.alternatives[index]) return;
    const alternative = draft.alternatives[index];
    setDraft({ ...draft, primary: { ...alternative, sources: alternative.sources.length ? alternative.sources : draft.primary.sources } });
    setDirty(true);
    toast.info("Alternative loaded into the editor. Review and save when ready.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exportPackage = () => {
    if (!draft) return;
    const exported = {
      draft_id: draft.id,
      status: draft.status,
      generation_date: draft.generationDate,
      timezone: draft.timezone,
      primary_recommendation: recommendationPayload(draft.primary),
      alternative_recommendations: draft.alternatives.map(recommendationPayload),
      scheduled_for: draft.scheduledFor || null,
      assets: draft.assets,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pink-paisa-social-${draft.generationDate || "draft"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Content package exported");
  };

  const reloadToday = () => {
    if (dirty && !window.confirm("Refresh today’s recommendation and discard unsaved edits?")) return;
    void loadToday();
  };

  const openDraft = async (summary: SocialDraft, switchToToday = true, preserveQueue = false) => {
    if (dirty && !window.confirm("Open another draft and discard unsaved edits?")) return;
    setBusyAction("open-draft");
    try {
      const response = await apiFetch(`${API_BASE}/drafts/${encodeURIComponent(summary.id)}`);
      applyDraft(responseDraft(response) || summary);
      const detailRun = responseRun(response);
      setGenerationRun(detailRun);
      if (switchToToday) {
        setActiveTab("content");
        setReviewDrawerOpen(true);
        reviewSessionActiveRef.current = true;
        if (!preserveQueue) {
          setReviewSessionPlanId("");
          setPendingReviewDraftId("");
          setReviewQueueNavigation(emptyReviewQueueNavigation());
        }
      }
    } catch (error) {
      applyDraft(summary);
      setGenerationRun(null);
      if (switchToToday) {
        setActiveTab("content");
        setReviewDrawerOpen(true);
        reviewSessionActiveRef.current = true;
        if (!preserveQueue) {
          setReviewSessionPlanId("");
          setPendingReviewDraftId("");
          setReviewQueueNavigation(emptyReviewQueueNavigation());
        }
      }
      toast.error(`${errorMessage(error, "Could not load full draft details")}. Showing the agenda summary instead.`);
    } finally {
      setBusyAction("");
    }
  };

  const submitMetrics = async (payload: { captured_at?: string; metrics: Record<string, number>; notes?: string }) => {
    if (!draft?.id) return;
    setMetricsSubmitting(true);
    try {
      const response = await apiFetch(`${API_BASE}/drafts/${encodeURIComponent(draft.id)}/metrics`, {
        method: "POST",
        body: JSON.stringify({ source: "manual", ...payload }),
      });
      const nextDraft = responseDraft(response);
      if (nextDraft) applyDraft(nextDraft);
      else await openDraft(draft, false);
      toast.success((response as Record<string, unknown>)?.message as string || "Performance snapshot saved");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the performance snapshot"));
    } finally {
      setMetricsSubmitting(false);
    }
  };

  const saveSettings = async () => {
    const mixTotal = settings.contentPillars.filter((pillar) => pillar.enabled).reduce((total, pillar) => total + pillar.ratio, 0);
    if (mixTotal !== 100) {
      toast.error("Enabled content pillar ratios must total 100%");
      return;
    }
    setSettingsSaving(true);
    try {
      const response = await apiFetch(`${API_BASE}/settings`, {
        method: "PUT",
        body: JSON.stringify({ settings: settingsPayload(settings) }),
      });
      const normalized = normalizeSettingsResponse(response);
      setSettings(normalized.settings);
      setSettingsReadiness(normalized.readiness);
      setReadiness(normalized.readiness);
      toast.success((response as Record<string, unknown>)?.message as string || "Social Media Manager settings saved");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save Social Media Manager settings"));
    } finally {
      setSettingsSaving(false);
    }
  };

  const resetAfterGeneratedContentCleanup = async (result: SocialGeneratedContentCleanupResult) => {
    reviewSessionActiveRef.current = false;
    weeklyPlanPollKeyRef.current = "";
    weeklyPlanPollStartedAtRef.current = 0;
    setReviewDrawerOpen(false);
    setDraft(null);
    setPreviousDraft(null);
    setGenerationRun(null);
    setCalendarDrafts([]);
    setCalendarLoaded(false);
    setCalendarError("");
    setManualActions([]);
    setManualActionsLoaded(false);
    setManualActionsError("");
    setManualActionId("");
    setWeeklyPlan(null);
    setWeeklyPlanLoaded(false);
    setWeeklyPlanError("");
    setWeeklyResearch(null);
    setWeeklyResearchLoaded(false);
    setWeeklyResearchError("");
    setAnalyticsSummary(null);
    setAnalyticsLoaded(false);
    setAnalyticsError("");
    setWorkSummary(null);
    setPendingReviewDraftId("");
    setReviewSessionPlanId("");
    setReviewQueueNavigation(emptyReviewQueueNavigation());
    setDirty(false);
    setApprovalFilter("NEEDS_ACTION");
    setCalendarFilter("ALL");
    if (result.fileCleanup.failed) toast.warning("Generated records were deleted, but some local media files still need attention");
    else toast.success(`${result.totalDeleted} generated Social Manager records were deleted`);
    await Promise.all([
      loadToday(),
      loadCalendar(false),
      loadManualActions(),
      loadWeeklyPlan(),
      loadWeeklyResearch(),
      loadAnalytics(),
      loadWorkSummary(),
    ]);
  };

  const checkConnections = async () => {
    setConnectionsChecking(true);
    setConnectionsError("");
    try {
      const response = await apiFetch(`${API_BASE}/connections/check`, { method: "POST", body: JSON.stringify({}) });
      setConnections(normalizeConnectionsResponse(response));
      setConnectionsLoaded(true);
      setWeeklyResearchLoaded(false);
      toast.success("Connection health checks completed");
    } catch (error) {
      const message = errorMessage(error, "Connection health checks failed");
      setConnectionsError(message);
      toast.error(message);
    } finally {
      setConnectionsChecking(false);
    }
  };

  const generateWeeklyPlan = async () => {
    const status = String(weeklyPlan?.status || "").toUpperCase();
    if (["APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED"].includes(status)) {
      await loadWeeklyPlan();
      toast.info("This approved plan is protected. Retry only a failed creative item or create the next planning week.");
      return;
    }
    const retrying = status === "REJECTED" || status.startsWith("FAILED");
    const payload = retrying ? { force: true } : {};
    setWeeklyPlanAction("generate");
    setWeeklyPlanError("");
    try {
      const response = await apiFetch(`${API_BASE}/weekly-plans/generate`, { method: "POST", body: JSON.stringify(payload) });
      const plan = normalizeWeeklyPlanResponse(response);
      if (plan) setWeeklyPlan(plan);
      else await loadWeeklyPlan();
      setWeeklyPlanLoaded(true);
      const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
      if (root.reused === true) toast.info("This week's weekly plan already exists; its current state was reloaded");
      else toast.info(retrying ? "Weekly plan retry is queued" : "Weekly plan generation is queued");
    } catch (error) {
      const message = errorMessage(error, "Could not generate the weekly strategy");
      setWeeklyPlanError(message);
      toast.error(message);
    } finally {
      setWeeklyPlanAction("");
    }
  };

  const reviewWeeklyPlan = async (action: "approve" | "reject") => {
    if (!weeklyPlan?.id) return;
    let notes = "";
    if (action === "reject") {
      const response = window.prompt("Why should the weekly plan be revised?");
      if (response === null) return;
      notes = response.trim();
      if (!notes) {
        toast.error("A rejection reason is required");
        return;
      }
    }
    setWeeklyPlanAction(action);
    try {
      const response = await apiFetch(`${API_BASE}/weekly-plans/${encodeURIComponent(weeklyPlan.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(notes ? { notes } : {}),
      });
      setWeeklyPlan(normalizeWeeklyPlanResponse(response) || { ...weeklyPlan, status: action === "approve" ? "APPROVED" : "REJECTED" });
      const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
      const production = root.production && typeof root.production === "object" ? root.production as Record<string, unknown> : {};
      const queued = Number(production.queued || 0);
      const reused = Number(production.reused || 0);
      toast.success(action === "approve" ? `Weekly plan approved; ${queued} creative${queued === 1 ? "" : "s"} queued${reused ? ` and ${reused} reused` : ""}` : "Weekly plan returned for revision");
    } catch (error) {
      toast.error(errorMessage(error, `Could not ${action} the weekly plan`));
    } finally {
      setWeeklyPlanAction("");
    }
  };

  const replaceWeeklySlot = async (item: SocialWeeklyPlanItem, candidateId: string) => {
    if (!weeklyPlan?.id) return false;
    const actionKey = `replace:${item.order}`;
    setWeeklyPlanAction(actionKey);
    setWeeklyPlanError("");
    try {
      const response = await apiFetch(`${API_BASE}/weekly-plans/${encodeURIComponent(weeklyPlan.id)}/slots/${item.order}/replace`, {
        method: "POST",
        body: JSON.stringify({ candidate_id: candidateId }),
      });
      const plan = normalizeWeeklyPlanResponse(response);
      if (!plan) throw new Error("The updated weekly plan was not returned");
      setWeeklyPlan(plan);
      void loadWorkSummary();
      toast.success(`Post ${item.order} replaced; its posting time was preserved`);
      return true;
    } catch (error) {
      const message = errorMessage(error, "Could not replace this weekly slot");
      setWeeklyPlanError(message);
      toast.error(message);
      return false;
    } finally {
      setWeeklyPlanAction("");
    }
  };

  const produceWeeklyPost = async (item: SocialWeeklyPlanItem) => {
    if (!weeklyPlan?.id || !item.id) return;
    const actionKey = `produce:${item.id}`;
    setWeeklyPlanAction(actionKey);
    setWeeklyPlanError("");
    try {
      const response = await apiFetch(
        `${API_BASE}/weekly-plans/${encodeURIComponent(weeklyPlan.id)}/produce/${encodeURIComponent(item.id)}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setWeeklyPlan(normalizeWeeklyPlanResponse(response) || weeklyPlan);
      setManualActionsLoaded(false);
      toast.success(item.status === "FAILED" ? "Creative retry queued" : "AI creative production queued");
    } catch (error) {
      const message = errorMessage(error, "Could not queue creative production");
      setWeeklyPlanError(message);
      toast.error(message);
    } finally {
      setWeeklyPlanAction("");
    }
  };

  const openDraftById = async (draftId: string, preserveQueue = false, expectedWeeklyPlanId = "") => {
    const existing = calendarDrafts.find((item) => item.id === draftId);
    if (existing && !expectedWeeklyPlanId) {
      await openDraft(existing, true, preserveQueue);
      return true;
    }
    setBusyAction("open-draft");
    try {
      const response = await apiFetch(`${API_BASE}/drafts/${encodeURIComponent(draftId)}`);
      const nextDraft = responseDraft(response);
      if (!nextDraft) throw new Error("The creative draft was not returned");
      if (expectedWeeklyPlanId && nextDraft.weeklyPlanId !== expectedWeeklyPlanId) {
        throw new Error("The next creative does not belong to this weekly review session");
      }
      applyDraft(nextDraft);
      setGenerationRun(responseRun(response));
      setActiveTab("content");
      setReviewDrawerOpen(true);
      reviewSessionActiveRef.current = true;
      if (!preserveQueue) {
        setReviewSessionPlanId("");
        setPendingReviewDraftId("");
        setReviewQueueNavigation(emptyReviewQueueNavigation());
      }
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Could not open this planned creative"));
      return false;
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    if (!reviewDrawerOpen || !reviewSessionActiveRef.current || !reviewSessionPlanId || (
      reviewQueueNavigation.waitingGenerationCount <= 0
      && reviewQueueNavigation.unresolvedFailureCount <= 0
      && reviewQueueNavigation.openManualBlockerCount <= 0
      && !pendingReviewDraftId
    )) return;
    let cancelled = false;
    const poll = async () => {
      const summary = await loadWorkSummary(reviewSessionPlanId);
      if (cancelled || !summary || !reviewSessionActiveRef.current) return;
      const content = summary.breakdown.content && typeof summary.breakdown.content === "object"
        ? summary.breakdown.content as Record<string, unknown>
        : {};
      const needsReview = Number(content.needs_review || content.needsReview || 0);
      const waiting = Number(content.generating_waiting || content.generatingWaiting || 0);
      const unresolvedFailures = Number(content.terminal_failure || content.terminalFailure || 0);
      const openManualBlockers = Number(content.open_manual_action || content.openManualAction || 0);
      const firstFailureDraftId = summary.terminalFailures.content.find((item) => item.draftId)?.draftId || "";
      if (!summary.nextReviewDraftId && needsReview === 0 && waiting === 0 && unresolvedFailures === 0 && openManualBlockers === 0) {
        setPendingReviewDraftId("");
        setReviewQueueNavigation({ ...emptyReviewQueueNavigation(), complete: true });
        return;
      }
      const nextReviewDraftId = summary.nextReviewDraftId || pendingReviewDraftId;
      let displayingNext = Boolean(nextReviewDraftId && nextReviewDraftId === draft?.id);
      if (nextReviewDraftId && !displayingNext) {
        setPendingReviewDraftId(nextReviewDraftId);
        displayingNext = await openDraftById(nextReviewDraftId, true, reviewSessionPlanId);
        if (cancelled) return;
      }
      if (displayingNext) setPendingReviewDraftId("");
      setReviewQueueNavigation({
        remainingReviewCount: Math.max(0, needsReview - (displayingNext ? 1 : 0)),
        waitingGenerationCount: waiting,
        unresolvedFailureCount: unresolvedFailures,
        openManualBlockerCount: openManualBlockers,
        firstFailureDraftId,
        complete: !nextReviewDraftId
          && needsReview === 0
          && waiting === 0
          && unresolvedFailures === 0
          && openManualBlockers === 0,
      });
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [draft?.id, loadWorkSummary, pendingReviewDraftId, reviewDrawerOpen, reviewQueueNavigation.openManualBlockerCount, reviewQueueNavigation.unresolvedFailureCount, reviewQueueNavigation.waitingGenerationCount, reviewSessionPlanId]);

  const updateManualAction = async (
    action: SocialManualAction,
    status: SocialManualActionNextStatus,
    note = "",
  ) => {
    const payload: Record<string, string> = { status };
    if (status === "COMPLETED") payload.resolution_note = note.trim();
    if (status === "CANCELLED") payload.cancellation_reason = note.trim();
    setManualActionId(action.id);
    try {
      const response = await apiFetch(`${API_BASE}/manual-actions/${encodeURIComponent(action.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
      const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
      const updated = normalizeManualAction(data.action || root.action || data);
      if (!updated.id) throw new Error("The updated manual action was not returned");

      const replaceAction = (items: SocialManualAction[]) => {
        if (items.some((item) => item.id === updated.id)) return items.map((item) => item.id === updated.id ? updated : item);
        return [...items, updated];
      };
      setManualActions((current) => replaceAction(current));
      setDraft((current) => current && current.id === updated.draftId
        ? { ...current, manualActions: replaceAction(current.manualActions) }
        : current);
      setCalendarDrafts((current) => current.map((item) => item.id === updated.draftId
        ? { ...item, manualActions: replaceAction(item.manualActions) }
        : item));

      const message = typeof data.message === "string"
        ? data.message
        : typeof root.message === "string"
          ? root.message
          : status === "COMPLETED"
              ? "Manual action completed"
              : "Manual action cancelled";
      toast.success(message);
      void loadWorkSummary();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, `Could not mark this manual action ${status.toLowerCase().replace(/_/g, " ")}`));
      return false;
    } finally {
      setManualActionId("");
    }
  };

  const retrySummaryGenerationRun = async (runId: string) => {
    if (!runId) return;
    const actionKey = `retry-summary-run:${runId}`;
    setBusyAction(actionKey);
    try {
      const response = await apiFetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const nextRun = normalizeGenerationRun(response);
      if (nextRun) setGenerationRun(nextRun);
      await Promise.all([loadWorkSummary(), loadCalendar(false)]);
      toast.success("The failed creative run was queued for a safe retry");
    } catch (error) {
      toast.error(errorMessage(error, "Could not retry the failed creative run"));
    } finally {
      setBusyAction("");
    }
  };

  const archiveSummaryGenerationFailure = async (runId: string) => {
    if (!runId) return;
    const actionKey = `archive-summary-run:${runId}`;
    setBusyAction(actionKey);
    try {
      await apiFetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/archive-failure`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Dismissed from actionable recovery after administrator review.",
        }),
      });
      await Promise.all([loadWorkSummary(), loadCalendar(false)]);
      toast.success("The failure was dismissed; its audit history remains available");
    } catch (error) {
      toast.error(errorMessage(error, "Could not dismiss the failed creative run"));
    } finally {
      setBusyAction("");
    }
  };

  const reconcilePublicationFailure = async (item: SocialWorkFailureItem, payload: Record<string, string>) => {
    const publicationId = item.publicationId || item.id;
    if (!publicationId) return;
    const actionKey = `reconcile-publication:${publicationId}`;
    setBusyAction(actionKey);
    try {
      await apiFetch(`${API_BASE}/publications/${encodeURIComponent(publicationId)}/reconcile`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await Promise.all([loadWorkSummary(), loadCalendar(), loadManualActions(), loadAnalytics()]);
      toast.success("The confirmed Meta publication was reconciled without republishing");
    } catch (error) {
      toast.error(errorMessage(error, "Could not reconcile the uncertain publication"));
    } finally {
      setBusyAction("");
    }
  };

  const refreshAnalytics = async () => {
    setAnalyticsRefreshing(true);
    setAnalyticsError("");
    try {
      const response = await apiFetch(`${API_BASE}/analytics/refresh`, { method: "POST", body: JSON.stringify({}) });
      const connectionResults = normalizeAnalyticsRefreshConnections(response);
      const [analyticsReloaded] = await Promise.all([loadAnalytics(), loadConnections(), loadCalendar()]);
      if (!analyticsReloaded) {
        toast.error("Provider collection finished, but the refreshed analytics summary could not be loaded");
        return;
      }

      const providerErrors = connectionResults.filter((connection) => connection.status === "ERROR");
      const providerWarnings = connectionResults.filter((connection) => ["NOT_CONFIGURED", "PARTIAL"].includes(connection.status));
      const describeConnection = (connection: (typeof connectionResults)[number]) => `${connection.provider}: ${connection.message || connection.status.toLowerCase().replace(/_/g, " ")}`;
      if (providerErrors.length) toast.error(`Metrics refreshed with provider errors — ${providerErrors.map(describeConnection).join(" · ")}`);
      if (providerWarnings.length) toast.warning(`Metrics refreshed with provider warnings — ${providerWarnings.map(describeConnection).join(" · ")}`);
      if (!connectionResults.length) toast.warning("Metrics were reloaded, but the refresh response did not include provider connection results");
      if (connectionResults.length && !providerErrors.length && !providerWarnings.length) toast.success("Social metrics refreshed");
    } catch (error) {
      const message = errorMessage(error, "Could not refresh social metrics");
      setAnalyticsError(message);
      toast.error(message);
    } finally {
      setAnalyticsRefreshing(false);
    }
  };

  const changeCommunityStatus = (status: string) => {
    setCommunityStatus(status);
    void loadCommunity(status);
  };

  const communityAction = async (
    item: SocialCommunityItem,
    action: "approve-and-send" | "recommend" | "approve" | "reject" | "send" | "reconcile" | "acknowledge-escalation" | "resolve-escalation",
    payload: Record<string, string> = {},
  ) => {
    let body = { ...payload };
    if (action === "reject") {
      const response = window.prompt("Why should this reply recommendation be rejected?");
      if (response === null) return;
      const notes = response.trim();
      if (!notes) {
        toast.error("A rejection reason is required");
        return;
      }
      body = { notes };
    }
    if (action === "send" && !window.confirm("Send this approved reply through the connected Meta account?")) return;
    setCommunityActionId(item.id);
    try {
      const response = await apiFetch(`${API_BASE}/community/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST",
        ...(action === "approve-and-send" ? {
          headers: { "Idempotency-Key": `community-approve-send:${item.id}` },
        } : {}),
        body: JSON.stringify(body),
      });
      const updated = normalizeCommunityItem(response);
      if (updated.id) setCommunityItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      else await loadCommunity();
      const successMessage: Record<string, string> = {
        recommend: "Reply recommendation queued",
        "approve-and-send": "Reply approved and durably queued for sending",
        approve: "Reply approved",
        reject: "Reply rejected",
        send: "Approved reply queued",
        reconcile: "Meta delivery reconciled without retrying",
        "acknowledge-escalation": "Escalation acknowledged",
        "resolve-escalation": "Escalation resolved",
      };
      toast.success(successMessage[action] || "Community item updated");
      if (["reconcile", "acknowledge-escalation", "resolve-escalation"].includes(action)) void loadCommunity(communityStatus);
      void loadWorkSummary();
    } catch (error) {
      toast.error(errorMessage(error, `Could not ${action} this community item`));
    } finally {
      setCommunityActionId("");
    }
  };

  const approvalDraftCount = actionableDraftCount(calendarDrafts);
  const activeManualActionCount = manualActions.filter((item) => ["OPEN", "IN_PROGRESS"].includes(item.status)).length;
  const weeklyLinked = Boolean(draft?.weeklyPlanId || weeklyPlan?.items.some((item) => item.draftId === draft?.id));
  const companionStoryForDraft = draft?.bundleRole === "PARENT_FEED"
    ? weeklyPlan?.storyPlan.find((story) => story.bundleRole === "COMPANION_STORY" && (
      (draft.bundleId && story.bundleId === draft.bundleId)
      || (draft.candidateId && story.parentCandidateId === draft.candidateId)
    ))
    : null;
  useEffect(() => {
    const requestNumber = companionDraftRequestRef.current + 1;
    companionDraftRequestRef.current = requestNumber;
    setCompanionDraft(null);
    setCompanionDraftError("");
    if (!reviewDrawerOpen || draft?.bundleRole !== "PARENT_FEED") {
      setCompanionDraftLoading(false);
      return;
    }
    if (!companionStoryForDraft?.draftId) {
      setCompanionDraftLoading(false);
      return;
    }
    setCompanionDraftLoading(true);
    void apiFetch(`${API_BASE}/drafts/${encodeURIComponent(companionStoryForDraft.draftId)}`)
      .then((response) => {
        if (companionDraftRequestRef.current !== requestNumber) return;
        const loaded = responseDraft(response);
        if (!loaded || loaded.id !== companionStoryForDraft.draftId) throw new Error("The companion Story detail response was incomplete");
        if (loaded.bundleRole !== "COMPANION_STORY" || (draft.bundleId && loaded.bundleId !== draft.bundleId)) {
          throw new Error("The loaded Story does not belong to this feed bundle");
        }
        setCompanionDraft(loaded);
      })
      .catch((error) => {
        if (companionDraftRequestRef.current !== requestNumber) return;
        setCompanionDraftError(errorMessage(error, "Could not load the companion Story for final review"));
      })
      .finally(() => {
        if (companionDraftRequestRef.current === requestNumber) setCompanionDraftLoading(false);
      });
  }, [companionStoryForDraft?.draftId, draft?.bundleId, draft?.bundleRole, draft?.id, reviewDrawerOpen]);
  const companionCompliancePassed = companionDraft?.compliance?.passed === true
    || String(companionDraft?.compliance?.decision || companionDraft?.compliance?.status || "").toUpperCase() === "PASS";
  const companionHasFinalMedia = Boolean(companionDraft?.assets.some((asset) => (
    !asset.role.toUpperCase().includes("ORIGINAL")
    && Boolean(asset.finalUrl || asset.url)
    && asset.status.toLowerCase() !== "invalid"
    && asset.manualReviewStatus.toLowerCase() !== "rejected"
  )));
  const companionStoryReady = draft?.bundleRole !== "PARENT_FEED" || Boolean(
    companionStoryForDraft?.draftId
    && String(companionStoryForDraft.status).toUpperCase() === "NEEDS_REVIEW"
    && companionDraft
    && companionDraft.bundleRole === "COMPANION_STORY"
    && String(companionDraft.status).toUpperCase() === "NEEDS_REVIEW"
    && String(companionDraft.primary.format).toUpperCase() === "STORY"
    && companionDraft.primary.storyFrames.length > 0
    && companionCompliancePassed
    && companionHasFinalMedia
    && !companionDraftLoading
    && !companionDraftError,
  );
  const fallbackCommunityCount = communityItems.filter((item) => ["OPEN", "RECOMMENDED", "RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING", "SEND_UNCERTAIN", "ESCALATION_REQUIRED"].includes(String(item.status).toUpperCase())).length;
  const contentBreakdown = workSummary?.breakdown.content && typeof workSummary.breakdown.content === "object" ? workSummary.breakdown.content as Record<string, unknown> : {};
  const generatingWaitingCount = Number(contentBreakdown.generating_waiting || contentBreakdown.generatingWaiting || 0);
  const generationRecoveryDrafts = calendarDrafts.filter((item) => String(item.status).toUpperCase() === "DRAFT");
  const backgroundGeneratingCount = Math.max(0, generatingWaitingCount - generationRecoveryDrafts.length);
  const contentFailureItems = workSummary?.terminalFailures.content || [];
  const resultFailureItems = workSummary?.terminalFailures.results || [];
  const countFor = (key: keyof SocialWorkSummary["counts"], fallback = 0) => workSummary ? workSummary.counts[key] : fallback;
  const tabItems: Array<{ value: WorkspaceTab; label: string; icon: typeof Sparkles; count?: number }> = [
    { value: "strategy", label: "Strategy", icon: Sparkles, count: countFor("strategy", String(weeklyPlan?.status).toUpperCase() === "NEEDS_REVIEW" || String(weeklyPlan?.status).startsWith("FAILED") ? 1 : 0) },
    { value: "content", label: "Content", icon: Images, count: countFor("content", approvalDraftCount + activeManualActionCount) },
    { value: "results", label: "Results", icon: BarChart3, count: countFor("results", analyticsError ? 1 : 0) },
    { value: "community", label: "Community", icon: MessageCircle, count: countFor("community", fallbackCommunityCount) },
    { value: "setup", label: "Setup", icon: Settings2, count: countFor("setup", connections?.blockers.length || 0) },
  ];

  const todayProps = {
    draft,
    previousDraft,
    generationRun,
    readiness,
    loading: loadingToday,
    generating,
    busyAction,
    dirty,
    loadError: todayError,
    onGenerate: (request: SocialGenerationRequest) => void generate(request),
    onReload: reloadToday,
    onRecommendationChange: updateRecommendation,
    onScheduleChange: updateSchedule,
    onSave: () => void saveDraft(),
    onAction: (action: SocialDraftAction, payload?: Record<string, unknown>) => void lifecycleAction(action, payload),
    onAdoptAlternative: adoptAlternative,
    onExport: exportPackage,
    weeklyLinked,
    companionStoryReady,
    companionDraft,
    companionLoading: companionDraftLoading,
    companionError: companionDraftError,
    reviewSupplementContent: draft && ["REEL", "VIDEO_FEED"].includes(String(draft.primary.format).toUpperCase()) ? <SocialAudioLibrary draft={draft} busy={busyAction === "audio-track"} onApplyToReel={(trackId) => void lifecycleAction("audio-track", { audio_track_id: trackId || null })} /> : null,
    defaultVisualMode: settings.defaultVisualMode,
  };

  const changeReviewDrawerOpen = (open: boolean) => {
    reviewSessionActiveRef.current = open;
    setReviewDrawerOpen(open);
    if (!open) {
      setReviewSessionPlanId("");
      setPendingReviewDraftId("");
      setReviewQueueNavigation(emptyReviewQueueNavigation());
    }
  };

  const openReviewedCalendar = () => {
    reviewSessionActiveRef.current = false;
    setReviewDrawerOpen(false);
    setReviewSessionPlanId("");
    setPendingReviewDraftId("");
    setReviewQueueNavigation(emptyReviewQueueNavigation());
    setActiveTab("content");
    setContentView("calendar");
  };

  return (
    <>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WorkspaceTab)} className="space-y-5">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start gap-1 rounded-xl p-1">
            {tabItems.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="gap-2 rounded-lg px-3 py-2">
                <item.icon className="h-4 w-4" /> {item.label}
                {item.count ? <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{item.count}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="strategy" className="mt-0 space-y-6">
          <SocialWeeklyStrategyView plan={weeklyPlan} loading={weeklyPlanLoading} action={weeklyPlanAction} error={weeklyPlanError} onReload={() => void loadWeeklyPlan()} onGenerate={() => void generateWeeklyPlan()} onApprove={() => void reviewWeeklyPlan("approve")} onReject={() => void reviewWeeklyPlan("reject")} onProduce={(item) => void produceWeeklyPost(item)} onOpenDraft={(draftId) => void openDraftById(draftId)} onReplaceSlot={replaceWeeklySlot} />
          <details className="rounded-3xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-semibold">Research evidence</summary>
            <div className="mt-6"><SocialResearchDeskView research={weeklyResearch} draft={draft} loading={weeklyResearchLoading} error={weeklyResearchError} onReload={() => void loadWeeklyResearch()} /></div>
          </details>
        </TabsContent>

        <TabsContent value="content" className="mt-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Creation and review</p><h2 className="mt-1 font-serif text-3xl">Content</h2><p className="mt-2 text-sm text-muted-foreground">Open any item in the same review drawer; approval and scheduling happen together.</p></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Content view">
              <Button size="sm" variant={contentView === "list" ? "default" : "outline"} onClick={() => setContentView("list")}>List</Button>
              <Button size="sm" variant={contentView === "calendar" ? "default" : "outline"} onClick={() => setContentView("calendar")}>Calendar</Button>
              <Button size="sm" variant={contentView === "create" ? "default" : "outline"} onClick={() => setContentView("create")}><Sparkles className="h-4 w-4" /> Create one-off</Button>
            </div>
          </div>
          {contentView === "list" ? <div className="space-y-8">
            <SocialApprovalQueueView drafts={calendarDrafts} loading={calendarLoading} error={calendarError} filter={approvalFilter} onFilterChange={setApprovalFilter} onReload={() => void loadCalendar()} onOpenDraft={(item) => void openDraft(item)} />
            {contentFailureItems.length ? <section aria-label="Creative failures needing recovery" className="border-t border-border pt-8"><Card className="rounded-3xl border-destructive/25 shadow-none"><CardHeader><div className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /><CardTitle className="font-serif text-2xl">Creative failures needing recovery</CardTitle></div><CardDescription>Each unresolved failure remains actionable until it is retried or dismissed. Dismissal hides it from the queue while preserving its evidence and audit history.</CardDescription></CardHeader><CardContent className="space-y-3">{contentFailureItems.map((item) => {
              const runId = item.generationRunId || item.id;
              const canRecoverGeneration = item.recoveryAvailable === true;
              const retrying = busyAction === `retry-summary-run:${runId}`;
              const archiving = busyAction === `archive-summary-run:${runId}`;
              return <div key={`${item.type}:${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-4"><div className="min-w-0 flex-1"><p className="font-medium">{item.code || `${item.type.replace(/_/g, " ")} failed`}</p><p className="mt-1 text-sm text-muted-foreground">{item.message || "The creative run ended without a completed draft."}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{runId}</p></div><div className="flex flex-wrap gap-2">{item.draftId ? <Button variant="outline" onClick={() => void openDraftById(item.draftId)}>Open draft</Button> : null}{canRecoverGeneration ? <><Button variant="outline" onClick={() => void retrySummaryGenerationRun(runId)} disabled={retrying || archiving}><RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Retry generation</Button><Button variant="ghost" onClick={() => void archiveSummaryGenerationFailure(runId)} disabled={retrying || archiving}><Archive className="h-4 w-4" /> {archiving ? "Dismissing…" : "Dismiss failure"}</Button></> : null}</div></div>;
            })}{workSummary?.terminalFailuresTruncated.content ? <p className="text-xs text-muted-foreground">Only the five most recent actionable failures are shown. Dismissed and older failures remain in append-only audit history.</p> : null}</CardContent></Card></section> : null}
            <div className="border-t border-border pt-8"><SocialManualActionsPanel actions={manualActions} loading={manualActionsLoading} error={manualActionsError} actionId={manualActionId} onReload={() => void loadManualActions()} onOpenDraft={(draftId) => void openDraftById(draftId)} onUpdate={updateManualAction} /></div>
            {generationRecoveryDrafts.length || backgroundGeneratingCount ? <section aria-label="Generation recovery" className="border-t border-border pt-8"><Card className="rounded-3xl shadow-none"><CardHeader><CardTitle className="font-serif text-2xl">Generating &amp; waiting</CardTitle><CardDescription>Low-priority recovery work appears after human review and manual actions.</CardDescription></CardHeader><CardContent className="space-y-3">{generationRecoveryDrafts.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 p-4"><div><p className="font-medium">{item.primary.internalTitle || item.primary.topic || "Creative awaiting generation"}</p><p className="mt-1 text-xs text-muted-foreground">A required creative generation action is waiting. Open the draft to generate fresh validated media.</p></div><Button variant="outline" onClick={() => void openDraft(item)}>Open generation action</Button></div>)}{backgroundGeneratingCount ? <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 text-sm text-muted-foreground">{backgroundGeneratingCount} creative{backgroundGeneratingCount === 1 ? " is" : "s are"} generating or waiting for a required generation action. Ready items will move into the review queue automatically.</div> : null}</CardContent></Card></section> : null}
          </div> : null}
          {contentView === "calendar" ? <SocialCalendarView drafts={calendarDrafts} loading={calendarLoading} filter={calendarFilter} onFilterChange={setCalendarFilter} onOpenDraft={(item) => void openDraft(item)} /> : null}
          {contentView === "create" ? <div className="space-y-5"><SocialToday {...todayProps} />{["REEL", "VIDEO_FEED"].includes(String(draft?.primary.format || "").toUpperCase()) ? <SocialAudioLibrary draft={draft} busy={busyAction === "audio-track"} onApplyToReel={(trackId) => void lifecycleAction("audio-track", { audio_track_id: trackId || null })} /> : null}</div> : null}
        </TabsContent>

        <TabsContent value="results" className="mt-0 space-y-6">
          {resultFailureItems.length ? <section aria-label="Publishing failures"><Card className="rounded-3xl border-destructive/25 shadow-none"><CardHeader><div className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /><CardTitle className="font-serif text-2xl">Publishing outcomes needing attention</CardTitle></div><CardDescription>Uncertain outcomes are never retried blindly. Confirm the existing Meta media ID below; Pink Paisa will reconcile its records without republishing.</CardDescription></CardHeader><CardContent className="space-y-3">{resultFailureItems.map((item) => <PublicationFailureRecovery key={`${item.type}:${item.id}`} item={item} busy={busyAction === `reconcile-publication:${item.publicationId || item.id}`} onOpenDraft={(draftId) => void openDraftById(draftId)} onOpenActions={() => { setActiveTab("content"); setContentView("list"); }} onReconcile={(failure, payload) => void reconcilePublicationFailure(failure, payload)} />)}{workSummary?.terminalFailuresTruncated.results ? <p className="text-xs text-muted-foreground">Only the five most recent failures are shown. Older failures remain in audit history.</p> : null}</CardContent></Card></section> : null}
          <SocialPublishedAnalyticsView summary={analyticsSummary} loading={analyticsLoading} refreshing={analyticsRefreshing} error={analyticsError} onReload={() => void loadAnalytics()} onRefresh={() => void refreshAnalytics()}>
            <SocialPerformanceView draft={draft} drafts={calendarDrafts} submitting={metricsSubmitting} onSelectDraft={(item) => void openDraft(item, false)} onSubmit={(payload) => void submitMetrics(payload)} />
          </SocialPublishedAnalyticsView>
        </TabsContent>
        <TabsContent value="community" className="mt-0">
          <SocialCommunityInboxView items={communityItems} loading={communityLoading} error={communityError} filter={communityStatus} actionId={communityActionId} onFilterChange={changeCommunityStatus} onReload={() => void loadCommunity()} onAction={(item, action, payload) => void communityAction(item, action, payload || {})} />
        </TabsContent>
        <TabsContent value="setup" className="mt-0 space-y-8">
          <SocialConnectionsView snapshot={connections} loading={connectionsLoading} checking={connectionsChecking} error={connectionsError} onReload={() => void loadConnections()} onCheck={() => void checkConnections()} />
          <div className="border-t border-border pt-8"><SocialSettingsView settings={settings} readiness={settingsReadiness} loading={settingsLoading} saving={settingsSaving} onChange={setSettings} onSave={() => void saveSettings()} /></div>
          <SocialAudioLibrary showUploader />
          <details className="rounded-3xl border border-destructive/20 bg-card p-5">
            <summary className="cursor-pointer text-sm font-semibold text-destructive">Advanced · generated-content cleanup</summary>
            <div className="mt-5"><SocialGeneratedContentCleanup onDeleted={resetAfterGeneratedContentCleanup} /></div>
          </details>
        </TabsContent>
      </Tabs>
      <SocialDraftReviewDrawer open={reviewDrawerOpen && Boolean(draft)} onOpenChange={changeReviewDrawerOpen} draft={draft} todayProps={todayProps} queueNavigation={reviewQueueNavigation} onOpenCalendar={openReviewedCalendar} onOpenFailureDraft={(draftId) => void openDraftById(draftId, true, reviewSessionPlanId)} />
    </>
  );
};

export default SocialMediaManager;
