import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Edit,
  ExternalLink,
  FileSpreadsheet,
  Instagram,
  PauseCircle,
  RefreshCw,
  Search,
  Star,
  Tags,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

type AffiliateDataMode = "manual_only" | "creators_api";

type AffiliateDataSettings = {
  affiliate_data_mode: AffiliateDataMode;
  affiliate_data_marketplaces: Array<"amazon_in" | "amazon_us">;
  affiliate_creators_api_last_health_check_at?: string | null;
  affiliate_creators_api_health_status: "unchecked" | "ok" | "failed";
  affiliate_creators_api_last_error?: string | null;
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [apiRefreshing, setApiRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AffiliateForm>(blankForm);

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
  }, [affiliateProducts, search]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id));
  const uncategorizedCount = useMemo(() => (affiliateProducts ?? []).filter(isUncategorizedProduct).length, [affiliateProducts]);
  const publishedCount = useMemo(() => (affiliateProducts ?? []).filter((item) => item.status === "active" && item.is_visible).length, [affiliateProducts]);
  const reviewCount = useMemo(() => (affiliateProducts ?? []).filter((item) => item.affiliate_compliance_status !== "compliant").length, [affiliateProducts]);

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
      const response = await apiFetch<AffiliateUploadResponse>("/affiliate-products/upload-excel", {
        method: "POST",
        body: formData,
      });
      const skippedText = response.skipped > 0 ? ` ${response.skipped} row issue(s).` : "";
      toast.success(`Imported for review. Created ${response.created}, updated ${response.updated}.${skippedText}`);
      if (response.errors?.length) console.warn("Affiliate upload row issues", response.errors);
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload affiliate Excel");
    } finally {
      setUploading(false);
      event.target.value = "";
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
      await apiFetch("/affiliate-products/assign-category", {
        method: "PATCH",
        body: JSON.stringify({
          product_ids: selectedIds,
          category_id: categoryId,
          subcategory_id: subcategoryId,
        }),
      });
      toast.success("Affiliate products assigned. Validate and publish separately.");
      setSelectedIds([]);
      refreshQueries();
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
      toast.success(`Creators refresh complete. Refreshed ${response.refreshed ?? 0}, failed ${response.failed ?? 0}.`);
      refreshQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Creators API refresh failed");
      refreshQueries();
    } finally {
      setApiRefreshing(false);
    }
  };

  const handleSave = async () => {
    const requiredFields = [
      { key: "title", label: "Title", value: form.title },
      { key: "affiliate_url", label: "Affiliate URL with tag", value: form.affiliate_url },
      { key: "affiliate_marketplace", label: "Marketplace", value: form.affiliate_marketplace },
      { key: "affiliate_asin", label: "ASIN", value: form.affiliate_asin },
      { key: "category_id", label: "Category", value: form.category_id },
      { key: "subcategory_id", label: "Subcategory", value: form.subcategory_id },
      { key: "short_description", label: "Short description", value: form.short_description },
      { key: "buying_intent", label: "Buying intent", value: form.buying_intent },
      { key: "pros", label: "Pros", value: form.pros },
      { key: "cons", label: "Cons", value: form.cons },
      { key: "seo_title", label: "SEO title", value: form.seo_title },
      { key: "seo_description", label: "SEO description", value: form.seo_description },
      { key: "campaign_label", label: "Campaign label", value: form.campaign_label },
    ];
    const missing = requiredFields.filter((field) => !String(field.value || "").trim());
    if (missing.length) {
      toast.error(`Required: ${missing.slice(0, 4).map((field) => field.label).join(", ")}${missing.length > 4 ? "..." : ""}`);
      return;
    }
    const payload = {
      ...form,
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

  const handleDelete = async (product: PhysicalProduct) => {
    if (!window.confirm(`Delete ${product.title}?`)) return;
    await runAction(`/affiliate-products/${product.id}`, "Affiliate product deleted", { method: "DELETE" });
  };

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
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${affiliateDataSettings?.affiliate_data_mode === "creators_api" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                {affiliateDataSettings?.affiliate_data_mode === "creators_api" ? "Creators API mode" : "Manual only"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${affiliateDataSettings?.creators_api_env?.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {affiliateDataSettings?.creators_api_env?.configured ? "API env configured" : "API env missing"}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Manual mode is fastest for now: use tagged Amazon links, your own copy, and an optional direct image URL.
              Creators API mode can refresh Amazon image and price data later, but buyer pages only show it while the API data is fresh.
            </p>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p>Health: {settingsLoading ? "Loading..." : affiliateDataSettings?.affiliate_creators_api_health_status || "unchecked"}</p>
              <p>Last check: {formatDateTime(affiliateDataSettings?.affiliate_creators_api_last_health_check_at)}</p>
              {affiliateDataSettings?.creators_api_env?.missing?.length ? (
                <p className="sm:col-span-2 text-amber-700">
                  Missing: {affiliateDataSettings.creators_api_env.missing.join(", ")}
                </p>
              ) : null}
              {affiliateDataSettings?.affiliate_creators_api_last_error ? (
                <p className="sm:col-span-2 text-rose-700">Last error: {affiliateDataSettings.affiliate_creators_api_last_error}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button type="button" variant="outline" onClick={() => void runCreatorsHealthCheck()} disabled={healthChecking || settingsLoading} className="rounded-xl">
              <RefreshCw className={`h-4 w-4 ${healthChecking ? "animate-spin" : ""}`} />
              {healthChecking ? "Checking..." : "Test API"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void saveAffiliateDataMode("manual_only")} disabled={settingsSaving || affiliateDataSettings?.affiliate_data_mode === "manual_only"} className="rounded-xl">
              Manual Only
            </Button>
            <Button type="button" onClick={() => void saveAffiliateDataMode("creators_api")} disabled={settingsSaving || !affiliateDataSettings?.creators_api_env?.configured || affiliateDataSettings?.affiliate_creators_api_health_status !== "ok"} className="rounded-xl">
              Enable Creators API
            </Button>
            <Button type="button" variant="outline" onClick={() => void refreshApiData(selectedIds)} disabled={apiRefreshing || affiliateDataSettings?.affiliate_data_mode !== "creators_api" || selectedIds.length === 0} className="rounded-xl">
              <RefreshCw className={`h-4 w-4 ${apiRefreshing ? "animate-spin" : ""}`} />
              Refresh Selected
            </Button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>Do not paste Amazon prices, ratings, reviews, or availability in manual mode. Use Check price on Amazon until approved API data is available.</p>
        </div>
      </div>

      {formOpen ? (
        <FormCard title={form.id ? "Edit Affiliate Product" : "Create Affiliate Product"} onClose={() => setFormOpen(false)}>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Manual entries must use your own product copy. Images are optional and can use a direct image URL or upload path.
            Do not add Amazon prices, ratings, review text, or availability manually.
          </div>
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
              <Input value={form.image_url} onChange={(event) => updateForm({ image_url: event.target.value })} placeholder="https://your-cdn.example.com/product.jpg or /uploads/image.webp" />
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
            <Field label="ASIN *">
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
            <Field label="Buying Intent *">
              <Input value={form.buying_intent} onChange={(event) => updateForm({ buying_intent: event.target.value })} />
            </Field>
            <Field label="Campaign Label *">
              <Input value={form.campaign_label} onChange={(event) => updateForm({ campaign_label: event.target.value })} />
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Draft"}</Button>
          </div>
        </FormCard>
      ) : null}

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
              {uploading ? "Uploading..." : "Upload Excel"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void runAction("/affiliate-products/backfill-compliance", "Existing affiliate products moved to review", { method: "POST" })} className="rounded-xl">
              Review Existing
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={(event) => void handleUpload(event)} className="hidden" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label="Assign Category">
            <Select value={categoryId} onValueChange={(value) => { setCategoryId(value); setSubcategoryId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assign Subcategory">
            <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
              <SelectTrigger><SelectValue placeholder="Select subcategory" /></SelectTrigger>
              <SelectContent>
                {subcategories.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={handleAssign} disabled={assigning || selectedIds.length === 0 || !categoryId || !subcategoryId} className="rounded-xl">
            <Tags className="h-4 w-4" />
            {assigning ? "Assigning..." : "Assign to Selected"}
          </Button>
        </div>
      </div>

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
              const published = product.status === "active" && product.is_visible;
              const dataBadge = getAffiliateDataBadge(product);
              return (
                <div key={product.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleSelection(product.id)} className="h-4 w-4 rounded border-input text-primary" />
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted text-xs font-semibold text-muted-foreground">
                      {product.affiliate_marketplace === "amazon_us" ? "US" : "IN"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-medium">{product.title}</h4>
                      <StatusBadge status={product.status} />
                      <StatusBadge status={product.affiliate_compliance_status || "needs_review"} />
                      {published ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Published</span> : null}
                      {uncategorized ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Uncategorized</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dataBadge.className}`}>{dataBadge.label}</span>
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
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(product)}>
                      <Edit className="h-4 w-4" /> Edit
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/validate-compliance`, "Compliance rechecked", { method: "POST" })}>
                      <CheckCircle2 className="h-4 w-4" /> Validate
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/check-link`, "Amazon link checked", { method: "POST" })}>
                      <ExternalLink className="h-4 w-4" /> Check Link
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={affiliateDataSettings?.affiliate_data_mode !== "creators_api"} onClick={() => void runAction(`/affiliate-products/${product.id}/refresh-api-data`, "Creators API refresh attempted", { method: "POST" })}>
                      <RefreshCw className="h-4 w-4" /> Refresh API
                    </Button>
                    {published ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/unpublish`, "Affiliate product unpublished", { method: "POST" })}>
                        <XCircle className="h-4 w-4" /> Unpublish
                      </Button>
                    ) : (
                      <Button type="button" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/publish`, "Affiliate product published", { method: "POST" })}>
                        <CheckCircle2 className="h-4 w-4" /> Publish
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/pause`, "Affiliate product paused", { method: "POST" })}>
                      <PauseCircle className="h-4 w-4" /> Pause
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void runAction(`/affiliate-products/${product.id}/feature`, "Feature settings updated", {
                      method: "PATCH",
                      body: JSON.stringify({
                        is_featured_affiliate: !product.is_featured_affiliate,
                        affiliate_is_instagram_pick: product.affiliate_is_instagram_pick,
                      }),
                    })}>
                      <Star className="h-4 w-4" /> {product.is_featured_affiliate ? "Unfeature" : "Feature"}
                    </Button>
                    {product.affiliate_url ? (
                      <a href={product.affiliate_url} target="_blank" rel="sponsored noopener noreferrer nofollow" className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm font-medium">
                        <ExternalLink className="h-4 w-4" /> Amazon
                      </a>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleDelete(product)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
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
