import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Database,
  Download,
  Edit,
  ExternalLink,
  FileSpreadsheet,
  ImageIcon,
  Instagram,
  MoreHorizontal,
  PauseCircle,
  RefreshCw,
  Search,
  Star,
  Tags,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { downloadWorkbook } from "@/lib/excelWorkbook";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import type { PhysicalProduct } from "@/hooks/usePhysicalProducts";
import { CheckboxField, EmptyState, Field, FormCard, LoadingSpinner, StatCard, StatusBadge } from "./AdminShared";
import { toast } from "sonner";

const TEMPLATE_COLUMNS = [
  "product_title",
  "affiliate_url",
  "image_url",
  "marketplace",
  "asin",
  "category",
  "subcategory",
  "short_description",
  "buying_intent",
  "pros",
  "cons",
  "seo_title",
  "seo_description",
  "campaign_label",
  "sku",
  "brand",
  "tags",
  "full_description",
];

const SAMPLE_ROWS = [
  {
    product_title: "Rose Quartz Face Roller",
    affiliate_url: "https://www.amazon.in/dp/B0CTVGPLQX?tag=YOUR-IN-TAG",
    image_url: "https://your-cdn.example.com/rose-quartz-face-roller.jpg",
    marketplace: "amazon_in",
    asin: "B0CTVGPLQX",
    category: "",
    subcategory: "",
    short_description: "Short benefit-focused description written by Pink Paisa.",
    buying_intent: "Quick beauty routine upgrade",
    pros: "Easy to use | Giftable",
    cons: "Check seller details on Amazon",
    seo_title: "Rose Quartz Face Roller",
    seo_description: "Curated Amazon skincare find from Pink Paisa.",
    campaign_label: "instagram-beauty-finds",
    sku: "AMZ-B0CTVGPLQX",
    brand: "Example Brand",
    tags: "beauty, skincare",
    full_description: "",
  },
  {
    product_title: "Wellness Planner Journal",
    affiliate_url: "https://www.amazon.com/dp/B0D1234567?tag=YOUR-US-TAG",
    image_url: "https://your-cdn.example.com/wellness-planner-journal.jpg",
    marketplace: "amazon_us",
    asin: "B0D1234567",
    category: "",
    subcategory: "",
    short_description: "Daily planning journal for wellness routines.",
    buying_intent: "Daily planning and habit tracking",
    pros: "Simple layout | Strong gift angle",
    cons: "Confirm page count on Amazon",
    seo_title: "Wellness Planner Journal",
    seo_description: "Curated Amazon wellness planner pick from Pink Paisa.",
    campaign_label: "instagram-wellness-finds",
    sku: "AMZ-B0D1234567",
    brand: "Example Brand",
    tags: "wellness, planner",
    full_description: "",
  },
];

type AffiliateForm = {
  id?: string;
  title: string;
  slug: string;
  affiliate_url: string;
  image_url: string;
  affiliate_marketplace: "amazon_in" | "amazon_us";
  affiliate_asin: string;
  sku: string;
  brand_name: string;
  category_id: string;
  subcategory_id: string;
  tags: string;
  short_description: string;
  full_description: string;
  buying_intent: string;
  campaign_label: string;
  pros: string;
  cons: string;
  seo_title: string;
  seo_description: string;
  is_featured_affiliate: boolean;
  affiliate_is_instagram_pick: boolean;
  affiliate_sort_order: number;
};

type AffiliateUploadResponse = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors?: Array<{ row?: number | null; title?: string | null; sku?: string | null; errors: string[] }>;
};

type AffiliatePreviewRow = {
  row?: number | null;
  title?: string | null;
  sku?: string | null;
  asin?: string | null;
  marketplace?: string | null;
  category?: string | null;
  subcategory?: string | null;
  image_url?: string | null;
  action?: "create" | "update" | null;
  status: "valid" | "invalid";
  errors: string[];
};

type AffiliatePreviewResponse = {
  message?: string;
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    create_count: number;
    update_count: number;
  };
  preview_rows: AffiliatePreviewRow[];
  has_valid_rows: boolean;
  meta?: {
    file_name?: string | null;
    sheet_name?: string | null;
  };
};

type AffiliateDataMode = "manual_only" | "creators_api";

type AffiliateQuickFilter = "all" | "needs_review" | "published" | "draft" | "paused" | "uncategorized" | "missing_image" | "link_issue";

type AffiliateBulkAction =
  | "validate_compliance"
  | "check_link"
  | "publish"
  | "unpublish"
  | "pause"
  | "feature"
  | "unfeature"
  | "instagram_pick"
  | "instagram_unpick"
  | "refresh_api"
  | "assign_category"
  | "delete";

type AffiliateBulkResult = {
  id: string | null;
  action: AffiliateBulkAction;
  ok: boolean;
  message?: string | null;
  product?: PhysicalProduct | null;
};

type AffiliateBulkResponse = {
  message?: string;
  requested: number;
  succeeded: number;
  failed: number;
  results: AffiliateBulkResult[];
};

type PendingBulkConfirmation = {
  action: AffiliateBulkAction;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
};

type AffiliateDataSettings = {
  affiliate_data_mode: AffiliateDataMode;
  requested_affiliate_data_mode?: AffiliateDataMode;
  current_mode?: AffiliateDataMode;
  affiliate_data_marketplaces: Array<"amazon_in" | "amazon_us">;
  affiliate_creators_api_last_health_check_at?: string | null;
  affiliate_creators_api_health_status: "unchecked" | "ok" | "failed";
  affiliate_creators_api_last_error?: string | null;
  manual_available?: boolean;
  creators_adapter_implemented?: boolean;
  creators_env_configured?: boolean;
  creators_health_status?: "unchecked" | "ok" | "failed";
  creators_can_enable?: boolean;
  creators_can_refresh?: boolean;
  disabled_reason?: string | null;
  creators_api_ready: boolean;
  creators_api_env: {
    enabled: boolean;
    configured: boolean;
    missing: string[];
    marketplaces: string[];
  };
};

type AffiliateRefreshResponse = {
  ok?: boolean;
  status?: string;
  skipped?: boolean;
  reason?: string | null;
  message?: string | null;
  requested?: number;
  refreshed?: number;
  failed?: number;
};

const blankForm: AffiliateForm = {
  title: "",
  slug: "",
  affiliate_url: "",
  image_url: "",
  affiliate_marketplace: "amazon_in",
  affiliate_asin: "",
  sku: "",
  brand_name: "",
  category_id: "",
  subcategory_id: "",
  tags: "Affiliate",
  short_description: "",
  full_description: "",
  buying_intent: "",
  campaign_label: "",
  pros: "",
  cons: "",
  seo_title: "",
  seo_description: "",
  is_featured_affiliate: false,
  affiliate_is_instagram_pick: false,
  affiliate_sort_order: 0,
};

const isUncategorizedProduct = (product: PhysicalProduct) => {
  return (product.category || "").toLowerCase() === "uncategorized" || (product.subcategory || "").toLowerCase() === "uncategorized";
};

const MAX_AFFILIATE_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const splitPipeList = (value?: string[] | null) => Array.isArray(value) ? value.join(" | ") : "";

const formatDateTime = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const getAffiliateDataBadge = (product: PhysicalProduct) => {
  if (product.affiliate_data_source === "creators_api") {
    if (product.affiliate_api_error) return { label: "API error", className: "bg-rose-100 text-rose-800" };
    if (!product.affiliate_data_expires_at) return { label: "API missing expiry", className: "bg-amber-100 text-amber-800" };
    const expiresAt = new Date(product.affiliate_data_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return { label: "API expired", className: "bg-amber-100 text-amber-800" };
    return { label: "Creators API", className: "bg-emerald-100 text-emerald-800" };
  }
  return { label: product.affiliate_data_source === "excel-upload" ? "Excel review" : "Manual", className: "bg-slate-100 text-slate-700" };
};

const readinessPillClass = (ready: boolean) => ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800";

const quickFilterLabels: Record<AffiliateQuickFilter, string> = {
  all: "All",
  needs_review: "Needs review",
  published: "Published",
  draft: "Draft",
  paused: "Paused",
  uncategorized: "Uncategorized",
  missing_image: "Missing image",
  link_issue: "Link issue",
};

const bulkActionLabels: Record<AffiliateBulkAction, string> = {
  validate_compliance: "Validate",
  check_link: "Check links",
  publish: "Publish",
  unpublish: "Unpublish",
  pause: "Pause",
  feature: "Feature",
  unfeature: "Unfeature",
  instagram_pick: "Instagram pick",
  instagram_unpick: "Remove Instagram pick",
  refresh_api: "Refresh API",
  assign_category: "Assign category",
  delete: "Delete",
};

const isPublishedAffiliateProduct = (product: PhysicalProduct) => product.status === "active" && Boolean(product.is_visible);

const hasAffiliateLinkIssue = (product: PhysicalProduct) => {
  const status = String(product.affiliate_link_check_status || "unchecked").toLowerCase();
  return status === "unchecked" || status === "failed" || status === "invalid";
};

const filterMatchesAffiliateQuickFilter = (product: PhysicalProduct, filter: AffiliateQuickFilter) => {
  if (filter === "all") return true;
  if (filter === "needs_review") return product.affiliate_compliance_status !== "compliant";
  if (filter === "published") return isPublishedAffiliateProduct(product);
  if (filter === "draft") return product.status === "draft";
  if (filter === "paused") return product.status === "inactive" || product.affiliate_compliance_status === "paused";
  if (filter === "uncategorized") return isUncategorizedProduct(product);
  if (filter === "missing_image") return !product.featured_image;
  if (filter === "link_issue") return hasAffiliateLinkIssue(product);
  return true;
};

const isHttpOrUploadImage = (value?: string | null) => {
  const normalized = String(value || "").trim();
  return normalized.startsWith("/uploads/") || /^https?:\/\//i.test(normalized);
};

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
};

const downloadAffiliatePreviewErrorsCsv = (rows: AffiliatePreviewRow[]) => {
  const csvRows = [
    ["row", "title", "sku", "asin", "marketplace", "category", "subcategory", "errors"],
    ...rows.map((row) => [
      row.row ?? "",
      row.title ?? "",
      row.sku ?? "",
      row.asin ?? "",
      row.marketplace ?? "",
      row.category ?? "",
      row.subcategory ?? "",
      row.errors.join(" | "),
    ]),
  ];
  const csv = csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "affiliate-upload-preview-errors.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadTemplate = async () => {
  const rows = [TEMPLATE_COLUMNS, ...SAMPLE_ROWS.map((row) => TEMPLATE_COLUMNS.map((column) => row[column as keyof typeof row] ?? ""))];
  await downloadWorkbook("pinkpaisa_affiliate_upload_template.xlsx", [
    {
      name: "Affiliate Products",
      rows,
      widths: TEMPLATE_COLUMNS.map((column) => Math.max(column.length + 4, 20)),
    },
    {
      name: "Compliance Notes",
      rows: [
        ["Rule", "Details"],
        ["Disclosure", "Buyer CTAs use a short affiliate notice. The required Amazon Associate disclosure remains on the disclosure page and footer."],
        ["Affiliate URL", "Use Amazon.in or Amazon.com product URLs with your Associate tag parameter."],
        ["Manual image", "Optional. Use image_url for a direct image URL or /uploads/ path."],
        ["Buying intent and campaign", "Optional. Use them when you want better buyer context or campaign analytics."],
        ["Category", "Fill category and subcategory with active Pink Paisa taxonomy names before upload."],
        ["Do not import", "Do not rely on Amazon prices, star ratings, review text, or availability unless API-approved."],
        ["Publish", "Imported rows stay draft/review until admin validates and publishes."],
      ],
      widths: [24, 96],
    },
  ]);
};

export default function AdminAffiliateProducts() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<AffiliateQuickFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState<AffiliateBulkAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [apiRefreshing, setApiRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [form, setForm] = useState<AffiliateForm>(blankForm);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<AffiliatePreviewResponse | null>(null);
  const [confirmingUpload, setConfirmingUpload] = useState(false);
  const [pendingBulkConfirmation, setPendingBulkConfirmation] = useState<PendingBulkConfirmation | null>(null);
  const [productPendingDelete, setProductPendingDelete] = useState<PhysicalProduct | null>(null);

  const { data: affiliateProducts, isLoading } = useQuery({
    queryKey: ["affiliate_products"],
    queryFn: async () => apiFetch<PhysicalProduct[]>("/affiliate-products"),
  });

  const { data: affiliateDataSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["affiliate_data_settings"],
    queryFn: async () => apiFetch<AffiliateDataSettings>("/admin/settings/affiliate-data"),
  });

  const { data: taxonomy } = useProductTaxonomy({ includeInactive: true, includeUncategorized: false });
  const categories = useMemo(() => (taxonomy ?? []).filter((category) => category.slug !== "uncategorized"), [taxonomy]);
  const activeCategory = useMemo(() => categories.find((category) => category.id === categoryId), [categories, categoryId]);
  const formCategory = useMemo(() => categories.find((category) => category.id === form.category_id), [categories, form.category_id]);
  const subcategories = activeCategory?.subcategories ?? [];
  const formSubcategories = formCategory?.subcategories ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (affiliateProducts ?? []).filter((product) => {
      if (!filterMatchesAffiliateQuickFilter(product, quickFilter)) return false;
      if (!term) return true;
      return [
        product.title,
        product.sku ?? "",
        product.category ?? "",
        product.subcategory ?? "",
        product.affiliate_external_id ?? "",
        product.affiliate_asin ?? "",
        product.affiliate_marketplace ?? "",
        product.campaign_label ?? "",
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [affiliateProducts, quickFilter, search]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id));
  const selectedProducts = useMemo(() => {
    const selected = new Set(selectedIds);
    return (affiliateProducts ?? []).filter((product) => selected.has(product.id));
  }, [affiliateProducts, selectedIds]);
  const quickFilterItems = useMemo(() => {
    const products = affiliateProducts ?? [];
    return (Object.keys(quickFilterLabels) as AffiliateQuickFilter[]).map((value) => ({
      value,
      label: quickFilterLabels[value],
      count: products.filter((product) => filterMatchesAffiliateQuickFilter(product, value)).length,
    }));
  }, [affiliateProducts]);
  const uncategorizedCount = useMemo(() => (affiliateProducts ?? []).filter(isUncategorizedProduct).length, [affiliateProducts]);
  const publishedCount = useMemo(() => (affiliateProducts ?? []).filter((item) => item.status === "active" && item.is_visible).length, [affiliateProducts]);
  const reviewCount = useMemo(() => (affiliateProducts ?? []).filter((item) => item.affiliate_compliance_status !== "compliant").length, [affiliateProducts]);
  const editingProduct = useMemo(() => (form.id ? (affiliateProducts ?? []).find((product) => product.id === form.id) : null), [affiliateProducts, form.id]);
  const currentAffiliateMode = affiliateDataSettings?.current_mode || affiliateDataSettings?.affiliate_data_mode || "manual_only";
  const creatorsDisabledReason = affiliateDataSettings?.disabled_reason || affiliateDataSettings?.affiliate_creators_api_last_error || null;
  const manualImagePreviewUrl = form.image_url.trim();
  const canPreviewManualImage = isHttpOrUploadImage(manualImagePreviewUrl) && !imagePreviewFailed;
  const readinessRows = useMemo(() => {
    const env = affiliateDataSettings?.creators_api_env;
    const missing = new Set(env?.missing || []);
    return [
      { label: "Env enabled", ready: Boolean(env?.enabled) },
      { label: "Access key present", ready: Boolean(env) && !missing.has("AMAZON_CREATORS_API_ACCESS_KEY") },
      { label: "Secret key present", ready: Boolean(env) && !missing.has("AMAZON_CREATORS_API_SECRET_KEY") },
      { label: "Marketplace supported", ready: Boolean(env?.marketplaces?.length) },
      { label: "Health check passed", ready: affiliateDataSettings?.creators_health_status === "ok" || affiliateDataSettings?.affiliate_creators_api_health_status === "ok" },
      { label: "Adapter implemented", ready: Boolean(affiliateDataSettings?.creators_adapter_implemented) },
    ];
  }, [affiliateDataSettings]);
  const publishReadinessRows = [
    { label: "Title", ready: Boolean(form.title.trim()) },
    { label: "Tagged Amazon URL", ready: Boolean(form.affiliate_url.trim()) },
    { label: "ASIN and marketplace", ready: Boolean(form.affiliate_asin.trim() && form.affiliate_marketplace) },
    { label: "Category and subcategory", ready: Boolean(form.category_id && form.subcategory_id) },
    { label: "Buyer copy", ready: Boolean(form.short_description.trim()) },
    { label: "Pros and cons", ready: Boolean(form.pros.trim() && form.cons.trim()) },
    { label: "SEO", ready: Boolean(form.seo_title.trim() && form.seo_description.trim()) },
  ];
  const uploadPreviewRows = uploadPreview?.preview_rows ?? [];
  const invalidPreviewRows = uploadPreviewRows.filter((row) => row.status === "invalid");

  const refreshQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["affiliate_products"] });
    queryClient.invalidateQueries({ queryKey: ["affiliate_data_settings"] });
    queryClient.invalidateQueries({ queryKey: ["physical_products"] });
    queryClient.invalidateQueries({ queryKey: ["catalog_products"] });
    queryClient.invalidateQueries({ queryKey: ["catalog_facets"] });
  };

  const updateForm = (updates: Partial<AffiliateForm>) => setForm((current) => ({ ...current, ...updates }));

  const openCreate = () => {
    setForm(blankForm);
    setImagePreviewFailed(false);
    setFormOpen(true);
  };

  const openEdit = (product: PhysicalProduct) => {
    setForm({
      id: product.id,
      title: product.title || "",
      slug: product.slug || "",
      affiliate_url: product.affiliate_url || "",
      image_url: product.affiliate_data_source === "creators_api" || product.affiliate_data_source === "pa_api" ? "" : product.featured_image || "",
      affiliate_marketplace: product.affiliate_marketplace || "amazon_in",
      affiliate_asin: product.affiliate_asin || "",
      sku: product.sku || "",
      brand_name: product.brand_name || "",
      category_id: product.category_id || "",
      subcategory_id: product.subcategory_id || "",
      tags: Array.isArray(product.tags) ? product.tags.join(", ") : "",
      short_description: product.short_description || "",
      full_description: product.full_description || "",
      buying_intent: product.buying_intent || "",
      campaign_label: product.campaign_label || "",
      pros: splitPipeList(product.pros),
      cons: splitPipeList(product.cons),
      seo_title: product.seo_title || product.seo_meta_title || "",
      seo_description: product.seo_description || product.seo_meta_description || "",
      is_featured_affiliate: Boolean(product.is_featured_affiliate),
      affiliate_is_instagram_pick: Boolean(product.affiliate_is_instagram_pick),
      affiliate_sort_order: Number(product.affiliate_sort_order || 0),
    });
    setImagePreviewFailed(false);
    setFormOpen(true);
  };

  const toggleSelection = (productId: string) => {
    setSelectedIds((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]);
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !filtered.some((item) => item.id === id)));
      return;
    }
    setSelectedIds((current) => Array.from(new Set([...current, ...filtered.map((item) => item.id)])));
  };

  const saveAffiliateDataMode = async (mode: AffiliateDataMode) => {
    try {
      setSettingsSaving(true);
      const response = await apiFetch<AffiliateDataSettings & { message?: string }>("/admin/settings/affiliate-data", {
        method: "PUT",
        body: JSON.stringify({
          affiliate_data_mode: mode,
          affiliate_data_marketplaces: affiliateDataSettings?.affiliate_data_marketplaces?.length
            ? affiliateDataSettings.affiliate_data_marketplaces
            : ["amazon_in"],
        }),
      });
      toast.success(response.message || "Affiliate data settings updated");
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save affiliate data mode");
    } finally {
      setSettingsSaving(false);
    }
  };

  const runCreatorsHealthCheck = async () => {
    try {
      setHealthChecking(true);
      const response = await apiFetch<{ ok: boolean; message?: string; settings?: AffiliateDataSettings }>("/admin/settings/affiliate-data/health-check", {
        method: "POST",
      });
      toast.success(response.message || "Creators API health check completed");
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Creators API health check failed");
      refreshQueries();
    } finally {
      setHealthChecking(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx")) {
      toast.error("Upload a modern Excel file with .xlsx extension");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_AFFILIATE_IMPORT_FILE_SIZE_BYTES) {
      toast.error("Affiliate Excel uploads must be 5 MB or smaller");
      event.target.value = "";
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch<AffiliatePreviewResponse>("/affiliate-products/preview-excel", {
        method: "POST",
        body: formData,
      });
      setPendingUploadFile(file);
      setUploadPreview(response);
      toast.success(`Preview ready. ${response.summary.valid_rows} valid, ${response.summary.invalid_rows} issue(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to preview affiliate Excel");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const resetUploadPreview = () => {
    setPendingUploadFile(null);
    setUploadPreview(null);
  };

  const confirmUploadPreview = async () => {
    if (!pendingUploadFile || !uploadPreview?.has_valid_rows) return;

    try {
      setConfirmingUpload(true);
      const formData = new FormData();
      formData.append("file", pendingUploadFile);
      const response = await apiFetch<AffiliateUploadResponse>("/affiliate-products/upload-excel", {
        method: "POST",
        body: formData,
      });
      const skippedText = response.skipped > 0 ? ` ${response.skipped} row issue(s).` : "";
      toast.success(`Imported for review. Created ${response.created}, updated ${response.updated}.${skippedText}`);
      if (response.errors?.length) console.warn("Affiliate upload row issues", response.errors);
      resetUploadPreview();
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import affiliate Excel");
    } finally {
      setConfirmingUpload(false);
    }
  };

  const runBulkAction = async (action: AffiliateBulkAction, options: { payload?: Record<string, unknown> } = {}) => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one affiliate product");
      return false;
    }
    if (action === "refresh_api" && !affiliateDataSettings?.creators_can_refresh) {
      toast.error("Creators API refresh is not ready");
      return false;
    }

    const actedIds = new Set(selectedIds);
    try {
      setBulkActionLoading(action);
      const response = await apiFetch<AffiliateBulkResponse>("/affiliate-products/bulk-action", {
        method: "POST",
        body: JSON.stringify({
          product_ids: selectedIds,
          action,
          payload: options.payload || {},
        }),
      });
      const failedIds = new Set(response.results.filter((result) => !result.ok && result.id).map((result) => String(result.id)));
      if (response.failed > 0) {
        const sampleFailure = response.results.find((result) => !result.ok)?.message;
        toast.warning(`${bulkActionLabels[action]} complete: ${response.succeeded} succeeded, ${response.failed} failed.${sampleFailure ? ` ${sampleFailure}` : ""}`);
      } else {
        toast.success(`${bulkActionLabels[action]} complete for ${response.succeeded} product(s).`);
      }
      setSelectedIds((current) => current.filter((id) => !actedIds.has(id) || failedIds.has(id)));
      refreshQueries();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk action failed");
      return false;
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleAssign = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one affiliate product");
      return;
    }
    if (!categoryId || !subcategoryId) {
      toast.error("Select category and subcategory");
      return;
    }

    try {
      setAssigning(true);
      const ok = await runBulkAction("assign_category", {
        payload: {
          category_id: categoryId,
          subcategory_id: subcategoryId,
        },
      });
      if (ok) setCategoryDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign category");
    } finally {
      setAssigning(false);
    }
  };

  const refreshApiData = async (productIds: string[] = []) => {
    try {
      setApiRefreshing(true);
      const response = await apiFetch<AffiliateRefreshResponse>("/affiliate-products/refresh-api-data", {
        method: "POST",
        body: JSON.stringify({ product_ids: productIds }),
      });
      toast.success(response.message || `Creators refresh complete. Refreshed ${response.refreshed ?? 0}, failed ${response.failed ?? 0}.`);
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Creators API refresh failed");
      refreshQueries();
    } finally {
      setApiRefreshing(false);
    }
  };

  const handleSave = async () => {
    const manualImageUrl = form.image_url.trim();
    const requiredFields = [
      { key: "title", label: "Title", value: form.title },
      { key: "affiliate_url", label: "Affiliate URL with tag", value: form.affiliate_url },
      { key: "affiliate_marketplace", label: "Marketplace", value: form.affiliate_marketplace },
      { key: "affiliate_asin", label: "ASIN", value: form.affiliate_asin },
      { key: "category_id", label: "Category", value: form.category_id },
      { key: "subcategory_id", label: "Subcategory", value: form.subcategory_id },
      { key: "short_description", label: "Short description", value: form.short_description },
      { key: "pros", label: "Pros", value: form.pros },
      { key: "cons", label: "Cons", value: form.cons },
      { key: "seo_title", label: "SEO title", value: form.seo_title },
      { key: "seo_description", label: "SEO description", value: form.seo_description },
    ];
    const missing = requiredFields.filter((field) => !String(field.value || "").trim());
    if (missing.length) {
      toast.error(`Required: ${missing.slice(0, 4).map((field) => field.label).join(", ")}${missing.length > 4 ? "..." : ""}`);
      return;
    }
    const payload = {
      ...form,
      image_url: manualImageUrl,
      manual_image_url: manualImageUrl,
      featured_image: manualImageUrl || null,
      pros: form.pros.split("|").map((item) => item.trim()).filter(Boolean),
      cons: form.cons.split("|").map((item) => item.trim()).filter(Boolean),
      tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
      seo_meta_title: form.seo_title,
      seo_meta_description: form.seo_description,
    };

    try {
      setSaving(true);
      await apiFetch(form.id ? `/affiliate-products/${form.id}` : "/affiliate-products", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast.success(form.id ? "Affiliate product updated" : "Affiliate product created for review");
      setFormOpen(false);
      setForm(blankForm);
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save affiliate product");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (path: string, success: string, options: RequestInit = {}) => {
    try {
      await apiFetch(path, options);
      toast.success(success);
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  };

  const requestBulkPause = () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one affiliate product");
      return;
    }
    setPendingBulkConfirmation({
      action: "pause",
      title: "Pause selected affiliate products",
      description: `Pause ${selectedIds.length} selected affiliate product(s)? They will be hidden from buyer pages until republished.`,
      confirmLabel: "Pause products",
    });
  };

  const requestBulkDelete = () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one affiliate product");
      return;
    }
    setPendingBulkConfirmation({
      action: "delete",
      title: "Delete selected affiliate products",
      description: `Delete safe drafts from ${selectedIds.length} selected affiliate product(s)? Published products will be blocked by the server and must be unpublished first.`,
      confirmLabel: "Delete safe drafts",
      destructive: true,
    });
  };

  const confirmBulkAction = async () => {
    if (!pendingBulkConfirmation) return;
    const { action } = pendingBulkConfirmation;
    const ok = await runBulkAction(action);
    if (ok) setPendingBulkConfirmation(null);
  };

  const confirmDeleteProduct = async () => {
    if (!productPendingDelete) return;
    const product = productPendingDelete;
    await runAction(`/affiliate-products/${product.id}`, "Affiliate product deleted", { method: "DELETE" });
    setProductPendingDelete(null);
  };

  const renderBulkActionsMenu = (triggerLabel = "More", includePrimaryActions = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-xl">
          {triggerLabel}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{selectedIds.length} selected</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {includePrimaryActions ? (
          <>
            <DropdownMenuItem onSelect={() => void runBulkAction("publish")} disabled={bulkActionLoading !== null}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Publish selected
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void runBulkAction("unpublish")} disabled={bulkActionLoading !== null}>
              <XCircle className="mr-2 h-4 w-4" />
              Unpublish selected
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={requestBulkPause} disabled={bulkActionLoading !== null}>
              <PauseCircle className="mr-2 h-4 w-4" />
              Pause selected
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void runBulkAction("feature")} disabled={bulkActionLoading !== null}>
              <Star className="mr-2 h-4 w-4" />
              Feature selected
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCategoryDialogOpen(true)} disabled={bulkActionLoading !== null}>
              <Tags className="mr-2 h-4 w-4" />
              Assign category
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => void runBulkAction("validate_compliance")} disabled={bulkActionLoading !== null}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Validate compliance
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void runBulkAction("check_link")} disabled={bulkActionLoading !== null}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Check Amazon links
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void runBulkAction("refresh_api")} disabled={bulkActionLoading !== null || !affiliateDataSettings?.creators_can_refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Creators API
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void runBulkAction("instagram_pick")} disabled={bulkActionLoading !== null}>
          <Instagram className="mr-2 h-4 w-4" />
          Mark Instagram pick
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void runBulkAction("instagram_unpick")} disabled={bulkActionLoading !== null}>
          <Instagram className="mr-2 h-4 w-4" />
          Remove Instagram pick
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void runBulkAction("unfeature")} disabled={bulkActionLoading !== null}>
          <Star className="mr-2 h-4 w-4" />
          Unfeature selected
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={requestBulkDelete}
          disabled={bulkActionLoading !== null}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete safe drafts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="mb-1 font-serif text-2xl">Affiliate Products</h2>
          <p className="text-sm text-muted-foreground">
            Manage Amazon.in and Amazon.com picks. Imported rows stay draft/review until validation and publish.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Buyer CTAs use a short affiliate notice. The full Amazon Associate disclosure remains available site-wide.
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="rounded-xl">
          Add Affiliate Product
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Affiliate Products" value={(affiliateProducts ?? []).length} />
        <StatCard label="Published" value={publishedCount} color="text-emerald-600" />
        <StatCard label="Needs Review" value={reviewCount} color="text-amber-600" />
        <StatCard label="Uncategorized" value={uncategorizedCount} color="text-amber-600" />
        <StatCard label="Selected" value={selectedIds.length} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="font-serif text-lg">Amazon Data Source</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${currentAffiliateMode === "creators_api" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                {currentAffiliateMode === "creators_api" ? "Creators API active" : "Manual Only active"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${affiliateDataSettings?.creators_can_enable ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {affiliateDataSettings?.creators_can_enable ? "Creators API ready to enable" : "Creators API locked"}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Manual mode is fastest for now: use tagged Amazon links, your own copy, and an optional direct image URL.
              Creators API mode can refresh Amazon image and price data later, but it stays locked until every readiness check passes.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {readinessRows.map((row) => (
                <span key={row.label} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${readinessPillClass(row.ready)}`}>
                  {row.ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {row.label}
                </span>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p>Requested mode: {affiliateDataSettings?.requested_affiliate_data_mode || affiliateDataSettings?.affiliate_data_mode || "manual_only"}</p>
              <p>Effective mode: {currentAffiliateMode}</p>
              <p>Health: {settingsLoading ? "Loading..." : affiliateDataSettings?.creators_health_status || affiliateDataSettings?.affiliate_creators_api_health_status || "unchecked"}</p>
              <p>Last check: {formatDateTime(affiliateDataSettings?.affiliate_creators_api_last_health_check_at)}</p>
              {affiliateDataSettings?.creators_api_env?.missing?.length ? (
                <p className="sm:col-span-2 text-amber-700">
                  Missing: {affiliateDataSettings.creators_api_env.missing.join(", ")}
                </p>
              ) : null}
              {affiliateDataSettings?.affiliate_creators_api_last_error ? (
                <p className="sm:col-span-2 text-rose-700">Last error: {affiliateDataSettings.affiliate_creators_api_last_error}</p>
              ) : null}
              {creatorsDisabledReason ? (
                <p className="sm:col-span-2 text-amber-700">Locked reason: {creatorsDisabledReason}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button type="button" variant="outline" onClick={() => void runCreatorsHealthCheck()} disabled={healthChecking || settingsLoading} className="rounded-xl">
              <RefreshCw className={`h-4 w-4 ${healthChecking ? "animate-spin" : ""}`} />
              {healthChecking ? "Checking..." : "Check Creators API readiness"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void saveAffiliateDataMode("manual_only")} disabled={settingsSaving || (currentAffiliateMode === "manual_only" && affiliateDataSettings?.requested_affiliate_data_mode !== "creators_api")} className="rounded-xl">
              Use Manual Only
            </Button>
            <Button type="button" onClick={() => void saveAffiliateDataMode("creators_api")} disabled={settingsSaving || !affiliateDataSettings?.creators_can_enable} className="rounded-xl">
              Enable Creators API
            </Button>
            <Button type="button" variant="outline" onClick={() => void refreshApiData(selectedIds)} disabled={apiRefreshing || !affiliateDataSettings?.creators_can_refresh || selectedIds.length === 0} className="rounded-xl">
              <RefreshCw className={`h-4 w-4 ${apiRefreshing ? "animate-spin" : ""}`} />
              Refresh Selected
            </Button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>Manual image URL is shown as admin-provided media, not Amazon API-approved product data. Do not paste Amazon prices, ratings, reviews, or availability in manual mode.</p>
        </div>
      </div>

      {formOpen ? (
        <FormCard title={form.id ? "Edit Affiliate Product" : "Create Affiliate Product"} onClose={() => setFormOpen(false)}>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Manual entries must use your own product copy. Manual image URL is shown as admin-provided media, not Amazon API-approved product data.
            Do not add Amazon prices, ratings, review text, or availability manually.
          </div>
          {editingProduct?.affiliate_data_source === "creators_api" ? (
            <div className="grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-emerald-200 bg-white">
                {editingProduct.featured_image ? (
                  <img src={editingProduct.featured_image} alt={editingProduct.title} className="h-full w-full object-cover" />
                ) : (
                  <Database className="h-6 w-6 text-emerald-700" />
                )}
              </div>
              <div>
                <p className="font-semibold">Amazon API Data</p>
                <p className="text-xs leading-5 text-emerald-900">
                  API status: {getAffiliateDataBadge(editingProduct).label}. Last refreshed {formatDateTime(editingProduct.affiliate_data_last_refreshed_at)}. Expires {formatDateTime(editingProduct.affiliate_data_expires_at)}.
                  {editingProduct.affiliate_api_error ? ` Error: ${editingProduct.affiliate_api_error}` : ""}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!affiliateDataSettings?.creators_can_refresh} onClick={() => void runAction(`/affiliate-products/${editingProduct.id}/refresh-api-data`, "Creators API refresh attempted", { method: "POST" })}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title *">
              <Input value={form.title} onChange={(event) => updateForm({ title: event.target.value })} />
            </Field>
            <Field label="Slug">
              <Input value={form.slug} onChange={(event) => updateForm({ slug: event.target.value })} placeholder="Auto-generated if blank" />
            </Field>
            <Field label="Amazon Affiliate URL with tag *">
              <Input value={form.affiliate_url} onChange={(event) => updateForm({ affiliate_url: event.target.value })} placeholder="https://www.amazon.in/dp/ASIN?tag=..." />
            </Field>
            <Field label="Manual Image URL">
              <Input value={form.image_url} onChange={(event) => { setImagePreviewFailed(false); updateForm({ image_url: event.target.value }); }} placeholder="https://your-cdn.example.com/product.jpg or /uploads/image.webp" />
              <p className="mt-1 text-xs text-muted-foreground">Optional. Supports direct image URLs, including media-hosted URLs, or /uploads/ paths.</p>
            </Field>
            <Field label="Marketplace *">
              <Select value={form.affiliate_marketplace} onValueChange={(value: "amazon_in" | "amazon_us") => updateForm({ affiliate_marketplace: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amazon_in">Amazon.in</SelectItem>
                  <SelectItem value="amazon_us">Amazon.com</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="ASIN *"
              hint="Amazon's unique product ID, usually the 10-character code after /dp/ in the Amazon URL. Required for duplicates and future API refresh."
            >
              <Input value={form.affiliate_asin} onChange={(event) => updateForm({ affiliate_asin: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="SKU">
              <Input value={form.sku} onChange={(event) => updateForm({ sku: event.target.value })} />
            </Field>
            <Field label="Category *">
              <Select value={form.category_id} onValueChange={(value) => updateForm({ category_id: value, subcategory_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Subcategory *">
              <Select value={form.subcategory_id} onValueChange={(value) => updateForm({ subcategory_id: value })} disabled={!form.category_id}>
                <SelectTrigger><SelectValue placeholder="Select subcategory" /></SelectTrigger>
                <SelectContent>
                  {formSubcategories.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Brand">
              <Input value={form.brand_name} onChange={(event) => updateForm({ brand_name: event.target.value })} />
            </Field>
            <Field label="Tags">
              <Input value={form.tags} onChange={(event) => updateForm({ tags: event.target.value })} placeholder="beauty, wellness" />
            </Field>
            <Field
              label="Buying Intent"
              hint="Optional. The reason someone would buy it, such as budget wireless mouse for work or giftable tech under Rs. 1,000."
            >
              <Input value={form.buying_intent} onChange={(event) => updateForm({ buying_intent: event.target.value })} placeholder="Budget wireless mouse for work and study" />
            </Field>
            <Field
              label="Campaign Label"
              hint="Optional. A tracking label for where you promote it, such as instagram-tech-finds or prime-day-picks."
            >
              <Input value={form.campaign_label} onChange={(event) => updateForm({ campaign_label: event.target.value })} placeholder="instagram-tech-finds" />
            </Field>
            <Field label="Sort Order">
              <Input type="number" value={form.affiliate_sort_order} onChange={(event) => updateForm({ affiliate_sort_order: Number(event.target.value) || 0 })} />
            </Field>
            <div className="space-y-3">
              <CheckboxField label="Featured affiliate pick" checked={form.is_featured_affiliate} onChange={(value) => updateForm({ is_featured_affiliate: value })} />
              <CheckboxField label="Instagram campaign pick" checked={form.affiliate_is_instagram_pick} onChange={(value) => updateForm({ affiliate_is_instagram_pick: value })} />
            </div>
          </div>
          <Field label="Short Description *">
            <textarea value={form.short_description} onChange={(event) => updateForm({ short_description: event.target.value })} className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </Field>
          <Field label="Full Description">
            <textarea value={form.full_description} onChange={(event) => updateForm({ full_description: event.target.value })} className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Pros *">
              <Input value={form.pros} onChange={(event) => updateForm({ pros: event.target.value })} placeholder="Separate items with |" />
            </Field>
            <Field label="Cons *">
              <Input value={form.cons} onChange={(event) => updateForm({ cons: event.target.value })} placeholder="Separate items with |" />
            </Field>
            <Field label="SEO Title *">
              <Input value={form.seo_title} onChange={(event) => updateForm({ seo_title: event.target.value })} />
            </Field>
            <Field label="SEO Description *">
              <Input value={form.seo_description} onChange={(event) => updateForm({ seo_description: event.target.value })} />
            </Field>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Buyer Card Preview</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="aspect-video bg-accent/30">
                  {canPreviewManualImage ? (
                    <img src={manualImagePreviewUrl} alt={form.title || "Affiliate product preview"} onError={() => setImagePreviewFailed(true)} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      {manualImagePreviewUrl ? "Image preview unavailable" : "No manual image added"}
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{form.category_id ? formCategory?.name || "Category" : "Category"}</p>
                  <p className="font-serif text-lg leading-tight">{form.title || "Affiliate product title"}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{form.short_description || "Short benefit-focused description will appear here."}</p>
                  <p className="text-xs text-muted-foreground">Confirm price and availability on Amazon.</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Publish Readiness</p>
              <div className="space-y-2">
                {publishReadinessRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${readinessPillClass(row.ready)}`}>
                      {row.ready ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {row.ready ? "Ready" : "Missing"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Save creates a draft/review product. Publish remains blocked until the backend compliance gate validates URL tag, ASIN, marketplace, category, and required copy.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save for Review"}</Button>
          </div>
        </FormCard>
      ) : null}

      <Dialog open={Boolean(uploadPreview)} onOpenChange={(open) => { if (!open && !confirmingUpload) resetUploadPreview(); }}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Preview Affiliate Excel Upload</DialogTitle>
            <DialogDescription>
              Review rows before importing. Valid rows will be saved as draft/review products only after confirmation.
            </DialogDescription>
          </DialogHeader>

          {uploadPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total rows</p>
                  <p className="mt-1 font-serif text-2xl">{uploadPreview.summary.total_rows}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Valid rows</p>
                  <p className="mt-1 font-serif text-2xl text-emerald-700">{uploadPreview.summary.valid_rows}</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">Issues</p>
                  <p className="mt-1 font-serif text-2xl text-rose-700">{uploadPreview.summary.invalid_rows}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Create</p>
                  <p className="mt-1 font-serif text-2xl">{uploadPreview.summary.create_count}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Update</p>
                  <p className="mt-1 font-serif text-2xl">{uploadPreview.summary.update_count}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border">
                <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>{pendingUploadFile?.name || uploadPreview.meta?.file_name || "Selected workbook"}</span>
                  <span>{uploadPreview.meta?.sheet_name ? `Sheet: ${uploadPreview.meta.sheet_name}` : "First sheet"}</span>
                </div>
                <div className="max-h-[52vh] overflow-auto">
                  <table className="min-w-[920px] w-full text-left text-sm">
                    <thead className="sticky top-0 bg-background text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Image</th>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">ASIN</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {uploadPreviewRows.map((row, index) => (
                        <tr key={`${row.row || "row"}-${index}`} className={row.status === "invalid" ? "bg-rose-50/60" : "bg-card"}>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{row.row || "-"}</td>
                          <td className="px-3 py-3">
                            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-[10px] text-muted-foreground">
                              {row.image_url && isHttpOrUploadImage(row.image_url) ? (
                                <img src={row.image_url} alt={row.title || "Preview product"} className="h-full w-full object-cover" />
                              ) : (
                                "No image"
                              )}
                            </div>
                          </td>
                          <td className="max-w-[280px] px-3 py-3">
                            <p className="line-clamp-2 font-medium">{row.title || "Untitled row"}</p>
                            {row.sku ? <p className="mt-1 truncate text-xs text-muted-foreground">SKU: {row.sku}</p> : null}
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <p>{row.asin || "Missing"}</p>
                            <p className="mt-1 text-muted-foreground">{row.marketplace || "Marketplace missing"}</p>
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-xs">
                            <p className="truncate">{row.category || "Missing category"}</p>
                            <p className="mt-1 truncate text-muted-foreground">{row.subcategory || "Missing subcategory"}</p>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.action === "update" ? "bg-blue-100 text-blue-800" : row.action === "create" ? "bg-slate-100 text-slate-700" : "bg-muted text-muted-foreground"}`}>
                              {row.action || "Skip"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.status === "valid" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                              {row.status === "valid" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                              {row.status}
                            </span>
                          </td>
                          <td className="max-w-[260px] px-3 py-3 text-xs">
                            {row.errors.length ? (
                              <p className="line-clamp-3 text-rose-700">{row.errors.join(" | ")}</p>
                            ) : (
                              <p className="text-emerald-700">Ready for review import</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>Confirming this import saves valid rows as unpublished draft/review products. Invalid rows are skipped and can be downloaded as CSV.</p>
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:space-x-0">
            {invalidPreviewRows.length ? (
              <Button type="button" variant="outline" onClick={() => downloadAffiliatePreviewErrorsCsv(invalidPreviewRows)} disabled={confirmingUpload}>
                Download Errors CSV
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={resetUploadPreview} disabled={confirmingUpload}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmUploadPreview()} disabled={confirmingUpload || !uploadPreview?.has_valid_rows}>
              {confirmingUpload ? "Importing..." : "Confirm Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Assign Category</DialogTitle>
            <DialogDescription>
              Apply one category and subcategory to {selectedIds.length} selected affiliate product(s). Products still need validation before publishing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Category">
              <Select value={categoryId} onValueChange={(value) => { setCategoryId(value); setSubcategoryId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Subcategory">
              <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                <SelectTrigger><SelectValue placeholder="Select subcategory" /></SelectTrigger>
                <SelectContent>
                  {subcategories.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)} disabled={assigning || bulkActionLoading === "assign_category"}>
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assigning || bulkActionLoading === "assign_category" || selectedIds.length === 0 || !categoryId || !subcategoryId}>
              <Tags className="h-4 w-4" />
              {assigning || bulkActionLoading === "assign_category" ? "Assigning..." : "Assign Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(pendingBulkConfirmation)}
        onOpenChange={(open) => {
          if (!open && bulkActionLoading !== pendingBulkConfirmation?.action) setPendingBulkConfirmation(null);
        }}
        title={pendingBulkConfirmation?.title || "Confirm bulk action"}
        description={pendingBulkConfirmation?.description}
        confirmLabel={pendingBulkConfirmation?.confirmLabel || "Confirm"}
        destructive={Boolean(pendingBulkConfirmation?.destructive)}
        pending={bulkActionLoading === pendingBulkConfirmation?.action}
        onConfirm={confirmBulkAction}
      />

      <ConfirmActionDialog
        open={Boolean(productPendingDelete)}
        onOpenChange={(open) => {
          if (!open) setProductPendingDelete(null);
        }}
        title="Delete affiliate product"
        description={
          productPendingDelete
            ? `Delete "${productPendingDelete.title}"? This cannot be undone. Published products should be unpublished first.`
            : undefined
        }
        confirmLabel="Delete product"
        destructive
        onConfirm={confirmDeleteProduct}
      />

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, ASIN, campaign or category" className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void downloadTemplate()} className="rounded-xl">
              <Download className="h-4 w-4" />
              Download Template
            </Button>
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-xl">
              {uploading ? <FileSpreadsheet className="h-4 w-4 animate-pulse" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Previewing..." : "Upload Excel"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void runAction("/affiliate-products/backfill-compliance", "Existing affiliate products moved to review", { method: "POST" })} className="rounded-xl">
              Review Existing
            </Button>
            <Button type="button" variant="outline" onClick={() => void runAction("/affiliate-products/backfill-images", "Affiliate product images backfilled", { method: "POST" })} className="rounded-xl">
              <ImageIcon className="h-4 w-4" />
              Backfill Images
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={(event) => void handleUpload(event)} className="hidden" />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickFilterItems.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setQuickFilter(item.value)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                quickFilter === item.value
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {item.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${quickFilter === item.value ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {item.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <>
          <div className="sticky top-3 z-20 hidden items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-lg backdrop-blur md:flex">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{selectedIds.length} selected</p>
              <p className="truncate text-xs text-muted-foreground">
                {selectedProducts.slice(0, 3).map((product) => product.title).join(", ")}
                {selectedProducts.length > 3 ? ` +${selectedProducts.length - 3} more` : ""}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void runBulkAction("validate_compliance")} disabled={bulkActionLoading !== null}>
                <CheckCircle2 className="h-4 w-4" />
                Validate
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void runBulkAction("check_link")} disabled={bulkActionLoading !== null}>
                <ExternalLink className="h-4 w-4" />
                Check links
              </Button>
              <Button type="button" size="sm" className="rounded-xl" onClick={() => void runBulkAction("publish")} disabled={bulkActionLoading !== null}>
                <CheckCircle2 className="h-4 w-4" />
                Publish
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void runBulkAction("unpublish")} disabled={bulkActionLoading !== null}>
                <XCircle className="h-4 w-4" />
                Unpublish
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={requestBulkPause} disabled={bulkActionLoading !== null}>
                <PauseCircle className="h-4 w-4" />
                Pause
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void runBulkAction("feature")} disabled={bulkActionLoading !== null}>
                <Star className="h-4 w-4" />
                Feature
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setCategoryDialogOpen(true)} disabled={bulkActionLoading !== null}>
                <Tags className="h-4 w-4" />
                Assign category
              </Button>
              {renderBulkActionsMenu("More")}
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setSelectedIds([])} disabled={bulkActionLoading !== null}>
                <X className="h-4 w-4" />
                Clear
              </Button>
            </div>
          </div>

          <div className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-2xl backdrop-blur md:hidden">
            <div>
              <p className="text-sm font-semibold">{selectedIds.length} selected</p>
              <p className="text-xs text-muted-foreground">{bulkActionLoading ? `${bulkActionLabels[bulkActionLoading]} running...` : "Bulk actions"}</p>
            </div>
            <div className="flex items-center gap-2">
              {renderBulkActionsMenu("Actions", true)}
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds([])} disabled={bulkActionLoading !== null} aria-label="Clear selected affiliate products">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-input text-primary" />
            Select visible results
          </label>
          <span>{filtered.length} item(s)</span>
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Tags} text="No affiliate products found" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((product) => {
              const uncategorized = isUncategorizedProduct(product);
              const flags = product.affiliate_compliance_flags ?? [];
              const published = isPublishedAffiliateProduct(product);
              const dataBadge = getAffiliateDataBadge(product);
              const linkStatus = String(product.affiliate_link_check_status || "unchecked").toLowerCase();
              return (
                <div key={product.id} className={`grid gap-4 px-4 py-4 transition hover:bg-muted/30 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center ${selectedIds.includes(product.id) ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleSelection(product.id)} className="h-4 w-4 rounded border-input text-primary" />
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted text-xs font-semibold text-muted-foreground">
                      {product.featured_image ? (
                        <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover" />
                      ) : (
                        product.affiliate_marketplace === "amazon_us" ? "US" : "IN"
                      )}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">{product.title}</h4>
                      <StatusBadge status={product.status} />
                      <StatusBadge status={product.affiliate_compliance_status || "needs_review"} />
                      {published ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Published</span> : null}
                      {uncategorized ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Uncategorized</span> : null}
                      {!product.featured_image ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Missing image</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dataBadge.className}`}>{dataBadge.label}</span>
                      {linkStatus !== "ok" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Link {linkStatus}</span> : null}
                      {product.is_featured_affiliate ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
                      {product.affiliate_is_instagram_pick ? <Instagram className="h-4 w-4 text-pink-600" /> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {product.category} / {product.subcategory || "Uncategorized"} - ASIN: {product.affiliate_asin || "missing"} - {product.affiliate_marketplace || "marketplace missing"}
                      {product.campaign_label ? ` - Campaign: ${product.campaign_label}` : ""}
                    </p>
                    {flags.length ? (
                      <p className="mt-1 line-clamp-2 text-xs text-amber-700">Flags: {flags.join(", ")}</p>
                    ) : (
                      <p className="mt-1 text-xs text-emerald-700">No current compliance flags. Ready to publish after category review.</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      API refresh: {formatDateTime(product.affiliate_data_last_refreshed_at)} - Expires: {formatDateTime(product.affiliate_data_expires_at)}
                      {product.affiliate_api_error ? ` - Error: ${product.affiliate_api_error}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => openEdit(product)}>
                      <Edit className="h-4 w-4" /> Edit
                    </Button>
                    {published ? (
                      <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void runAction(`/affiliate-products/${product.id}/unpublish`, "Affiliate product unpublished", { method: "POST" })}>
                        <XCircle className="h-4 w-4" /> Unpublish
                      </Button>
                    ) : (
                      <Button type="button" size="sm" className="rounded-xl" onClick={() => void runAction(`/affiliate-products/${product.id}/publish`, "Affiliate product published", { method: "POST" })}>
                        <CheckCircle2 className="h-4 w-4" /> Publish
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="rounded-xl" aria-label={`More actions for ${product.title}`}>
                          <MoreHorizontal className="h-4 w-4" />
                          More
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Product actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void runAction(`/affiliate-products/${product.id}/validate-compliance`, "Compliance rechecked", { method: "POST" })}>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Validate compliance
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void runAction(`/affiliate-products/${product.id}/check-link`, "Amazon link checked", { method: "POST" })}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Check Amazon link
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!affiliateDataSettings?.creators_can_refresh} onSelect={() => void runAction(`/affiliate-products/${product.id}/refresh-api-data`, "Creators API refresh attempted", { method: "POST" })}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Refresh Creators API
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void runAction(`/affiliate-products/${product.id}/pause`, "Affiliate product paused", { method: "POST" })}>
                          <PauseCircle className="mr-2 h-4 w-4" />
                          Pause product
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void runAction(`/affiliate-products/${product.id}/feature`, "Feature settings updated", {
                          method: "PATCH",
                          body: JSON.stringify({
                            is_featured_affiliate: !product.is_featured_affiliate,
                            affiliate_is_instagram_pick: product.affiliate_is_instagram_pick,
                          }),
                        })}>
                          <Star className="mr-2 h-4 w-4" />
                          {product.is_featured_affiliate ? "Unfeature" : "Feature"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void runAction(`/affiliate-products/${product.id}/feature`, "Instagram pick updated", {
                          method: "PATCH",
                          body: JSON.stringify({
                            is_featured_affiliate: product.is_featured_affiliate,
                            affiliate_is_instagram_pick: !product.affiliate_is_instagram_pick,
                          }),
                        })}>
                          <Instagram className="mr-2 h-4 w-4" />
                          {product.affiliate_is_instagram_pick ? "Remove Instagram pick" : "Mark Instagram pick"}
                        </DropdownMenuItem>
                        {product.affiliate_url ? (
                          <DropdownMenuItem asChild>
                            <a href={product.affiliate_url} target="_blank" rel="sponsored noopener noreferrer nofollow">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Amazon
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setProductPendingDelete(product)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
