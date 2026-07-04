import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatPrice, StatusBadge } from "./AdminShared";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Clock3,
  IndianRupee,
  Package,
  ReceiptText,
  Sparkles,
  Store,
  TrendingUp,
  UserRoundSearch,
  Users,
} from "lucide-react";

type DashboardSection =
  | "orders"
  | "products"
  | "vendors"
  | "campaigns"
  | "vendor_outstanding"
  | "customers"
  | "analytics";

type DashboardStats = {
  totalOrders: number;
  revenue: number;
  profit: number;
  activeProducts: number;
  vendors: number;
  users: number;
  pendingVendorProducts: number;
  lowStockProducts: number;
  reviewDrafts: number;
  failedCampaigns: number;
  publishedCampaigns: number;
};

type DashboardOrder = {
  id?: string;
  order_number?: string | null;
  guest_name?: string | null;
  total?: number | string | null;
  status?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

type DashboardProduct = {
  id?: string;
  title?: string | null;
  status?: string | null;
  stock_quantity?: number | null;
};

type DashboardVendor = {
  id?: string;
  owner_name?: string | null;
  business_name?: string | null;
  shop_name?: string | null;
};

type DashboardUser = {
  id?: string;
};

type DashboardUserResponse = {
  items?: DashboardUser[];
  pagination?: { total?: number };
};

type DashboardVendorSubmission = {
  id?: string;
  title?: string | null;
  vendor_shop_name?: string | null;
  approval_status?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
};

type DashboardCampaignRun = {
  id: string;
  product_title?: string | null;
  vendor_shop_name?: string | null;
  status?: string | null;
  review_status?: string | null;
  publish_status?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
};

type VendorProductResponse = {
  items?: DashboardVendorSubmission[];
  counts?: { pending_approval?: number };
};

type VendorListResponse = {
  items?: DashboardVendor[];
};

type CampaignListResponse = {
  items?: DashboardCampaignRun[];
  counts?: {
    waiting_review?: number;
    failed?: number;
    published?: number;
  };
};

const INITIAL_STATS: DashboardStats = {
  totalOrders: 0,
  revenue: 0,
  profit: 0,
  activeProducts: 0,
  vendors: 0,
  users: 0,
  pendingVendorProducts: 0,
  lowStockProducts: 0,
  reviewDrafts: 0,
  failedCampaigns: 0,
  publishedCampaigns: 0,
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatCompact = (value: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const valueToneClasses: Record<"neutral" | "good" | "warn" | "accent", string> = {
  neutral: "text-foreground",
  good: "text-emerald-700",
  warn: "text-amber-700",
  accent: "text-primary",
};

const SummaryCard = ({
  label,
  value,
  meta,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "neutral" | "good" | "warn" | "accent";
  icon: typeof Package;
}) => (
  <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className={`text-3xl font-semibold tracking-tight ${valueToneClasses[tone]}`}>{value}</p>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </div>
);

const LoadingCard = () => (
  <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
    <div className="animate-pulse space-y-3">
      <div className="h-3 w-28 rounded-full bg-muted" />
      <div className="h-8 w-24 rounded-full bg-muted" />
      <div className="h-3 w-40 rounded-full bg-muted" />
    </div>
  </div>
);

export const AdminDashboard = ({ onNavigate }: { onNavigate?: (section: DashboardSection) => void }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);
  const [recentOrders, setRecentOrders] = useState<DashboardOrder[]>([]);
  const [recentCampaigns, setRecentCampaigns] = useState<DashboardCampaignRun[]>([]);
  const [recentVendorSubmissions, setRecentVendorSubmissions] = useState<DashboardVendorSubmission[]>([]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);

      const [orders, products, vendors, users, vendorProducts, campaigns] = await Promise.all([
        apiFetch<DashboardOrder[]>("/orders"),
        apiFetch<DashboardProduct[]>("/products?all=true"),
        apiFetch<VendorListResponse>("/vendors?status=all&page=1&limit=200"),
        apiFetch<DashboardUserResponse>("/users?page=1&limit=1"),
        apiFetch<VendorProductResponse>("/vendor-products/admin?approval_status=pending_approval&page=1&limit=6"),
        apiFetch<CampaignListResponse>("/marketing-campaigns/admin?page=1&limit=6"),
      ]);

      let calculatedProfit = 0;
      orders.forEach((order: any) => {
        if (order.status !== "cancelled") {
          (order.items || []).forEach((item: any) => {
            if (item.vendor_status === "delivered" && (!item.return_status || ["not_requested", "rejected"].includes(item.return_status))) {
              const deliveredAt = item.delivered_at || order.delivered_at;
              if (deliveredAt) {
                const returnHoldDays = item.returnable !== false ? item.return_window_days || 7 : 0;
                const releaseDate = new Date(deliveredAt);
                releaseDate.setDate(releaseDate.getDate() + returnHoldDays);

                if (releaseDate.getTime() <= Date.now()) {
                  if (item.source_type === "vendor") {
                    calculatedProfit += Number(item.commission_amount || 0);
                  } else {
                    calculatedProfit += (Number(item.price || 0) - Number(item.cost_price || 0)) * Number(item.quantity || 1);
                  }
                }
              }
            }
          });
        }
      });

      const activeProducts = products.filter((product) => product.status === "active");
      const lowStockProducts = activeProducts.filter((product) => Number(product.stock_quantity || 0) > 0 && Number(product.stock_quantity || 0) <= 5);

      setStats({
        totalOrders: orders.length,
        revenue: orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total || 0), 0),
        profit: calculatedProfit,
        activeProducts: activeProducts.length,
        vendors: vendors.items?.length || 0,
        users: users.pagination?.total || users.items?.length || 0,
        pendingVendorProducts: vendorProducts.counts?.pending_approval || 0,
        lowStockProducts: lowStockProducts.length,
        reviewDrafts: campaigns.counts?.waiting_review || 0,
        failedCampaigns: campaigns.counts?.failed || 0,
        publishedCampaigns: campaigns.counts?.published || 0,
      });

      setRecentOrders((orders || []).slice(0, 5));
      setRecentCampaigns(campaigns.items || []);
      setRecentVendorSubmissions(vendorProducts.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load admin dashboard");
      setStats(INITIAL_STATS);
      setRecentOrders([]);
      setRecentCampaigns([]);
      setRecentVendorSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const attentionItems = useMemo(
    () => [
      {
        label: "Vendor products waiting for approval",
        value: stats.pendingVendorProducts,
        tone: stats.pendingVendorProducts > 0 ? "warn" : "good",
        detail: stats.pendingVendorProducts > 0 ? "Review new seller submissions before they stall." : "Vendor catalog review queue is clear.",
        cta: "Open vendors",
        section: "vendors" as const,
      },
      {
        label: "Campaign drafts waiting for review",
        value: stats.reviewDrafts,
        tone: stats.reviewDrafts > 0 ? "warn" : "good",
        detail: stats.reviewDrafts > 0 ? "Instagram drafts are ready for approval and publishing." : "No campaign drafts are currently blocked on review.",
        cta: "Open campaigns",
        section: "campaigns" as const,
      },
      {
        label: "Failed campaign runs",
        value: stats.failedCampaigns,
        tone: stats.failedCampaigns > 0 ? "warn" : "good",
        detail: stats.failedCampaigns > 0 ? "Regenerate or inspect failed creative and publish runs." : "Campaign pipeline is healthy right now.",
        cta: "Inspect pipeline",
        section: "campaigns" as const,
      },
      {
        label: "Low-stock active products",
        value: stats.lowStockProducts,
        tone: stats.lowStockProducts > 0 ? "warn" : "good",
        detail: stats.lowStockProducts > 0 ? "These products may need restocking or hiding soon." : "Stock depth looks stable across active products.",
        cta: "Open catalog",
        section: "products" as const,
      },
    ],
    [stats.failedCampaigns, stats.lowStockProducts, stats.pendingVendorProducts, stats.reviewDrafts],
  );

  const quickActions = [
    { label: "Review vendor queue", note: "Approve sellers and their products faster.", section: "vendors" as const },
    { label: "Open campaigns", note: "Review drafts, publish, and monitor failures.", section: "campaigns" as const },
    { label: "Check orders", note: "See the latest buyer activity and statuses.", section: "orders" as const },
    { label: "Vendor payouts", note: "Release ready settlements and audit holds.", section: "vendor_outstanding" as const },
    { label: "Buyer accounts", note: "Support customers and inspect account issues.", section: "customers" as const },
    { label: "Business metrics", note: "Jump into deeper analytics and trends.", section: "analytics" as const },
  ];

  const headline = useMemo(() => {
    if (loading) return "Loading today’s business view";
    if (stats.failedCampaigns > 0 || stats.pendingVendorProducts > 0) return "A few things need attention today";
    if (stats.reviewDrafts > 0) return "Campaigns are ready to move";
    return "Operations look steady today";
  }, [loading, stats.failedCampaigns, stats.pendingVendorProducts, stats.reviewDrafts]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-border bg-[radial-gradient(circle_at_top_left,rgba(233,121,163,0.18),transparent_38%),linear-gradient(135deg,rgba(255,248,250,0.96),rgba(255,255,255,0.98))] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Admin Command Center</p>
            <h2 className="mt-3 font-serif text-3xl leading-tight sm:text-4xl">{headline}</h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Track live commerce health, clear operational blockers, and jump straight into the workflows that matter most.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <div className="rounded-full border border-border bg-background/80 px-4 py-2 text-muted-foreground">
                <span className="font-medium text-foreground">{formatCompact(stats.totalOrders)}</span> total orders managed
              </div>
              <div className="rounded-full border border-border bg-background/80 px-4 py-2 text-muted-foreground">
                <span className="font-medium text-foreground">{stats.reviewDrafts}</span> drafts ready for review
              </div>
              <div className="rounded-full border border-border bg-background/80 px-4 py-2 text-muted-foreground">
                <span className="font-medium text-foreground">{stats.pendingVendorProducts}</span> vendor submissions pending
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="rounded-full" onClick={() => void loadDashboard()}>
              Refresh overview
            </Button>
            <Button className="rounded-full" onClick={() => onNavigate?.("campaigns")}>
              Review campaigns
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <>
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </>
        ) : (
          <>
            <SummaryCard
              label="Revenue"
              value={formatPrice(stats.revenue)}
              meta={`${stats.totalOrders} orders across the storefront`}
              tone="accent"
              icon={IndianRupee}
            />
            <SummaryCard
              label="Profit Locked"
              value={formatPrice(stats.profit)}
              meta="Delivered, non-returned margin already cleared"
              tone="good"
              icon={TrendingUp}
            />
            <SummaryCard
              label="Active Catalog"
              value={String(stats.activeProducts)}
              meta={`${stats.lowStockProducts} low-stock listings need attention`}
              tone={stats.lowStockProducts > 0 ? "warn" : "neutral"}
              icon={Boxes}
            />
            <SummaryCard
              label="Network Reach"
              value={`${stats.vendors} / ${stats.users}`}
              meta="Vendors / registered buyers in the system"
              tone="neutral"
              icon={Users}
            />
          </>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Needs Attention</p>
              <h3 className="mt-2 font-serif text-2xl">Operational watchlist</h3>
              <p className="mt-2 text-sm text-muted-foreground">Focus the admin team on the few queues that actually move revenue, trust, and campaign momentum.</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {attentionItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate?.(item.section)}
                className="flex w-full items-start justify-between gap-4 rounded-2xl border border-border px-4 py-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{item.label}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.tone === "warn" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {item.value}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <span className="text-sm font-medium text-primary">{item.cta}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Quick Actions</p>
                <h3 className="mt-2 font-serif text-2xl">Jump into work</h3>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => onNavigate?.(action.section)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
                >
                  <div>
                    <p className="font-medium text-foreground">{action.label}</p>
                    <p className="text-sm text-muted-foreground">{action.note}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Business Pulse</p>
                <h3 className="mt-2 font-serif text-2xl">Today at a glance</h3>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-foreground">
                <Clock3 className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-secondary/45 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Published Campaigns</p>
                <p className="mt-2 text-2xl font-semibold">{stats.publishedCampaigns}</p>
                <p className="mt-1 text-sm text-muted-foreground">Instagram runs already shipped.</p>
              </div>
              <div className="rounded-2xl bg-secondary/45 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pending Vendor Queue</p>
                <p className="mt-2 text-2xl font-semibold">{stats.pendingVendorProducts}</p>
                <p className="mt-1 text-sm text-muted-foreground">Seller products waiting for approval.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Recent Orders</p>
              <h3 className="mt-2 font-serif text-2xl">Buyer activity</h3>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ReceiptText className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              <>
                <LoadingCard />
                <LoadingCard />
              </>
            ) : recentOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No recent order activity to show yet.
              </div>
            ) : (
              recentOrders.map((order) => (
                <button
                  key={order.id || order.order_number || `${order.createdAt}-${order.total}`}
                  type="button"
                  onClick={() => onNavigate?.("orders")}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
                >
                  <div>
                    <p className="font-medium text-foreground">{order.order_number || "Recent order"}</p>
                    <p className="text-sm text-muted-foreground">{order.guest_name || "Pink Paisa customer"} • {formatDateTime(order.createdAt || order.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">{formatPrice(Number(order.total || 0))}</p>
                    <div className="mt-1">
                      <StatusBadge status={String(order.status || "pending")} />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campaign Pipeline</p>
                <h3 className="mt-2 font-serif text-2xl">Latest marketing runs</h3>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {loading ? (
                <>
                  <LoadingCard />
                  <LoadingCard />
                </>
              ) : recentCampaigns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  No campaign runs have been generated yet.
                </div>
              ) : (
                recentCampaigns.slice(0, 4).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => onNavigate?.("campaigns")}
                    className="w-full rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{run.product_title || "Campaign run"}</p>
                        <p className="text-sm text-muted-foreground">{run.vendor_shop_name || "Pink Paisa"} • {formatDateTime(run.updated_at)}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <StatusBadge status={String(run.status || "queued")} />
                        {run.last_error ? <p className="max-w-[180px] text-xs text-destructive">{run.last_error}</p> : null}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Vendor Queue</p>
                <h3 className="mt-2 font-serif text-2xl">Fresh submissions</h3>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserRoundSearch className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {loading ? (
                <>
                  <LoadingCard />
                  <LoadingCard />
                </>
              ) : recentVendorSubmissions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  No vendor product submissions are waiting right now.
                </div>
              ) : (
                recentVendorSubmissions.slice(0, 4).map((submission) => (
                  <button
                    key={submission.id || submission.title || submission.updated_at || "vendor-submission"}
                    type="button"
                    onClick={() => onNavigate?.("vendors")}
                    className="flex w-full items-start justify-between gap-4 rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <div>
                      <p className="font-medium text-foreground">{submission.title || "Vendor product"}</p>
                      <p className="text-sm text-muted-foreground">{submission.vendor_shop_name || "Pending seller"} • {formatDateTime(submission.updatedAt || submission.updated_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 text-amber-700">
                      <Store className="h-4 w-4" />
                      <span className="text-sm font-medium capitalize">{submission.approval_status?.replace(/_/g, " ") || "pending"}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
