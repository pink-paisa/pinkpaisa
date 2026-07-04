import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingSpinner, StatusBadge } from "./AdminShared";
import { AlertTriangle, Copy, Eye, Search, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import InstagramConnectionPanel from "./InstagramConnectionPanel";
import CampaignAutomationPanel, {
  DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY,
  DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
  type CampaignAutomationSettings,
  type CampaignImageProviderRegistry,
} from "./CampaignAutomationPanel";
import CampaignCreativePreview from "./CampaignCreativePreview";
import CampaignPublishActions from "./CampaignPublishActions";

type TaskCounts = { queued?: number; running?: number; completed?: number; failed?: number; cancelled?: number };
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
  last_error: string | null;
  brief_json?: {
    primary_image?: string | null;
    images?: string[] | null;
    is_affiliate?: boolean;
    affiliate_url?: string | null;
    affiliate_external_id?: string | null;
    affiliate_source_platform?: string | null;
    affiliate?: {
      url?: string | null;
      external_id?: string | null;
      source_platform?: string | null;
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
    publish_payload?: { tracked_url?: string };
  } | null;
  task_counts?: TaskCounts;
};
type CampaignTask = {
  id: string;
  agent_name: string;
  sequence: number;
  status: string;
  attempt_count: number;
  input_json: unknown;
  output_json: unknown;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
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
      publish_payload?: { tracked_url?: string };
    } | null;
  };
  batch: BatchRun | null;
  tasks: CampaignTask[];
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
  run.review_status === "approved"
  && ["ready", "draft", "failed", "scheduled"].includes(run.publish_status || "")
  && Array.isArray(run.asset_urls)
  && run.asset_urls.length > 0
);

const getProductImageUrl = (run: CampaignRun) => {
  const images = Array.isArray(run.brief_json?.images) ? run.brief_json?.images : [];
  const fallbackImages = Array.isArray(run.product_gallery_urls) ? run.product_gallery_urls : [];
  return run.brief_json?.primary_image || images?.find(Boolean) || run.product_image_url || fallbackImages.find(Boolean) || null;
};

const getCreativeImageUrl = (run: CampaignRun) => (
  run.asset_urls?.find(Boolean)
  || run.creative_json?.primary_asset_url
  || run.creative_json?.asset_urls?.find(Boolean)
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

const truncateText = (value: string | null | undefined, maxLength = 140) => {
  if (!value) return EMPTY_PLACEHOLDER;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
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
    },
    latest_batch: null,
    pagination: { page: 1, limit: 10, total: 0, total_pages: 1 },
  });
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [campaignSettings, setCampaignSettings] = useState<CampaignAutomationSettings>(DEFAULT_CAMPAIGN_SETTINGS);
  const [imageRegistry, setImageRegistry] = useState<CampaignImageProviderRegistry>(DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
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

  const loadCatalogProducts = async () => {
    try {
      setCatalogLoading(true);
      const response = await apiFetch<CatalogProduct[]>("/products?status=active&_limit=500");
      setCatalogProducts(
        response.filter((product) => product.status === "active" && product.is_visible !== false),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load catalog products");
    } finally {
      setCatalogLoading(false);
    }
  };

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const response = await apiFetch<CampaignListResponse>(`/marketing-campaigns/admin?search=${encodeURIComponent(debouncedSearch)}&status=${status}&page=${page}&limit=10`);
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load campaign runs");
    } finally {
      setLoading(false);
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

  const loadDetail = async (id: string) => {
    try {
      setDetailLoading(true);
      setSelectedId(id);
      setDetailOpen(true);
      const response = await apiFetch<CampaignDetailResponse>(`/marketing-campaigns/admin/${id}`);
      setDetail(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load campaign detail");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
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
  }, [debouncedSearch, status, page]);

  useEffect(() => {
    loadConnection();
    loadCampaignSettings();
    loadImageRegistry();
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
    setSelectedRunIds((current) => current.filter((id) => data.items.some((run) => run.id === id && canBulkPublishRun(run))));
  }, [data.items]);

  useEffect(() => {
    if (!catalogOpen) return;
    loadCatalogProducts();
  }, [catalogOpen]);

  const eligibleVisibleRuns = useMemo(() => data.items.filter(canBulkPublishRun), [data.items]);
  const allEligibleVisibleSelected = eligibleVisibleRuns.length > 0 && eligibleVisibleRuns.every((run) => selectedRunIds.includes(run.id));
  const filteredCatalogProducts = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return catalogProducts;
    return catalogProducts.filter((product) => (
      [product.title, product.slug, product.category, product.subcategory, product.source_type, getCatalogSourceLabel(product)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
  }, [catalogProducts, catalogSearch]);
  const allFilteredCatalogSelected = filteredCatalogProducts.length > 0 && filteredCatalogProducts.every((product) => selectedCatalogProductIds.includes(product.id));

  const refreshDetail = async () => {
    if (!selectedId) return;
    await loadDetail(selectedId);
  };

  const refreshAll = async () => {
    await Promise.all([loadCampaigns(), loadConnection(), loadCampaignSettings(), loadImageRegistry(), selectedId ? refreshDetail() : Promise.resolve()]);
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

  const regenerateRun = async () => {
    if (!selectedId) return;
    try {
      setActionLoading(true);
      await apiFetch(`/marketing-campaigns/admin/${selectedId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ stage: "creative" }),
      });
      toast.success("Creative regeneration started");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not regenerate campaign");
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
      toast.success("Instagram publish completed");
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
      if (current.length >= 10) {
        toast.error("You can select up to 10 reviewed drafts for one carousel post");
        return current;
      }
      return [...current, runId];
    });
  };

  const toggleSelectAllEligible = () => {
    if (allEligibleVisibleSelected) {
      setSelectedRunIds((current) => current.filter((id) => !eligibleVisibleRuns.some((run) => run.id === id)));
      return;
    }

    const merged = Array.from(new Set([...selectedRunIds, ...eligibleVisibleRuns.map((run) => run.id)]));
    if (merged.length > 10) {
      toast.info("Only the first 10 eligible reviewed drafts can be included in one Instagram carousel");
    }
    setSelectedRunIds(merged.slice(0, 10));
  };

  const publishSelectedCarousel = async () => {
    if (selectedRunIds.length < 2) {
      toast.error("Select at least 2 reviewed drafts to publish one carousel");
      return;
    }

    try {
      setActionLoading(true);
      const response = await apiFetch<{ message?: string }>("/marketing-campaigns/admin/post-carousel", {
        method: "POST",
        body: JSON.stringify({ run_ids: selectedRunIds }),
      });
      toast.success(response.message || "Instagram carousel published");
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

  const statusCards = useMemo(() => ([
    { label: "Queued", value: data.counts.queued, tone: "text-amber-600" },
    { label: "Generating", value: data.counts.batch_running, tone: "text-sky-600" },
    { label: "Review", value: data.counts.waiting_review, tone: "text-orange-600" },
    { label: "Approved", value: data.counts.approved_for_publish, tone: "text-emerald-600" },
    { label: "Scheduled", value: data.counts.scheduled, tone: "text-indigo-600" },
    { label: "Publishing", value: data.counts.publishing, tone: "text-fuchsia-600" },
    { label: "Published", value: data.counts.published, tone: "text-emerald-700" },
    { label: "Failed", value: data.counts.failed, tone: "text-rose-600" },
    { label: "Rejected", value: data.counts.rejected, tone: "text-muted-foreground" },
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

  const copyTrackedUrl = async () => {
    if (!trackedUrl) {
      toast.error("No tracked link available yet");
      return;
    }
    await navigator.clipboard.writeText(trackedUrl);
    toast.success("Tracked link copied");
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
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
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
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium">Bulk carousel publishing</p>
              <p className="text-xs text-muted-foreground">Select up to 10 review-approved drafts with ready creatives, then publish them as one Instagram carousel post.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input text-primary"
                  checked={allEligibleVisibleSelected}
                  onChange={toggleSelectAllEligible}
                  disabled={eligibleVisibleRuns.length === 0}
                />
                Select eligible visible
              </label>
              <span className="rounded-xl bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                {selectedRunIds.length}/10 selected
              </span>
              <Button variant="outline" className="rounded-xl" onClick={() => setSelectedRunIds([])} disabled={!selectedRunIds.length || actionLoading}>
                Clear
              </Button>
              <Button className="rounded-xl" onClick={publishSelectedCarousel} disabled={actionLoading || selectedRunIds.length < 2}>
                Post selected carousel
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
            <Button className="rounded-2xl" onClick={runDailyBatch} disabled={actionLoading}>
              <Wand2 className="mr-2 h-4 w-4" /> Run daily batch now
            </Button>
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
                    checked={allEligibleVisibleSelected}
                    onChange={toggleSelectAllEligible}
                    disabled={eligibleVisibleRuns.length === 0}
                    aria-label="Select eligible visible runs"
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
                      disabled={!canBulkPublishRun(run)}
                      aria-label={`Select ${run.product_title || run.campaign_id} for carousel publishing`}
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
                          <img src={getCreativeImageUrl(run)!} alt={`${run.product_title || "Campaign"} creative`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">Draft</div>
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium text-foreground">
                          {getCreativeImageUrl(run) ? "Creative ready" : "No generated creative"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {run.asset_urls?.length ? `${run.asset_urls.length} asset${run.asset_urls.length === 1 ? "" : "s"}` : "Waiting for creative stage"}
                        </p>
                        {run.content_type ? <div><StatusBadge status={run.content_type} /></div> : null}
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
                              </div>
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <p className="font-medium text-foreground">
                                  {String.fromCharCode(8377)}{Number(product.sale_price ?? product.price ?? 0).toLocaleString("en-IN")}
                                </p>
                                <p className="text-xs text-muted-foreground">{product.status || "active"}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
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
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
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
                  </div>
                </div>
              )}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),380px]">
                <div className="min-w-0 space-y-6">
                  <CampaignCreativePreview
                    title={detail.run.product_title || "Campaign creative"}
                    assetUrls={detail.run.asset_urls || detail.run.creative_json?.asset_urls || detail.run.creative_json?.creative_json?.slides?.map((slide) => slide.url || "").filter(Boolean) || []}
                    contentType={detail.run.content_type || detail.run.creative_json?.content_type}
                    ctaText={detail.run.cta_text || detail.run.creative_json?.cta_text}
                    trackedUrl={trackedUrl}
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
                  <CampaignPublishActions
                    run={detail.run}
                    lastError={detail.run.last_error || null}
                    actionLoading={actionLoading}
                    onRefresh={refreshDetail}
                    onRetry={retryRun}
                    onResetStuckTask={resetStuckTask}
                    onRegenerate={regenerateRun}
                    onApproveReview={() => openReviewDialog("approve")}
                    onRejectReview={() => openReviewDialog("reject")}
                    onPostNow={publishNow}
                    onSchedule={schedulePost}
                    canResetStuck={selectedRunHasRunningTask}
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

                  <div className="rounded-[28px] border border-border bg-background p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Agent tasks</p>
                        <p className="mt-1 text-sm text-muted-foreground">Inspect retries, errors, and task payloads only when you need them.</p>
                      </div>
                    </div>
                    <Accordion type="multiple" className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {detail.tasks.map((task) => (
                        <AccordionItem key={task.id} value={task.id} className="rounded-2xl border border-border/70 px-4">
                          <AccordionTrigger className="py-4 text-left hover:no-underline">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium capitalize">{task.sequence}. {task.agent_name}</p>
                              <StatusBadge status={task.status} />
                              <span className="text-xs text-muted-foreground">Attempts: {task.attempt_count}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-0">
                          <p className="mt-2 text-xs text-muted-foreground">Started: {formatDateTime(task.started_at)} | Finished: {formatDateTime(task.finished_at)}</p>
                          {task.error_message ? <p className="mb-3 text-sm text-rose-700">{task.error_message}</p> : null}
                          {task.output_json ? <JsonBlock value={task.output_json} /> : null}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminCampaigns;

