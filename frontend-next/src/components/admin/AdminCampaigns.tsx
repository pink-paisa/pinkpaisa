import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { EmptyState, LoadingSpinner, StatusBadge } from "./AdminShared";
import { AlertTriangle, Archive, CalendarDays, CheckCircle2, Copy, Eye, ExternalLink, Link as LinkIcon, Maximize2, RotateCcw, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import InstagramConnectionPanel from "./InstagramConnectionPanel";
import CampaignAutomationPanel, {
  DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY,
  DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
  type CampaignAutomationSettings,
  type CampaignImageProviderRegistry,
} from "./CampaignAutomationPanel";
import CampaignCreativePreview from "./CampaignCreativePreview";
import CampaignPostLightbox, { type CampaignPostPreview } from "./CampaignPostLightbox";
import CampaignPublishActions from "./CampaignPublishActions";
import CampaignQueueHealth, { type CampaignQueueHealthData } from "./CampaignQueueHealth";
import CampaignTimeline, { type CampaignPublishEvent, type CampaignTask } from "./CampaignTimeline";
import { useCampaignPolling } from "@/hooks/useCampaignPolling";

type TaskCounts = { queued?: number; running?: number; completed?: number; failed?: number; cancelled?: number };
type PublishReadinessIssue = { code: string; message: string };
type PublishReadiness = {
  can_publish: boolean;
  blockers: PublishReadinessIssue[];
  warnings: PublishReadinessIssue[];
  checked_at?: string | null;
};
type CampaignRun = {
  id: string;
  campaign_id: string;
  source_event?: string | null;
  batch_key: string | null;
  product_title: string | null;
  product_slug: string | null;
  vendor_shop_name: string | null;
  is_affiliate?: boolean;
  affiliate_url?: string | null;
  affiliate_external_id?: string | null;
  affiliate_source_platform?: string | null;
  affiliate_source_mode?: string | null;
  status: string;
  current_stage: string;
  review_stage: string | null;
  review_notes: string | null;
  review_status: string | null;
  content_type?: string | null;
  cta_text?: string | null;
  asset_urls?: string[];
  product_image_url?: string | null;
  product_gallery_urls?: string[];
  approved_at: string | null;
  updated_at: string | null;
  publish_status?: string | null;
  scheduled_for?: string | null;
  published_at?: string | null;
  instagram_media_id?: string | null;
  instagram_permalink?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  next_action?: string | null;
  last_error: string | null;
  publish_readiness?: PublishReadiness | null;
  brief_json?: {
    primary_image?: string | null;
    images?: string[] | null;
    is_affiliate?: boolean;
    affiliate_url?: string | null;
    affiliate_external_id?: string | null;
    affiliate_source_platform?: string | null;
    affiliate_source_mode?: string | null;
    affiliate?: {
      url?: string | null;
      external_id?: string | null;
      source_platform?: string | null;
      source_mode?: string | null;
      source_label?: string | null;
    } | null;
  } | null;
  creative_json?: {
    primary_asset_url?: string | null;
    asset_urls?: string[] | null;
  } | null;
  compliance_json?: { status?: string } | null;
  tracking_json?: {
    links?: { instagram_feed?: string };
    publish_payload?: { tracked_url?: string; asset_urls?: string[]; caption?: string };
  } | null;
  task_counts?: TaskCounts;
};
type BatchRun = {
  id: string;
  batch_key: string;
  batch_date_ist: string;
  status: string;
  total_runs: number;
  success_count: number;
  failed_count: number;
  started_at: string | null;
  finished_at: string | null;
};
type ConnectionSummary = {
  status: string;
  is_connected: boolean;
  login_type?: string | null;
  account_type?: string | null;
  facebook_page_name?: string | null;
  instagram_username?: string | null;
  instagram_name?: string | null;
  profile_picture_url?: string | null;
  last_connected_at?: string | null;
  last_error?: string | null;
};
type CatalogProduct = {
  id: string;
  title: string;
  slug?: string | null;
  source_type?: "admin" | "vendor" | null;
  status?: string | null;
  is_visible?: boolean;
  is_affiliate?: boolean;
  featured_image?: string | null;
  price?: number | null;
  sale_price?: number | null;
  category?: string | null;
  subcategory?: string | null;
  affiliate_is_instagram_pick?: boolean;
  affiliate_compliance_status?: string | null;
  affiliate_link_check_status?: string | null;
  readiness_status?: "ready" | "warning" | "blocked" | string;
  readiness?: {
    can_queue: boolean;
    status: string;
    blockers: PublishReadinessIssue[];
    warnings: PublishReadinessIssue[];
  };
};

const DEFAULT_CAMPAIGN_SETTINGS: CampaignAutomationSettings = {
  campaign_mode: "manual",
  campaign_batch_hour_ist: 9,
  campaign_batch_minute_ist: 0,
  campaign_creative_mode: "template",
  campaign_ai_provider: "openai",
  campaign_ai_model: "",
  campaign_ai_image_quality: "medium",
  campaign_ai_prompt_template: DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
};
type CampaignListResponse = {
  items: CampaignRun[];
  counts: {
    queued: number;
    batch_running: number;
    waiting_review: number;
    approved_for_publish: number;
    scheduled: number;
    publishing: number;
    published: number;
    failed: number;
    rejected: number;
    archived: number;
    ready_to_post?: number;
    blocked?: number;
    affiliate?: number;
  };
  latest_batch: BatchRun | null;
  pagination: { page: number; limit: number; total: number; total_pages: number };
};
type CampaignDetailResponse = {
  run: CampaignRun & {
    brief_json?: unknown;
    strategy_json?: unknown;
    creative_json?: {
      content_type?: string;
      cta_text?: string;
      primary_asset_url?: string;
      asset_urls?: string[];
      creative_json?: {
        headline?: string;
        supporting_line?: string;
        slides?: Array<{ url?: string }>;
      };
    } | null;
    caption_json?: {
      instagram?: {
        short_caption?: string;
        long_caption?: string;
        hashtags?: string[];
        cta?: string;
      };
    } | null;
    compliance_json?: unknown;
    tracking_json?: {
      links?: { instagram_feed?: string };
      publish_payload?: { tracked_url?: string; asset_urls?: string[]; caption?: string };
    } | null;
  };
  batch: BatchRun | null;
  tasks: CampaignTask[];
  publish_events?: CampaignPublishEvent[];
};
type CatalogProductListResponse = {
  items: CatalogProduct[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
};
type CalendarEntry = {
  date: string;
  run: CampaignRun;
  warnings: PublishReadinessIssue[];
};
type CampaignCalendarResponse = {
  from: string;
  to: string;
  entries: CalendarEntry[];
  grouped: Record<string, CalendarEntry[]>;
};
type BatchDetailResponse = {
  batch: BatchRun;
  summary: { queued: number; running: number; completed: number; failed: number; stuck: number };
  runs: CampaignRun[];
};

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="max-h-72 overflow-auto rounded-2xl bg-[#fff8fa] p-4 text-xs leading-6 text-[#6b4b57]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

const EMPTY_PLACEHOLDER = "-";

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return EMPTY_PLACEHOLDER;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? EMPTY_PLACEHOLDER : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const canBulkPublishRun = (run: CampaignRun) => (
  run.publish_readiness?.can_publish === true
  && run.review_status === "approved"
  && ["ready", "draft", "failed", "scheduled"].includes(run.publish_status || "")
);

const canSelectCampaignRun = (run: CampaignRun) => (
  !run.archived_at
  && run.status !== "publishing"
  && run.publish_status !== "publishing"
);

const getReadinessBlockers = (run: CampaignRun | null | undefined) => run?.publish_readiness?.blockers || [];

const getProductImageUrl = (run: CampaignRun) => {
  const images = Array.isArray(run.brief_json?.images) ? run.brief_json?.images : [];
  const fallbackImages = Array.isArray(run.product_gallery_urls) ? run.product_gallery_urls : [];
  return run.brief_json?.primary_image || images?.find(Boolean) || run.product_image_url || fallbackImages.find(Boolean) || null;
};

const getCreativeAssetUrls = (run: CampaignRun) => Array.from(new Set([
  ...(run.tracking_json?.publish_payload?.asset_urls || []),
  ...(run.asset_urls || []),
  ...(run.creative_json?.asset_urls || []),
  run.creative_json?.primary_asset_url || "",
].map((url) => String(url || "").trim()).filter(Boolean)));

const getCreativeImageUrl = (run: CampaignRun) => getCreativeAssetUrls(run)[0] || null;

const getCampaignTrackedUrl = (run: CampaignRun) => (
  run.tracking_json?.links?.instagram_feed
  || run.tracking_json?.publish_payload?.tracked_url
  || null
);

const getCatalogSourceLabel = (product: CatalogProduct) => {
  if (product.is_affiliate) return "Affiliate";
  return (product.source_type || "admin") === "vendor" ? "Vendor-backed" : "Admin";
};

const getCampaignSourceLabel = (run: CampaignRun) => {
  if (run.is_affiliate || run.source_event === "affiliate_product.published") return "Affiliate";
  if (run.source_event === "product.approved") return "Vendor-backed";
  return "Admin";
};

const getAffiliateUrl = (run: CampaignRun) => run.affiliate_url || run.brief_json?.affiliate_url || run.brief_json?.affiliate?.url || null;

const getAffiliateExternalId = (run: CampaignRun) => run.affiliate_external_id || run.brief_json?.affiliate_external_id || run.brief_json?.affiliate?.external_id || null;

const getAffiliateSourcePlatform = (run: CampaignRun) => run.affiliate_source_platform || run.brief_json?.affiliate_source_platform || run.brief_json?.affiliate?.source_platform || null;

const getAffiliateSourceMode = (run: CampaignRun) => run.affiliate_source_mode || run.brief_json?.affiliate_source_mode || run.brief_json?.affiliate?.source_mode || null;

const truncateText = (value: string | null | undefined, maxLength = 140) => {
  if (!value) return EMPTY_PLACEHOLDER;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
};

const hasAffiliateDisclosureText = (value: string | null | undefined) => (
  /affiliate disclosure/i.test(value || "")
  || /amazon associate/i.test(value || "")
  || /#commissions?earned/i.test(value || "")
);

const getHashtagCount = (value: string | null | undefined) => {
  const matches = String(value || "").match(/#[\w]+/g);
  return matches?.length || 0;
};

const isPublicHttpsUrl = (value: string | null | undefined) => {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const getQuickFilterParams = (quickFilter: string): Record<string, string> => {
  if (quickFilter === "needs_review") return { status: "waiting_review" };
  if (quickFilter === "ready") return { readiness: "ready" };
  if (quickFilter === "blocked") return { readiness: "blocked" };
  if (quickFilter === "scheduled") return { status: "scheduled" };
  if (quickFilter === "published") return { status: "published" };
  if (quickFilter === "failed") return { status: "failed" };
  if (quickFilter === "affiliate") return { affiliate_only: "true" };
  if (quickFilter === "archived") return { include_archived: "only" };
  return {};
};

const AdminCampaigns = () => {
  const [data, setData] = useState<CampaignListResponse>({
    items: [],
    counts: {
      queued: 0,
      batch_running: 0,
      waiting_review: 0,
      approved_for_publish: 0,
      scheduled: 0,
      publishing: 0,
      published: 0,
      failed: 0,
      rejected: 0,
      archived: 0,
      ready_to_post: 0,
      blocked: 0,
      affiliate: 0,
    },
    latest_batch: null,
    pagination: { page: 1, limit: 10, total: 0, total_pages: 1 },
  });
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [queueHealth, setQueueHealth] = useState<CampaignQueueHealthData | null>(null);
  const [campaignSettings, setCampaignSettings] = useState<CampaignAutomationSettings>(DEFAULT_CAMPAIGN_SETTINGS);
  const [imageRegistry, setImageRegistry] = useState<CampaignImageProviderRegistry>(DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [quickFilter, setQuickFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogDebouncedSearch, setCatalogDebouncedSearch] = useState("");
  const [catalogSource, setCatalogSource] = useState("all");
  const [catalogReadiness, setCatalogReadiness] = useState("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPagination, setCatalogPagination] = useState({ page: 1, limit: 24, total: 0, total_pages: 1 });
  const [selectedCatalogProductIds, setSelectedCatalogProductIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<CampaignDetailResponse | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewDialogAction, setReviewDialogAction] = useState<"approve" | "reject" | null>(null);
  const [reviewDialogNotes, setReviewDialogNotes] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [queueProductId, setQueueProductId] = useState("");
  const [draftLongCaption, setDraftLongCaption] = useState("");
  const [draftShortCaption, setDraftShortCaption] = useState("");
  const [draftHashtags, setDraftHashtags] = useState("");
  const [draftCta, setDraftCta] = useState("");
  const [regenerateStage, setRegenerateStage] = useState("creative");
  const [calendar, setCalendar] = useState<CampaignCalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [batchDetail, setBatchDetail] = useState<BatchDetailResponse | null>(null);
  const [batchDetailLoading, setBatchDetailLoading] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"archive" | "restore" | "purge" | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [postPreview, setPostPreview] = useState<CampaignPostPreview | null>(null);
  const previousDetailState = useRef<string | null>(null);
  const previousListStates = useRef<Map<string, string>>(new Map());

  const loadCatalogProducts = async () => {
    try {
      setCatalogLoading(true);
      const params = new URLSearchParams({
        search: catalogDebouncedSearch,
        page: String(catalogPage),
        limit: "24",
        source: catalogSource,
        readiness: catalogReadiness,
      });
      const response = await apiFetch<CatalogProductListResponse>(`/marketing-campaigns/admin/catalog-products?${params.toString()}`);
      setCatalogProducts(response.items || []);
      setCatalogPagination(response.pagination || { page: 1, limit: 24, total: 0, total_pages: 1 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load catalog products");
    } finally {
      setCatalogLoading(false);
    }
  };

  const loadCampaigns = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);
      const quickParams = getQuickFilterParams(quickFilter);
      const params = new URLSearchParams({
        search: debouncedSearch,
        status: quickParams.status || status,
        page: String(page),
        limit: "10",
      });
      if (quickParams.readiness) params.set("readiness", quickParams.readiness);
      if (quickParams.affiliate_only) params.set("affiliate_only", quickParams.affiliate_only);
      if (quickParams.include_archived) params.set("include_archived", quickParams.include_archived);
      const response = await apiFetch<CampaignListResponse>(`/marketing-campaigns/admin?${params.toString()}`);
      setData(response);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Could not load campaign runs");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadConnection = async () => {
    try {
      setConnectionLoading(true);
      const response = await apiFetch<ConnectionSummary>("/instagram/admin/connection");
      setConnection(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Instagram connection");
    } finally {
      setConnectionLoading(false);
    }
  };

  const loadCampaignSettings = async () => {
    try {
      setSettingsLoading(true);
      const response = await apiFetch<CampaignAutomationSettings>("/admin/settings/campaigns");
      setCampaignSettings(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load campaign settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadImageRegistry = async () => {
    try {
      const response = await apiFetch<CampaignImageProviderRegistry>("/admin/settings/campaigns/image-models");
      setImageRegistry(response);
      setCampaignSettings((current) => ({
        ...current,
        campaign_ai_provider: current.campaign_ai_provider || response.defaults.provider,
        campaign_ai_model: current.campaign_ai_model || response.defaults.model,
      }));
    } catch {
      setImageRegistry(DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY);
      setCampaignSettings((current) => ({
        ...current,
        campaign_ai_provider: current.campaign_ai_provider || DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY.defaults.provider,
        campaign_ai_model: current.campaign_ai_model || DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY.defaults.model,
      }));
    }
  };

  const loadQueueHealth = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      const response = await apiFetch<CampaignQueueHealthData>("/marketing-campaigns/admin/queue-health");
      setQueueHealth(response);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Could not load marketing worker health");
    }
  };

  const loadCalendar = async () => {
    try {
      setCalendarLoading(true);
      const to = new Date();
      to.setDate(to.getDate() + 21);
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const response = await apiFetch<CampaignCalendarResponse>(`/marketing-campaigns/admin/calendar?${params.toString()}`);
      setCalendar(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load campaign calendar");
    } finally {
      setCalendarLoading(false);
    }
  };

  const loadBatchDetail = async () => {
    if (!data.latest_batch?.id) {
      toast.info("No daily batch is available yet");
      return;
    }
    try {
      setBatchDetailLoading(true);
      const response = await apiFetch<BatchDetailResponse>(`/marketing-campaigns/admin/batches/${data.latest_batch.id}`);
      setBatchDetail(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load batch detail");
    } finally {
      setBatchDetailLoading(false);
    }
  };

  const loadDetail = async (id: string, { silent = false, open = true }: { silent?: boolean; open?: boolean } = {}) => {
    try {
      if (!silent) setDetailLoading(true);
      setSelectedId(id);
      if (open) setDetailOpen(true);
      const response = await apiFetch<CampaignDetailResponse>(`/marketing-campaigns/admin/${id}`);
      setDetail(response);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Could not load campaign detail");
      if (open) setDetailOpen(false);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    loadCampaigns();
  }, [debouncedSearch, status, quickFilter, page]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCatalogDebouncedSearch(catalogSearch);
      setCatalogPage(1);
    }, 350);
    return () => clearTimeout(timeout);
  }, [catalogSearch]);

  useEffect(() => {
    loadConnection();
    loadQueueHealth();
    loadCampaignSettings();
    loadImageRegistry();
    loadCalendar();
    const params = new URLSearchParams(window.location.search);
    const instagramStatus = params.get("instagram");
    const message = params.get("message");
    if (instagramStatus) {
      if (instagramStatus === "connected") toast.success(message || "Instagram connected");
      if (instagramStatus === "error") toast.error(message || "Instagram connection failed");
      params.delete("instagram");
      params.delete("message");
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    const instagram = detail?.run.caption_json?.instagram;
    setDraftLongCaption(instagram?.long_caption || "");
    setDraftShortCaption(instagram?.short_caption || "");
    setDraftHashtags((instagram?.hashtags || []).join(", "));
    setDraftCta(detail?.run.cta_text || instagram?.cta || "");
  }, [detail]);

  useEffect(() => {
    setSelectedRunIds((current) => current.filter((id) => data.items.some((run) => run.id === id && canSelectCampaignRun(run))));
  }, [data.items]);

  useEffect(() => {
    if (!catalogOpen) return;
    loadCatalogProducts();
  }, [catalogOpen, catalogDebouncedSearch, catalogSource, catalogReadiness, catalogPage]);

  const detailPollingActive = Boolean(
    detailOpen
    && selectedId
    && detail?.run
    && ["queued", "running", "batch_running", "publishing", "scheduled"].includes(detail.run.status)
  );

  useCampaignPolling({
    pollList: () => Promise.all([loadCampaigns({ silent: true }), loadQueueHealth({ silent: true })]).then(() => undefined),
    pollDetail: () => selectedId ? loadDetail(selectedId, { silent: true, open: false }) : undefined,
    detailEnabled: detailPollingActive,
  });

  useEffect(() => {
    if (!detail?.run) return;
    const stateKey = `${detail.run.id}:${detail.run.status}:${detail.run.publish_status || ""}`;
    if (previousDetailState.current && previousDetailState.current !== stateKey) {
      if (detail.run.status === "waiting_review") {
        toast.success(`${detail.run.product_title || "Campaign"} is ready for review`);
      }
      if (detail.run.status === "failed" || detail.run.publish_status === "failed") {
        toast.error(`${detail.run.product_title || "Campaign"} needs attention`);
      }
    }
    previousDetailState.current = stateKey;
  }, [detail?.run.id, detail?.run.product_title, detail?.run.publish_status, detail?.run.status]);

  useEffect(() => {
    const previous = previousListStates.current;
    const next = new Map<string, string>();
    data.items.forEach((run) => {
      const state = `${run.status}:${run.publish_status || ""}`;
      const prior = previous.get(run.id);
      if (prior && prior !== state && !(detailOpen && selectedId === run.id)) {
        if (run.status === "waiting_review") toast.success(`${run.product_title || "Campaign"} is ready for review`);
        if (run.status === "failed" || run.publish_status === "failed") toast.error(`${run.product_title || "Campaign"} needs attention`);
      }
      next.set(run.id, state);
    });
    previousListStates.current = next;
  }, [data.items, detailOpen, selectedId]);

  const selectableVisibleRuns = useMemo(() => data.items.filter(canSelectCampaignRun), [data.items]);
  const selectedVisibleRuns = useMemo(
    () => data.items.filter((run) => selectedRunIds.includes(run.id)),
    [data.items, selectedRunIds],
  );
  const selectedRunBlockers = useMemo(() => (
    selectedVisibleRuns.flatMap((run) => getReadinessBlockers(run).map((blocker) => ({
      run,
      blocker,
    })))
  ), [selectedVisibleRuns]);
  const selectedRunsCarouselEligible = selectedVisibleRuns.length === selectedRunIds.length
    && selectedVisibleRuns.length >= 2
    && selectedVisibleRuns.length <= 10
    && selectedVisibleRuns.every(canBulkPublishRun);
  const selectedPublishedCount = selectedVisibleRuns.filter((run) => (
    run.publish_status === "published" || run.status === "published" || Boolean(run.instagram_media_id)
  )).length;
  const allSelectableVisibleSelected = selectableVisibleRuns.length > 0 && selectableVisibleRuns.every((run) => selectedRunIds.includes(run.id));
  const filteredCatalogProducts = useMemo(() => {
    return catalogProducts;
  }, [catalogProducts]);
  const allFilteredCatalogSelected = filteredCatalogProducts.length > 0 && filteredCatalogProducts.every((product) => selectedCatalogProductIds.includes(product.id));

  const refreshDetail = async () => {
    if (!selectedId) return;
    await loadDetail(selectedId);
  };

  const refreshAll = async () => {
    await Promise.all([loadCampaigns(), loadConnection(), loadQueueHealth(), loadCampaignSettings(), loadImageRegistry(), loadCalendar(), selectedId ? refreshDetail() : Promise.resolve()]);
  };

  const openPostPreview = (run: CampaignRun, startIndex = 0) => {
    const assetUrls = getCreativeAssetUrls(run);
    if (!assetUrls.length) {
      toast.info("The generated creative is not available yet");
      return;
    }
    setPostPreview({
      title: run.product_title || "Campaign creative",
      assetUrls,
      startIndex,
      contentType: run.content_type || null,
      ctaText: run.cta_text || null,
      trackedUrl: getCampaignTrackedUrl(run),
    });
  };

  const handleConnectInstagram = async () => {
    try {
      setActionLoading(true);
      const response = await apiFetch<{ auth_url: string }>("/instagram/admin/connect/start", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.href = response.auth_url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Instagram connection");
      setActionLoading(false);
    }
  };

  const handleDisconnectInstagram = async () => {
    try {
      setActionLoading(true);
      await apiFetch("/instagram/admin/connection", {
        method: "DELETE",
      });
      toast.success("Instagram connection removed");
      await loadConnection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect Instagram");
    } finally {
      setActionLoading(false);
    }
  };

  const saveCampaignSettings = async () => {
    try {
      setActionLoading(true);
      const response = await apiFetch<CampaignAutomationSettings & { message?: string }>("/admin/settings/campaigns", {
        method: "PUT",
        body: JSON.stringify(campaignSettings),
      });
      setCampaignSettings({
        campaign_mode: response.campaign_mode,
        campaign_batch_hour_ist: response.campaign_batch_hour_ist,
        campaign_batch_minute_ist: response.campaign_batch_minute_ist,
        campaign_creative_mode: response.campaign_creative_mode,
        campaign_ai_provider: response.campaign_ai_provider,
        campaign_ai_model: response.campaign_ai_model,
        campaign_ai_image_quality: response.campaign_ai_image_quality,
        campaign_ai_prompt_template: response.campaign_ai_prompt_template,
      });
      toast.success(response.message || "Campaign settings updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save campaign settings");
    } finally {
      setActionLoading(false);
    }
  };

  const runDailyBatch = async () => {
    try {
      setActionLoading(true);
      await apiFetch("/marketing-campaigns/admin/run-daily-batch", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Daily Instagram batch started");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the batch");
    } finally {
      setActionLoading(false);
    }
  };

  const openReviewDialog = (action: "approve" | "reject") => {
    setReviewDialogAction(action);
    setReviewDialogNotes(action === "reject" ? "" : (detail?.run.review_notes || ""));
  };

  const closeReviewDialog = () => {
    setReviewDialogAction(null);
    setReviewDialogNotes("");
  };

  const reviewRun = async (action: "approve" | "reject", notes = "") => {
    if (!selectedId) return;
    if (action === "reject" && !notes.trim()) {
      toast.error("Add a rejection reason before rejecting this draft");
      return;
    }
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/review`, {
        method: "POST",
        body: JSON.stringify({ action, notes }),
      });
      toast.success(action === "approve" ? "Campaign review approved" : "Campaign draft rejected");
      closeReviewDialog();
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review campaign");
    } finally {
      setActionLoading(false);
    }
  };

  const retryRun = async () => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Campaign task re-queued");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry campaign");
    } finally {
      setActionLoading(false);
    }
  };

  const recoverStaleTasks = async () => {
    try {
      setActionLoading(true);
      const response = await apiFetch<{ message?: string }>("/marketing-campaigns/admin/recover-stale-tasks", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(response.message || "Stale campaign tasks checked");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recover stale campaign tasks");
    } finally {
      setActionLoading(false);
    }
  };

  const resetStuckTask = async () => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      const response = await apiFetch<{ message?: string }>(`/marketing-campaigns/admin/${selectedId}/reset-stuck`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(response.message || "Stuck campaign task reset");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset the stuck task");
    } finally {
      setActionLoading(false);
    }
  };

  const regenerateRun = async (stage = regenerateStage) => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ stage }),
      });
      toast.success(`${stage.replace(/_/g, " ")} regeneration started`);
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not regenerate campaign");
    } finally {
      setActionLoading(false);
    }
  };

  const scanSelectedReadiness = async () => {
    if (!selectedRunIds.length) {
      toast.error("Select one or more campaign runs to scan");
      return;
    }
    try {
      setActionLoading(true);
      const response = await apiFetch<{ results: Array<{ ok: boolean; message?: string; run?: CampaignRun }> }>("/marketing-campaigns/admin/readiness-scan", {
        method: "POST",
        body: JSON.stringify({ run_ids: selectedRunIds }),
      });
      const blocked = response.results.filter((result) => !result.ok);
      if (blocked.length) {
        toast.error(`${blocked.length} selected run${blocked.length === 1 ? "" : "s"} blocked. ${blocked[0].message || "Open details to review blockers."}`);
      } else {
        toast.success("Selected runs passed readiness scan");
      }
      await loadCampaigns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not scan readiness");
    } finally {
      setActionLoading(false);
    }
  };

  const retryFailedBatchItems = async () => {
    if (!data.latest_batch?.id) {
      toast.info("No batch available to retry");
      return;
    }
    try {
      setActionLoading(true);
      const response = await apiFetch<{ message?: string }>(`/marketing-campaigns/admin/batches/${data.latest_batch.id}/retry-failed`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(response.message || "Failed batch items checked");
      await refreshAll();
      await loadBatchDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry failed batch items");
    } finally {
      setActionLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/draft`, {
        method: "PATCH",
        body: JSON.stringify({
          long_caption: draftLongCaption,
          short_caption: draftShortCaption,
          hashtags: draftHashtags.split(",").map((item) => item.trim()).filter(Boolean),
          cta_text: draftCta,
        }),
      });
      toast.success("Draft caption updated");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft");
    } finally {
      setActionLoading(false);
    }
  };

  const publishNow = async () => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/post`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Instagram publish queued");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish to Instagram");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds((current) => {
      if (current.includes(runId)) {
        return current.filter((id) => id !== runId);
      }
      return [...current, runId];
    });
  };

  const toggleSelectAllVisible = () => {
    if (allSelectableVisibleSelected) {
      setSelectedRunIds((current) => current.filter((id) => !selectableVisibleRuns.some((run) => run.id === id)));
      return;
    }
    setSelectedRunIds(Array.from(new Set([...selectedRunIds, ...selectableVisibleRuns.map((run) => run.id)])));
  };

  const publishSelectedCarousel = async () => {
    if (!connection?.is_connected) {
      toast.error("Connect Instagram before publishing a carousel");
      return;
    }
    if (selectedRunIds.length < 2) {
      toast.error("Select at least 2 reviewed drafts to publish one carousel");
      return;
    }
    if (!selectedRunsCarouselEligible) {
      toast.error("Carousel publishing requires 2 to 10 selected, review-approved campaigns that are ready to publish");
      return;
    }
    if (selectedRunBlockers.length) {
      const first = selectedRunBlockers[0];
      toast.error(`${first.run.product_title || first.run.campaign_id}: ${first.blocker.message}`);
      return;
    }

    try {
      setActionLoading(true);
      const response = await apiFetch<{ message?: string }>("/marketing-campaigns/admin/post-carousel", {
        method: "POST",
        body: JSON.stringify({ run_ids: selectedRunIds }),
      });
      toast.success(response.message || "Instagram carousel queued");
      setSelectedRunIds([]);
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish the selected carousel");
    } finally {
      setActionLoading(false);
    }
  };

  const schedulePost = async (scheduledForLocal: string) => {
    if (!selectedId) return;
    if (!scheduledForLocal) {
      toast.error("Choose a schedule time first");
      return;
    }
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduled_for: new Date(scheduledForLocal).toISOString() }),
      });
      toast.success("Instagram post scheduled");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule the Instagram post");
    } finally {
      setActionLoading(false);
    }
  };

  const queueFromApprovedProduct = async () => {
    if (!queueProductId.trim()) {
      toast.error("Enter an approved vendor product ID, active admin product ID, or active affiliate product ID");
      return;
    }
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/from-product/${encodeURIComponent(queueProductId.trim())}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Product added to the daily queue");
      setQueueProductId("");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue campaign");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleCatalogProductSelection = (productId: string) => {
    setSelectedCatalogProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  };

  const toggleSelectAllCatalogProducts = () => {
    if (allFilteredCatalogSelected) {
      setSelectedCatalogProductIds((current) => current.filter((id) => !filteredCatalogProducts.some((product) => product.id === id)));
      return;
    }
    setSelectedCatalogProductIds((current) => Array.from(new Set([...current, ...filteredCatalogProducts.map((product) => product.id)])));
  };

  const queueSelectedCatalogProducts = async () => {
    if (!selectedCatalogProductIds.length) {
      toast.error("Select at least one catalog product first");
      return;
    }

    try {
      setActionLoading(true);
      const results = await Promise.allSettled(selectedCatalogProductIds.map((productId) => (
        apiFetch(`/marketing-campaigns/admin/from-product/${encodeURIComponent(productId)}`, {
          method: "POST",
          body: JSON.stringify({}),
        })
      )));

      const succeeded = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.filter((result) => result.status === "rejected");

      if (succeeded) {
        toast.success(`${succeeded} product${succeeded === 1 ? "" : "s"} added to the Instagram campaign queue`);
      }
      if (failed.length) {
        const firstFailure = failed[0] as PromiseRejectedResult;
        const message = firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some selected products could not be queued";
        toast.error(failed.length === results.length ? message : `${failed.length} product${failed.length === 1 ? "" : "s"} could not be queued: ${message}`);
      }

      if (succeeded) {
        setSelectedCatalogProductIds([]);
        setCatalogSearch("");
        setCatalogOpen(false);
        await refreshAll();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const trackedUrl = useMemo(() => {
    return detail?.run.tracking_json?.links?.instagram_feed || detail?.run.tracking_json?.publish_payload?.tracked_url || null;
  }, [detail]);

  const quickFilterOptions = useMemo(() => ([
    { id: "all", label: "All" },
    { id: "needs_review", label: "Needs review" },
    { id: "ready", label: "Ready to post" },
    { id: "blocked", label: "Blocked" },
    { id: "scheduled", label: "Scheduled" },
    { id: "published", label: "Published" },
    { id: "failed", label: "Failed" },
    { id: "affiliate", label: "Affiliate only" },
    { id: "archived", label: "Archived" },
  ]), []);

  const statusCards = useMemo(() => ([
    { label: "Queued today", value: data.counts.queued, tone: "text-amber-600" },
    { label: "Waiting review", value: data.counts.waiting_review, tone: "text-orange-600" },
    { label: "Ready to post", value: data.counts.ready_to_post ?? data.counts.approved_for_publish, tone: "text-emerald-600" },
    { label: "Blocked", value: data.counts.blocked ?? 0, tone: "text-rose-600" },
    { label: "Scheduled", value: data.counts.scheduled, tone: "text-indigo-600" },
    { label: "Published this week", value: data.counts.published, tone: "text-emerald-700" },
    { label: "Failed publishes", value: data.counts.failed, tone: "text-rose-600" },
    { label: "Affiliate runs", value: data.counts.affiliate ?? 0, tone: "text-amber-700" },
    { label: "Archived", value: data.counts.archived ?? 0, tone: "text-muted-foreground" },
  ]), [data.counts]);

  const connectionSummary = useMemo(() => {
    if (!connection) {
      return {
        title: "Instagram connection",
        description: "Loading connection status",
        chips: [] as Array<{ label: string; value: string }>,
        error: EMPTY_PLACEHOLDER,
      };
    }

    return {
      title: connection.instagram_name || connection.instagram_username || "Instagram not connected",
      description: connection.instagram_username ? `@${connection.instagram_username}` : "Connect your professional account",
      chips: [
        { label: "Status", value: connection.status || "disconnected" },
        { label: "Mode", value: connection.login_type === "instagram_business_login" ? "Business login" : (connection.account_type || "Instagram") },
        { label: "Connected", value: formatDateTime(connection.last_connected_at) },
      ],
      error: truncateText(connection.last_error || "No connection errors", 110),
    };
  }, [connection]);

  const automationSummary = useMemo(() => ({
    mode: campaignSettings.campaign_mode === "automatic" ? "Automatic posting" : "Manual approval",
    creativeMode: campaignSettings.campaign_creative_mode.replace(/_/g, " "),
    provider: imageRegistry?.providers.find((provider) => provider.key === campaignSettings.campaign_ai_provider)?.label || campaignSettings.campaign_ai_provider,
    model: imageRegistry?.providers
      .find((provider) => provider.key === campaignSettings.campaign_ai_provider)
      ?.models.find((model) => model.id === campaignSettings.campaign_ai_model)
      ?.label || campaignSettings.campaign_ai_model,
    quality: campaignSettings.campaign_ai_image_quality,
    schedule: `${String(campaignSettings.campaign_batch_hour_ist).padStart(2, "0")}:${String(campaignSettings.campaign_batch_minute_ist).padStart(2, "0")} IST`,
  }), [campaignSettings, imageRegistry]);

  const pipelineOutputs = useMemo(() => {
    if (!detail) return [];

    return [
      {
        key: "brief",
        label: "Intake brief",
        helper: "Product, pricing, vendor, and brand context gathered for the run.",
        value: detail.run.brief_json,
      },
      {
        key: "strategy",
        label: "Strategy",
        helper: "Audience, hook, offer, and recommended Instagram format.",
        value: detail.run.strategy_json,
      },
      {
        key: "creative",
        label: "Creative",
        helper: "Generated assets, CTA, and creative layout metadata.",
        value: detail.run.creative_json,
      },
      {
        key: "caption",
        label: "Caption",
        helper: "Short copy, long copy, hashtags, and CTA details.",
        value: detail.run.caption_json,
      },
      {
        key: "compliance",
        label: "Compliance",
        helper: "Safety checks and any review gating notes.",
        value: detail.run.compliance_json,
      },
      {
        key: "tracking",
        label: "Tracking",
        helper: "Tracked destination and final publish payload used for posting.",
        value: detail.run.tracking_json,
      },
    ].filter(
      (item): item is { key: string; label: string; helper: string; value: unknown } => Boolean(item.value),
    );
  }, [detail]);

  const selectedRunHasRunningTask = useMemo(() => (
    detail?.tasks?.some((task) => task.status === "running") || false
  ), [detail]);
  const detailIsPublished = Boolean(
    detail?.run.publish_status === "published"
    || detail?.run.status === "published"
    || detail?.run.instagram_media_id
  );

  const copyTrackedUrl = async () => {
    if (!trackedUrl) {
      toast.error("No tracked link available yet");
      return;
    }
    await navigator.clipboard.writeText(trackedUrl);
    toast.success("Tracked link copied");
  };

  const runLifecycleAction = async () => {
    if (!selectedId || !lifecycleAction) return;
    const action = lifecycleAction;
    try {
      setActionLoading(true);
      if (action === "purge") {
        await apiFetch(`/marketing-campaigns/admin/${selectedId}`, { method: "DELETE" });
        toast.success("Campaign permanently deleted from Pink Paisa");
        setDetailOpen(false);
        setDetail(null);
        setSelectedId(null);
      } else {
        await apiFetch(`/marketing-campaigns/admin/${selectedId}/${action}`, {
          method: "POST",
          body: JSON.stringify(action === "archive" ? { reason: "Archived from campaign admin" } : {}),
        });
        toast.success(action === "archive" ? "Campaign archived" : "Campaign restored");
        await loadDetail(selectedId, { silent: true, open: false });
      }
      setLifecycleAction(null);
      await loadCampaigns({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Campaign lifecycle action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const archiveSelectedCampaigns = async () => {
    if (!selectedRunIds.length) return;
    try {
      setActionLoading(true);
      const response = await apiFetch<{
        message?: string;
        archived: number;
        failed: number;
        results: Array<{ id: string; ok: boolean; message?: string }>;
      }>("/marketing-campaigns/admin/bulk-archive", {
        method: "POST",
        body: JSON.stringify({
          run_ids: selectedRunIds,
          reason: "Removed using bulk campaign management",
        }),
      });
      const archivedIds = new Set(response.results.filter((result) => result.ok).map((result) => result.id));
      if (response.archived) toast.success(response.message || `${response.archived} campaign(s) removed from Pink Paisa`);
      if (response.failed) {
        const firstFailure = response.results.find((result) => !result.ok)?.message;
        toast.error(`${response.failed} campaign(s) could not be removed${firstFailure ? `: ${firstFailure}` : ""}`);
      }
      setSelectedRunIds((current) => current.filter((id) => !archivedIds.has(id)));
      if (selectedId && archivedIds.has(selectedId)) {
        setDetailOpen(false);
        setDetail(null);
        setSelectedId(null);
      }
      setBulkArchiveOpen(false);
      await Promise.all([loadCampaigns({ silent: true }), loadCalendar()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove selected campaigns");
    } finally {
      setActionLoading(false);
    }
  };

  const finalCaptionPreview = useMemo(() => {
    if (!detail) return "";
    const hashtags = draftHashtags.split(",").map((item) => item.trim()).filter(Boolean).join(" ");
    return detail.run.tracking_json?.publish_payload?.caption
      || [draftLongCaption || draftShortCaption, trackedUrl, hashtags].filter(Boolean).join("\n\n");
  }, [detail, draftHashtags, draftLongCaption, draftShortCaption, trackedUrl]);

  const copyCaption = async () => {
    if (!finalCaptionPreview.trim()) {
      toast.error("No caption available yet");
      return;
    }
    await navigator.clipboard.writeText(finalCaptionPreview);
    toast.success("Caption copied");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="mb-1 font-serif text-2xl">Instagram campaign pipeline</h2>
          <p className="text-sm text-muted-foreground">Generate, review, and publish Instagram drafts with less scrolling and better run visibility.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={recoverStaleTasks} disabled={actionLoading}>
            Recover stale tasks
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={refreshAll} disabled={actionLoading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-9">
        {statusCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{card.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <div className="rounded-3xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Instagram</p>
              <h3 className="mt-2 truncate font-serif text-xl">{connectionSummary.title}</h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">{connectionSummary.description}</p>
            </div>
            <StatusBadge status={connection?.status || "disconnected"} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {connectionSummary.chips.map((chip) => (
              <div key={chip.label} className="rounded-2xl border border-border/70 bg-background/60 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{chip.label}</p>
                <p className="mt-1 text-sm font-medium">{chip.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl bg-[#fff8fa] px-4 py-3 text-xs text-[#6b4b57]">
            <span className="font-medium">Latest error:</span> {connectionSummary.error}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Automation</p>
              <h3 className="mt-2 font-serif text-xl">{automationSummary.mode}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Creative mode: <span className="font-medium capitalize text-foreground">{automationSummary.creativeMode}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Provider / model: <span className="font-medium text-foreground">{automationSummary.provider}</span>
                {automationSummary.model ? ` / ${automationSummary.model}` : ""}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Next batch target</p>
              <p className="mt-1 text-sm font-medium">{automationSummary.schedule}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-background px-3 py-1.5">Quality: <span className="font-medium capitalize text-foreground">{automationSummary.quality}</span></span>
            <span className="rounded-full bg-background px-3 py-1.5">Published: <span className="font-medium text-foreground">{data.counts.published}</span></span>
            <span className="rounded-full bg-background px-3 py-1.5">Failed: <span className="font-medium text-foreground">{data.counts.failed}</span></span>
          </div>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-3">
        <AccordionItem value="instagram-setup" className="overflow-hidden rounded-3xl border border-border bg-card px-5">
          <AccordionTrigger className="py-4 text-left hover:no-underline">
            <div>
              <p className="text-sm font-medium text-foreground">Instagram connection setup</p>
              <p className="text-xs text-muted-foreground">Reconnect, disconnect, or inspect the live Instagram account only when needed.</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            <InstagramConnectionPanel
              connection={connection}
              loading={connectionLoading || actionLoading}
              onConnect={handleConnectInstagram}
              onDisconnect={handleDisconnectInstagram}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="automation-setup" className="overflow-hidden rounded-3xl border border-border bg-card px-5">
          <AccordionTrigger className="py-4 text-left hover:no-underline">
            <div>
              <p className="text-sm font-medium text-foreground">Campaign automation setup</p>
              <p className="text-xs text-muted-foreground">Edit posting mode, AI settings, and the IST batch schedule from one collapsible section.</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            <CampaignAutomationPanel
              settings={campaignSettings}
              loading={settingsLoading}
              saving={actionLoading}
              imageRegistry={imageRegistry}
              onChange={(patch) => setCampaignSettings((current) => ({ ...current, ...patch }))}
              onSave={saveCampaignSettings}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-3xl border border-border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr,200px,minmax(0,220px),auto,auto]">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-11" placeholder="Search campaign, product, or vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setQuickFilter("all"); setPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
              <option value="all">All statuses</option>
              <option value="queued">Queued</option>
              <option value="batch_running">Generating</option>
              <option value="waiting_review">Waiting review</option>
              <option value="approved_for_publish">Approved to post</option>
              <option value="scheduled">Scheduled</option>
              <option value="publishing">Publishing</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
              <option value="rejected">Rejected</option>
            </select>
            <Input placeholder="Vendor, admin, or affiliate product ID" value={queueProductId} onChange={(e) => setQueueProductId(e.target.value)} />
            <Button variant="outline" className="rounded-xl" onClick={() => setCatalogOpen(true)} disabled={actionLoading}>
              Select from catalog
            </Button>
            <Button className="rounded-xl" onClick={queueFromApprovedProduct} disabled={actionLoading}>Queue product</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Use the product ID field for direct queueing, or open the catalog picker to select live admin, vendor-backed, and affiliate products visually.
          </p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {quickFilterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setQuickFilter(option.id);
                  setStatus("all");
                  setPage(1);
                }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  quickFilter === option.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium">Selected campaign actions</p>
              <p className="text-xs text-muted-foreground">Published campaigns can be removed from Pink Paisa; their Instagram posts remain live until removed on Instagram.</p>
              {selectedPublishedCount > 0 ? (
                <p className="mt-1 text-xs font-medium text-amber-700">{selectedPublishedCount} published campaign{selectedPublishedCount === 1 ? "" : "s"} selected.</p>
              ) : !connection?.is_connected ? (
                <p className="mt-1 text-xs font-medium text-amber-700">Instagram must be connected before carousel publishing.</p>
              ) : selectedRunBlockers.length ? (
                <p className="mt-1 text-xs font-medium text-rose-700">
                  {selectedRunBlockers[0].run.product_title || selectedRunBlockers[0].run.campaign_id}: {selectedRunBlockers[0].blocker.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input text-primary"
                  checked={allSelectableVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  disabled={selectableVisibleRuns.length === 0}
                />
                Select visible
              </label>
              <span className="rounded-xl bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                {selectedRunIds.length} selected
              </span>
              <Button variant="outline" className="rounded-xl" onClick={() => setSelectedRunIds([])} disabled={!selectedRunIds.length || actionLoading}>
                Clear
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={scanSelectedReadiness} disabled={actionLoading || !selectedRunIds.length || !selectedVisibleRuns.every(canBulkPublishRun)}>
                Scan readiness
              </Button>
              <Button className="rounded-xl" onClick={publishSelectedCarousel} disabled={actionLoading || !selectedRunsCarouselEligible || !connection?.is_connected || selectedRunBlockers.length > 0}>
                Post selected carousel
              </Button>
              <Button variant="destructive" className="rounded-xl" onClick={() => setBulkArchiveOpen(true)} disabled={actionLoading || !selectedRunIds.length}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove selected
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Daily batch</p>
              <h3 className="mt-2 font-serif text-xl">Draft generation run</h3>
              <p className="mt-1 text-sm text-muted-foreground">Launch today&apos;s Instagram draft generation immediately or monitor the latest IST batch.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-2xl" onClick={loadBatchDetail} disabled={batchDetailLoading || !data.latest_batch?.id}>
                {batchDetailLoading ? "Loading..." : "View batch details"}
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={retryFailedBatchItems} disabled={actionLoading || !data.latest_batch?.id}>
                Retry failed items
              </Button>
              <Button className="rounded-2xl" onClick={runDailyBatch} disabled={actionLoading}>
                <Wand2 className="mr-2 h-4 w-4" /> Run daily batch now
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-background/50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Last batch</p>
              <p className="mt-2 font-medium">{data.latest_batch?.batch_date_ist || "No batch yet"}</p>
            </div>
            <div className="rounded-2xl bg-background/50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</p>
              <div className="mt-2">{data.latest_batch ? <StatusBadge status={data.latest_batch.status} /> : EMPTY_PLACEHOLDER}</div>
            </div>
            <div className="rounded-2xl bg-background/50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Runs</p>
              <p className="mt-2 font-medium">{data.latest_batch?.total_runs ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-background/50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Succeeded</p>
              <p className="mt-2 font-medium">{data.latest_batch?.success_count ?? 0}</p>
            </div>
          </div>
          {batchDetail ? (
            <div className="mt-4 rounded-2xl border border-border/70 bg-background/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">Batch progress</p>
                <p className="text-xs text-muted-foreground">{batchDetail.runs.length} run{batchDetail.runs.length === 1 ? "" : "s"} assigned</p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {Object.entries(batchDetail.summary).map(([key, value]) => (
                  <div key={key} className="rounded-xl bg-card px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{key}</p>
                    <p className="mt-1 font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                {batchDetail.runs.slice(0, 8).map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2 text-xs">
                    <span className="min-w-0 truncate">{run.product_title || run.campaign_id}</span>
                    <StatusBadge status={run.status} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <CampaignQueueHealth health={queueHealth} />

      <div className="rounded-3xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Schedule calendar</p>
            <h3 className="mt-2 font-serif text-xl">Scheduled and published posts</h3>
            <p className="mt-1 text-sm text-muted-foreground">Watch for crowded days and scheduled posts that became blocked after product changes.</p>
          </div>
          <Button variant="outline" className="rounded-2xl" onClick={loadCalendar} disabled={calendarLoading}>
            <CalendarDays className="mr-2 h-4 w-4" /> {calendarLoading ? "Loading..." : "Refresh calendar"}
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {calendarLoading ? (
            <div className="md:col-span-2 xl:col-span-4"><LoadingSpinner /></div>
          ) : !calendar?.entries?.length ? (
            <div className="md:col-span-2 xl:col-span-4"><EmptyState icon={CalendarDays} text="No scheduled or published campaign posts in the next window." /></div>
          ) : (
            Object.entries(calendar.grouped).slice(0, 8).map(([date, entries]) => (
              <div key={date} className="rounded-2xl border border-border/70 bg-background/50 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{date}</p>
                <div className="mt-3 space-y-2">
                  {entries.map((entry) => (
                    <button
                      key={entry.run.id}
                      type="button"
                      onClick={() => loadDetail(entry.run.id)}
                      className="w-full rounded-xl bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{entry.run.product_title || entry.run.campaign_id}</span>
                        <StatusBadge status={entry.run.status} />
                      </div>
                      {entry.warnings.length ? <p className="mt-1 text-amber-700">{entry.warnings[0].message}</p> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input text-primary"
                    checked={allSelectableVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={selectableVisibleRuns.length === 0}
                    aria-label="Select visible campaigns"
                  />
                </th>
                <th className="px-4 py-4">Product</th>
                <th className="px-4 py-4">Creative</th>
                <th className="px-4 py-4">Pipeline</th>
                <th className="px-4 py-4">Review</th>
                <th className="px-4 py-4">Publish</th>
                <th className="px-4 py-4">Updated</th>
                <th className="px-4 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><LoadingSpinner /></td></tr>
              ) : data.items.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon={Sparkles} text="No Instagram campaign runs yet." /></td></tr>
              ) : data.items.map((run) => (
                <tr key={run.id} className={`border-t border-border/70 align-top ${selectedRunIds.includes(run.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input text-primary"
                      checked={selectedRunIds.includes(run.id)}
                      onChange={() => toggleRunSelection(run.id)}
                      disabled={!canSelectCampaignRun(run)}
                      aria-label={`Select ${run.product_title || run.campaign_id}`}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex min-w-[19rem] gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/30">
                        {getProductImageUrl(run) ? (
                          <img src={getProductImageUrl(run)!} alt={run.product_title || "Product"} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{run.product_title || "Untitled product"}</p>
                        <p className="truncate text-xs text-muted-foreground">{run.product_slug || EMPTY_PLACEHOLDER}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${getCampaignSourceLabel(run) === "Affiliate" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                            {getCampaignSourceLabel(run)}
                          </span>
                          <span>{run.vendor_shop_name || (run.source_event === "admin_product.published" ? "Pink Paisa" : EMPTY_PLACEHOLDER)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Batch: {run.batch_key || "Queued"} | {formatDateTime(run.approved_at)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex min-w-[12rem] gap-3">
                      <div className="h-16 w-14 shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-[#fff8fa]">
                        {getCreativeImageUrl(run) ? (
                          <button
                            type="button"
                            onClick={() => openPostPreview(run)}
                            className="group relative block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={`Preview ${run.product_title || "campaign"} post`}
                            title="Preview generated post"
                          >
                            <img src={getCreativeImageUrl(run)!} alt={`${run.product_title || "Campaign"} creative`} className="h-full w-full object-cover" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100" aria-hidden="true">
                              <Maximize2 className="h-4 w-4" />
                            </span>
                          </button>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">Draft</div>
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium text-foreground">
                          {getCreativeImageUrl(run) ? "Creative ready" : "No generated creative"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getCreativeAssetUrls(run).length
                            ? `${getCreativeAssetUrls(run).length} asset${getCreativeAssetUrls(run).length === 1 ? "" : "s"}`
                            : "Waiting for creative stage"}
                        </p>
                        {run.content_type ? <div><StatusBadge status={run.content_type} /></div> : null}
                        {getCreativeImageUrl(run) ? (
                          <button type="button" onClick={() => openPostPreview(run)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                            <Maximize2 className="h-3.5 w-3.5" /> Preview post
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="min-w-[12rem] space-y-2">
                      <StatusBadge status={run.status} />
                      <div><StatusBadge status={run.current_stage} /></div>
                      {run.last_error ? <p className="text-xs text-rose-600">{truncateText(run.last_error, 120)}</p> : null}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="min-w-[8rem] space-y-2">
                      {run.review_status ? <StatusBadge status={run.review_status} /> : EMPTY_PLACEHOLDER}
                      {run.review_stage ? <p className="text-xs text-muted-foreground">{run.review_stage.replace(/_/g, " ")}</p> : null}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="min-w-[9rem] space-y-2">
                      {run.publish_status ? <StatusBadge status={run.publish_status} /> : EMPTY_PLACEHOLDER}
                      {run.instagram_media_id ? <p className="text-xs text-muted-foreground">Media ID saved</p> : null}
                      {getReadinessBlockers(run).length ? (
                        <p className="text-xs text-rose-600">{truncateText(getReadinessBlockers(run)[0].message, 110)}</p>
                      ) : run.publish_readiness?.warnings?.length ? (
                        <p className="text-xs text-amber-700">{truncateText(run.publish_readiness.warnings[0].message, 110)}</p>
                      ) : run.publish_readiness?.can_publish ? (
                        <p className="text-xs text-emerald-700">Ready to post</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-4">{formatDateTime(run.updated_at)}</td>
                  <td className="px-4 py-4">
                    <button onClick={() => loadDetail(run.id)} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground" title="View details">
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="text-muted-foreground">Showing page {data.pagination.page} of {data.pagination.total_pages}. Total runs: {data.pagination.total}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" disabled={data.pagination.page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
          <Button variant="outline" className="rounded-xl" disabled={data.pagination.page >= data.pagination.total_pages} onClick={() => setPage((prev) => Math.min(data.pagination.total_pages, prev + 1))}>Next</Button>
        </div>
      </div>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="w-[min(96vw,1180px)] max-w-none rounded-[28px] border border-border/80 p-0 shadow-2xl">
          <div className="flex max-h-[90vh] flex-col bg-background">
            <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 pr-14">
              <DialogTitle className="font-serif text-2xl">Select products from catalog</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm">
                Choose live products from the public catalog and create Instagram campaign runs for them in one step. Admin, approved vendor-backed, and affiliate products are supported here.
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-11"
                      placeholder="Search title, slug, category, or source"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                    />
                  </div>
                  <select
                    value={catalogSource}
                    onChange={(event) => { setCatalogSource(event.target.value); setCatalogPage(1); setSelectedCatalogProductIds([]); }}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                  >
                    <option value="all">All sources</option>
                    <option value="affiliate">Affiliate</option>
                    <option value="admin">Admin products</option>
                    <option value="vendor">Vendor-backed</option>
                  </select>
                  <select
                    value={catalogReadiness}
                    onChange={(event) => { setCatalogReadiness(event.target.value); setCatalogPage(1); setSelectedCatalogProductIds([]); }}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                  >
                    <option value="all">Any readiness</option>
                    <option value="ready">Ready/warnings</option>
                    <option value="blocked">Blocked</option>
                    <option value="warning">Warnings</option>
                  </select>
                  <Button variant="outline" className="rounded-xl" onClick={loadCatalogProducts} disabled={catalogLoading || actionLoading}>
                    Refresh
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                    <Checkbox
                      checked={allFilteredCatalogSelected}
                      onCheckedChange={toggleSelectAllCatalogProducts}
                      disabled={!filteredCatalogProducts.length}
                    />
                    Select visible results
                  </label>
                  <span className="rounded-xl bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                    {selectedCatalogProductIds.length} selected
                  </span>
                  <Button variant="outline" className="rounded-xl" onClick={() => setSelectedCatalogProductIds([])} disabled={!selectedCatalogProductIds.length || actionLoading}>
                    Clear
                  </Button>
                  <Button className="rounded-xl" onClick={queueSelectedCatalogProducts} disabled={actionLoading || !selectedCatalogProductIds.length}>
                    Create campaign runs
                  </Button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-border">
                <div className="h-full overflow-auto">
                  {catalogLoading ? (
                    <LoadingSpinner />
                  ) : filteredCatalogProducts.length === 0 ? (
                    <EmptyState icon={Sparkles} text="No eligible catalog products matched this search." />
                  ) : (
                    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                      {filteredCatalogProducts.map((product) => {
                        const selected = selectedCatalogProductIds.includes(product.id);
                        const imageUrl = product.featured_image || null;
                        const sourceLabel = getCatalogSourceLabel(product);
                        return (
                          <div
                            key={product.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleCatalogProductSelection(product.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleCatalogProductSelection(product.id);
                              }
                            }}
                            className={`overflow-hidden rounded-2xl border text-left transition-all ${selected ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                          >
                            <div className="aspect-[4/3] bg-muted/40">
                              {imageUrl ? (
                                <img src={imageUrl} alt={product.title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No image</div>
                              )}
                            </div>
                            <div className="space-y-3 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{product.title}</p>
                                  <p className="truncate text-xs text-muted-foreground">{product.slug || product.id}</p>
                                </div>
                                <Checkbox checked={selected} className="mt-1" />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${sourceLabel === "Affiliate" ? "bg-amber-100 text-amber-800" : "bg-background text-muted-foreground"}`}>
                                  {sourceLabel}
                                </span>
                                {product.category ? (
                                  <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                    {product.category}
                                  </span>
                                ) : null}
                                {product.subcategory ? (
                                  <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                    {product.subcategory}
                                  </span>
                                ) : null}
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                  product.readiness_status === "blocked"
                                    ? "bg-rose-100 text-rose-800"
                                    : product.readiness_status === "warning"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-emerald-100 text-emerald-800"
                                }`}
                                >
                                  {product.readiness_status || "ready"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <p className="font-medium text-foreground">
                                  {product.is_affiliate || product.price == null
                                    ? "Instagram campaign"
                                    : `${String.fromCharCode(8377)}${Number(product.sale_price ?? product.price ?? 0).toLocaleString("en-IN")}`}
                                </p>
                                <p className="text-xs text-muted-foreground">{product.status || "active"}</p>
                              </div>
                              {product.readiness?.blockers?.length ? (
                                <p className="text-xs text-rose-700">{truncateText(product.readiness.blockers[0].message, 120)}</p>
                              ) : product.readiness?.warnings?.length ? (
                                <p className="text-xs text-amber-700">{truncateText(product.readiness.warnings[0].message, 120)}</p>
                              ) : (
                                <p className="text-xs text-emerald-700">Ready to queue</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
                <p className="text-muted-foreground">
                  Page {catalogPagination.page} of {catalogPagination.total_pages}. {catalogPagination.total} product{catalogPagination.total === 1 ? "" : "s"}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="rounded-xl" disabled={catalogPagination.page <= 1 || catalogLoading} onClick={() => setCatalogPage((prev) => Math.max(1, prev - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" className="rounded-xl" disabled={catalogPagination.page >= catalogPagination.total_pages || catalogLoading} onClick={() => setCatalogPage((prev) => Math.min(catalogPagination.total_pages, prev + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewDialogAction)} onOpenChange={(open) => !open && closeReviewDialog()}>
        <DialogContent className="max-w-xl rounded-[28px] border border-border/80 p-0 shadow-2xl">
          <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <DialogTitle className="font-serif text-2xl">
              {reviewDialogAction === "reject" ? "Reject campaign draft" : "Approve campaign draft"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {reviewDialogAction === "reject"
                ? "Add a clear reason so the next editor knows exactly what blocked this draft."
                : "Leave an optional approval note for the publishing team or future audits."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {reviewDialogAction === "reject" ? "Rejection reason" : "Approval note"}
              </p>
              <Textarea
                value={reviewDialogNotes}
                onChange={(event) => setReviewDialogNotes(event.target.value)}
                rows={5}
                placeholder={reviewDialogAction === "reject"
                  ? "Explain what needs to change before this campaign can be published."
                  : "Optional context, approvals, or publishing notes."}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={closeReviewDialog} disabled={actionLoading}>
                Cancel
              </Button>
              <Button
                className="rounded-2xl"
                variant={reviewDialogAction === "reject" ? "destructive" : "default"}
                onClick={() => reviewDialogAction && reviewRun(reviewDialogAction, reviewDialogNotes)}
                disabled={actionLoading || (reviewDialogAction === "reject" && !reviewDialogNotes.trim())}
              >
                {reviewDialogAction === "reject" ? "Reject draft" : "Approve draft"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen} modal={!postPreview}>
        <DialogContent className="w-[min(96vw,1400px)] max-w-none overflow-hidden rounded-[28px] border border-border/80 p-0 shadow-2xl">
          <div className="flex max-h-[92vh] flex-col bg-background">
          <DialogHeader className="shrink-0 border-b border-border/70 bg-background px-6 py-5 pr-14">
            <DialogTitle className="font-serif text-2xl">Instagram campaign detail</DialogTitle>
            <DialogDescription className="max-w-2xl text-sm">
              Review the creative, tighten the draft, approve the run, and publish to Instagram from one workspace.
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="px-6 py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-6 px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Campaign</p><p className="mt-2 font-medium">{detail.run.campaign_id}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Product</p><p className="mt-2 font-medium">{detail.run.product_title || EMPTY_PLACEHOLDER}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status</p><div className="mt-2"><StatusBadge status={detail.run.status} /></div></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Review</p><div className="mt-2"><StatusBadge status={detail.run.review_status || "pending"} /></div></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Publish</p><div className="mt-2"><StatusBadge status={detail.run.publish_status || "not_ready"} /></div></div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border/70 py-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Next action</p>
                  <p className="mt-1 font-medium capitalize">{(detail.run.next_action || detail.run.current_stage || "wait_for_worker").replace(/_/g, " ")}</p>
                  {detail.run.archived_at ? <p className="mt-1 text-xs text-muted-foreground">Archived {formatDateTime(detail.run.archived_at)}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.run.instagram_permalink ? (
                    <Button asChild variant="outline" className="rounded-xl">
                      <a href={detail.run.instagram_permalink} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" /> Open Instagram
                      </a>
                    </Button>
                  ) : null}
                  {detail.run.archived_at ? (
                    <>
                      <Button variant="outline" className="rounded-xl" onClick={() => setLifecycleAction("restore")} disabled={actionLoading}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Restore
                      </Button>
                      {!detail.run.instagram_media_id && !detail.run.published_at ? (
                        <Button variant="destructive" className="rounded-xl" onClick={() => setLifecycleAction("purge")} disabled={actionLoading}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button variant={detailIsPublished ? "destructive" : "outline"} className="rounded-xl" onClick={() => setLifecycleAction("archive")} disabled={actionLoading || detail.run.publish_status === "publishing"}>
                      {detailIsPublished ? <Trash2 className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                      {detailIsPublished ? "Remove from Pink Paisa" : "Archive"}
                    </Button>
                  )}
                </div>
              </div>

              {detail.run.review_notes && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p className="font-medium">Review note</p>
                      <p className="mt-1">{detail.run.review_notes}</p>
                    </div>
                  </div>
                </div>
              )}

              {detail.run.last_error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p className="font-medium">Latest publish error</p>
                      <p className="mt-1 break-words">{detail.run.last_error}</p>
                    </div>
                  </div>
                </div>
              )}

              {(detail.run.is_affiliate || detail.run.source_event === "affiliate_product.published") && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-amber-800">Affiliate metadata</p>
                      <p className="mt-1 text-sm text-amber-900">Instagram tracking points to the Pink Paisa product page. The partner URL is preserved here for review.</p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">Affiliate</span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-amber-800">Affiliate URL</p>
                      {getAffiliateUrl(detail.run) ? (
                        <a href={getAffiliateUrl(detail.run)!} target="_blank" rel="noreferrer" className="mt-2 block break-all text-primary underline-offset-4 hover:underline">
                          {getAffiliateUrl(detail.run)}
                        </a>
                      ) : (
                        <p className="mt-2 font-medium">{EMPTY_PLACEHOLDER}</p>
                      )}
                    </div>
                    <div className="rounded-xl bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-amber-800">External ID</p>
                      <p className="mt-2 break-all font-medium">{getAffiliateExternalId(detail.run) || EMPTY_PLACEHOLDER}</p>
                    </div>
                    <div className="rounded-xl bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-amber-800">Source platform</p>
                      <p className="mt-2 break-all font-medium">{getAffiliateSourcePlatform(detail.run) || detail.run.vendor_shop_name || EMPTY_PLACEHOLDER}</p>
                    </div>
                    <div className="rounded-xl bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-amber-800">Source mode</p>
                      <p className="mt-2 break-all font-medium capitalize">{(getAffiliateSourceMode(detail.run) || EMPTY_PLACEHOLDER).replace(/_/g, " ")}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Readiness checklist</p>
                      <h3 className="mt-1 font-serif text-xl">Can this campaign post?</h3>
                    </div>
                    <StatusBadge status={detail.run.publish_readiness?.can_publish ? "ready" : "blocked"} />
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    {[
                      {
                        label: "Product active and visible",
                        ok: !detail.run.publish_readiness?.blockers?.some((issue) => ["product_inactive", "product_hidden", "product_not_found"].includes(issue.code)),
                      },
                      {
                        label: "Affiliate compliance and Amazon tag valid",
                        ok: !(detail.run.is_affiliate || detail.run.source_event === "affiliate_product.published")
                          || !detail.run.publish_readiness?.blockers?.some((issue) => issue.code.startsWith("affiliate") || issue.code.startsWith("amazon")),
                      },
                      {
                        label: "Category and subcategory present",
                        ok: !detail.run.publish_readiness?.blockers?.some((issue) => issue.code === "product_uncategorized"),
                      },
                      {
                        label: "Creative media uses public HTTPS",
                        ok: (detail.run.tracking_json?.publish_payload?.asset_urls || detail.run.asset_urls || []).some(isPublicHttpsUrl),
                      },
                      {
                        label: "Caption includes affiliate disclosure when needed",
                        ok: !(detail.run.is_affiliate || detail.run.source_event === "affiliate_product.published") || hasAffiliateDisclosureText(finalCaptionPreview),
                      },
                      {
                        label: "Instagram account connected",
                        ok: connection?.is_connected === true,
                      },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2">
                        {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
                        <span className={item.ok ? "text-foreground" : "text-rose-700"}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  {detail.run.publish_readiness?.blockers?.length ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                      <p className="font-medium">Why can&apos;t I post?</p>
                      <ul className="mt-2 space-y-1">
                        {detail.run.publish_readiness.blockers.map((blocker) => (
                          <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
                        ))}
                      </ul>
                      {(detail.run.is_affiliate || detail.run.source_event === "affiliate_product.published") && (
                        <a
                          href={`/admin?section=affiliate_products&search=${encodeURIComponent(getAffiliateExternalId(detail.run) || detail.run.product_title || "")}`}
                          className="mt-3 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          <LinkIcon className="h-3.5 w-3.5" /> Fix product
                        </a>
                      )}
                    </div>
                  ) : detail.run.publish_readiness?.warnings?.length ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-medium">Warnings</p>
                      <ul className="mt-2 space-y-1">
                        {detail.run.publish_readiness.warnings.map((warning) => (
                          <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Caption preview</p>
                      <h3 className="mt-1 font-serif text-xl">Final Instagram caption</h3>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="rounded-2xl" onClick={copyCaption}>
                        <Copy className="mr-2 h-4 w-4" /> Copy caption
                      </Button>
                      <Button variant="outline" className="rounded-2xl" onClick={copyTrackedUrl}>
                        <Copy className="mr-2 h-4 w-4" /> Copy link
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-background/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Length</p>
                      <p className="mt-1 font-semibold">{finalCaptionPreview.length}</p>
                    </div>
                    <div className="rounded-xl bg-background/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Hashtags</p>
                      <p className="mt-1 font-semibold">{getHashtagCount(finalCaptionPreview)}</p>
                    </div>
                    <div className="rounded-xl bg-background/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Disclosure</p>
                      <p className={`mt-1 font-semibold ${hasAffiliateDisclosureText(finalCaptionPreview) ? "text-emerald-700" : "text-rose-700"}`}>
                        {hasAffiliateDisclosureText(finalCaptionPreview) ? "Present" : "Missing"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-background/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Tracked link</p>
                      <p className={`mt-1 font-semibold ${trackedUrl ? "text-emerald-700" : "text-rose-700"}`}>
                        {trackedUrl ? "Present" : "Missing"}
                      </p>
                    </div>
                  </div>
                  <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-[#fff8fa] p-4 text-xs leading-5 text-[#6b4b57]">
                    {finalCaptionPreview || "Caption is not generated yet."}
                  </pre>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),380px]">
                <div className="min-w-0 space-y-6">
                  <CampaignCreativePreview
                    title={detail.run.product_title || "Campaign creative"}
                    assetUrls={getCreativeAssetUrls(detail.run)}
                    contentType={detail.run.content_type || detail.run.creative_json?.content_type}
                    ctaText={detail.run.cta_text || detail.run.creative_json?.cta_text}
                    trackedUrl={trackedUrl}
                    onPreview={(index) => openPostPreview(detail.run, index)}
                  />

                  <div className="rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Draft editor</p>
                        <p className="mt-1 text-sm text-muted-foreground">Polish the copy before you unlock publish.</p>
                      </div>
                      <Button variant="outline" className="rounded-2xl" onClick={copyTrackedUrl}>
                        <Copy className="mr-2 h-4 w-4" /> Copy tracked link
                      </Button>
                    </div>
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-4 lg:grid-cols-[220px,minmax(0,1fr)]">
                        <div>
                          <label className="mb-2 block text-sm font-medium">CTA text</label>
                          <Input value={draftCta} onChange={(e) => setDraftCta(e.target.value)} placeholder="Buy Now" />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium">Hashtags</label>
                          <Input value={draftHashtags} onChange={(e) => setDraftHashtags(e.target.value)} placeholder="#PinkPaisa, #WomenWhoWellness" />
                        </div>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium">Short caption</label>
                        <Textarea value={draftShortCaption} onChange={(e) => setDraftShortCaption(e.target.value)} rows={3} />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium">Long caption</label>
                        <Textarea value={draftLongCaption} onChange={(e) => setDraftLongCaption(e.target.value)} rows={6} />
                      </div>
                      <div className="flex justify-end">
                        <Button className="rounded-2xl lg:min-w-[160px]" onClick={saveDraft} disabled={actionLoading}>
                          Save draft edits
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pipeline outputs</p>
                        <p className="mt-1 text-sm text-muted-foreground">Open the raw stage payloads only when you need the technical details.</p>
                      </div>
                    </div>
                    <Accordion type="multiple" className="mt-4 space-y-3">
                      {pipelineOutputs.map((output) => (
                        <AccordionItem key={output.key} value={output.key} className="rounded-2xl border border-border/70 px-4">
                          <AccordionTrigger className="py-4 text-left hover:no-underline">
                            <div>
                              <p className="text-sm font-medium text-foreground">{output.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{output.helper}</p>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-0">
                            <JsonBlock value={output.value} />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="space-y-4 xl:sticky xl:top-6">
                  <div className="rounded-[28px] border border-border bg-background p-4 shadow-sm">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Regenerate</p>
                      <p className="mt-1 text-sm text-muted-foreground">Restart only the stage that needs repair. Intake resets the whole downstream pipeline.</p>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <select
                        value={regenerateStage}
                        onChange={(event) => setRegenerateStage(event.target.value)}
                        className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                      >
                        <option value="creative">Creative only</option>
                        <option value="caption">Caption only</option>
                        <option value="tracking">Tracking only</option>
                        <option value="intake">Regenerate from intake</option>
                      </select>
                      <Button variant="outline" className="rounded-xl" onClick={() => regenerateRun(regenerateStage)} disabled={actionLoading}>
                        Start
                      </Button>
                    </div>
                  </div>
                  <CampaignPublishActions
                    run={detail.run}
                    lastError={detail.run.last_error || null}
                    actionLoading={actionLoading}
                    onRefresh={refreshDetail}
                    onRetry={retryRun}
                    onResetStuckTask={resetStuckTask}
                    onRegenerate={() => regenerateRun("creative")}
                    onApproveReview={() => openReviewDialog("approve")}
                    onRejectReview={() => openReviewDialog("reject")}
                    onPostNow={publishNow}
                    onSchedule={schedulePost}
                    canResetStuck={selectedRunHasRunningTask}
                    instagramConnected={connection?.is_connected === true}
                    instagramConnectionWarning={connection?.last_error || null}
                  />

                  <div className="rounded-[28px] border border-border bg-background p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Publish result</p>
                        <p className="mt-1 text-sm text-muted-foreground">Instagram stores the media ID, timestamp, and live permalink here after a successful publish.</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="rounded-2xl bg-background/50 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Scheduled for</p>
                        <p className="mt-2 font-medium">{formatDateTime(detail.run.scheduled_for)}</p>
                      </div>
                      <div className="rounded-2xl bg-background/50 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Published at</p>
                        <p className="mt-2 font-medium">{formatDateTime(detail.run.published_at)}</p>
                      </div>
                      <div className="rounded-2xl bg-background/50 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Instagram media ID</p>
                        <p className="mt-2 break-all font-medium">{detail.run.instagram_media_id || EMPTY_PLACEHOLDER}</p>
                      </div>
                      <div className="rounded-2xl bg-background/50 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Permalink</p>
                        {detail.run.instagram_permalink ? (
                          <a href={detail.run.instagram_permalink} target="_blank" rel="noreferrer" className="mt-2 block break-all text-primary underline-offset-4 hover:underline">
                            {detail.run.instagram_permalink}
                          </a>
                        ) : (
                          <p className="mt-2 font-medium">{EMPTY_PLACEHOLDER}</p>
                        )}
                      </div>
                      {detail.run.last_error ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-rose-700">Latest error</p>
                          <p className="mt-2 text-sm text-rose-800">{detail.run.last_error}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <CampaignTimeline events={detail.publish_events || []} tasks={detail.tasks} />
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
      {postPreview ? (
        <CampaignPostLightbox
          open
          onClose={() => setPostPreview(null)}
          {...postPreview}
        />
      ) : null}
      <ConfirmActionDialog
        open={lifecycleAction !== null}
        onOpenChange={(open) => !open && setLifecycleAction(null)}
        title={lifecycleAction === "purge"
          ? "Delete campaign permanently"
          : lifecycleAction === "restore"
            ? "Restore campaign"
            : detailIsPublished
              ? "Remove published campaign from Pink Paisa"
              : "Archive campaign"}
        description={lifecycleAction === "purge"
          ? "This removes the unpublished campaign, task history, and unreferenced generated assets from Pink Paisa. This cannot be undone."
          : lifecycleAction === "restore"
            ? "Restore this campaign to its previous workflow state. Scheduled campaigns return as ready to publish and are not automatically rescheduled."
            : detailIsPublished
              ? "This removes the campaign from active Pink Paisa views and keeps its audit record in Archived. The Instagram post remains live and must be removed on Instagram."
              : "Archive this campaign and cancel queued work."}
        confirmLabel={lifecycleAction === "purge"
          ? "Delete permanently"
          : lifecycleAction === "restore"
            ? "Restore campaign"
            : detailIsPublished
              ? "Remove from Pink Paisa"
              : "Archive campaign"}
        destructive={lifecycleAction === "purge" || (lifecycleAction === "archive" && detailIsPublished)}
        pending={actionLoading}
        onConfirm={runLifecycleAction}
      />
      <ConfirmActionDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        title="Remove selected campaigns from Pink Paisa"
        description={`Remove ${selectedRunIds.length} selected campaign${selectedRunIds.length === 1 ? "" : "s"} from active Pink Paisa views?${selectedPublishedCount ? ` ${selectedPublishedCount} Instagram post${selectedPublishedCount === 1 ? "" : "s"} will remain live and must be removed on Instagram.` : ""}`}
        confirmLabel="Remove selected"
        destructive
        pending={actionLoading}
        onConfirm={archiveSelectedCampaigns}
      />
    </div>
  );
};

export default AdminCampaigns;

