import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard, formatPrice } from "./AdminShared";

type AnalyticsResponse = {
  from?: string | null;
  to?: string | null;
  generated_at?: string | null;
  order_revenue: number;
  booking_revenue: number;
  total_orders: number;
  total_bookings: number;
  paid_bookings: number;
  total_workshops: number;
  active_workshops: number;
  total_products: number;
  low_stock: number;
  out_of_stock: number;
  total_polls: number;
  total_votes: number;
  total_blogs: number;
  published_blogs: number;
  upcoming_sessions: number;
  completed_sessions: number;
  quote_requests: number;
  converted_quotes: number;
  affiliate_disclaimer?: string;
  amazon_report_disclaimer?: string;
  affiliate_product_views: number;
  affiliate_cta_clicks: number;
  affiliate_outbound_clicks: number;
  affiliate_bot_events: number;
  affiliate_ctr: number;
  affiliate_instagram_events: number;
  affiliate_experiments: Array<{ experiment_name: string; experiment_variant: string; views: number; clicks: number; ctr: number }>;
  amazon_report_summary: { rows: number; ordered_items: number; shipped_items: number; returned_items: number; revenue: number; commission: number };
  top_amazon_report_products: Array<{ product_id: string | null; title: string; slug: string | null; asin: string | null; marketplace: string | null; ordered_items: number; shipped_items: number; revenue: number; commission: number }>;
  top_affiliate_products: Array<{ product_id: string | null; title: string; slug: string | null; asin: string | null; marketplace: string | null; views: number; clicks: number; ctr: number }>;
  top_affiliate_categories: Array<{ category: string; views: number; clicks: number }>;
  top_affiliate_campaigns: Array<{ campaign: string; views: number; clicks: number }>;
  recent_affiliate_clicks: Array<{ id: string; created_at: string; product_title: string; product_slug: string | null; asin: string | null; marketplace: string | null; utm_source: string | null; utm_campaign: string | null; is_bot: boolean }>;
  most_booked: Array<{ workshop_title: string; count: number }>;
};

const INITIAL_STATS: AnalyticsResponse = {
  order_revenue: 0,
  booking_revenue: 0,
  total_orders: 0,
  total_bookings: 0,
  paid_bookings: 0,
  total_workshops: 0,
  active_workshops: 0,
  total_products: 0,
  low_stock: 0,
  out_of_stock: 0,
  total_polls: 0,
  total_votes: 0,
  total_blogs: 0,
  published_blogs: 0,
  upcoming_sessions: 0,
  completed_sessions: 0,
  quote_requests: 0,
  converted_quotes: 0,
  affiliate_product_views: 0,
  affiliate_cta_clicks: 0,
  affiliate_outbound_clicks: 0,
  affiliate_bot_events: 0,
  affiliate_ctr: 0,
  affiliate_instagram_events: 0,
  affiliate_experiments: [],
  amazon_report_summary: { rows: 0, ordered_items: 0, shipped_items: 0, returned_items: 0, revenue: 0, commission: 0 },
  top_amazon_report_products: [],
  top_affiliate_products: [],
  top_affiliate_categories: [],
  top_affiliate_campaigns: [],
  recent_affiliate_clicks: [],
  most_booked: [],
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "Not refreshed yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not refreshed yet";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const AdminAnalytics = () => {
  const [stats, setStats] = useState<AnalyticsResponse>(INITIAL_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAmazonReport, setUploadingAmazonReport] = useState(false);
  const [amazonReportMessage, setAmazonReportMessage] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const response = await apiFetch<AnalyticsResponse>(`/admin/analytics${params.toString() ? `?${params}` : ""}`);
      setStats({ ...INITIAL_STATS, ...response });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalRevenue = useMemo(
    () => Number(stats.order_revenue || 0) + Number(stats.booking_revenue || 0),
    [stats.booking_revenue, stats.order_revenue],
  );

  const handleAmazonReportUpload = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAmazonReportMessage("Upload a CSV report exported from Amazon Associates.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    try {
      setUploadingAmazonReport(true);
      setAmazonReportMessage("");
      const response = await apiFetch<{ rows_imported: number; matched_products: number }>("/admin/amazon-reports/upload", {
        method: "POST",
        body: formData,
      });
      setAmazonReportMessage(`Imported ${response.rows_imported} rows, matched ${response.matched_products} products.`);
      await load({ silent: true });
    } catch (error) {
      setAmazonReportMessage(error instanceof Error ? error.message : "Amazon report import failed.");
    } finally {
      setUploadingAmazonReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="mb-1 font-serif text-2xl">Analytics</h2>
          <p className="text-sm text-muted-foreground">Server-backed business metrics for revenue, content, inventory, and workshops.</p>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Last refreshed {formatTimestamp(stats.generated_at)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <Button onClick={() => void load({ silent: true })} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">Revenue</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Product Revenue" value={formatPrice(stats.order_revenue)} color="text-primary" />
          <StatCard label="Workshop Revenue" value={formatPrice(stats.booking_revenue)} color="text-primary" />
          <StatCard label="Total Revenue" value={formatPrice(totalRevenue)} color="text-emerald-600" />
          <StatCard label="Total Orders" value={stats.total_orders + stats.total_bookings} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">Products & Inventory</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Products" value={stats.total_products} />
          <StatCard label="Low Stock" value={stats.low_stock} color="text-amber-600" />
          <StatCard label="Out of Stock" value={stats.out_of_stock} color="text-red-600" />
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">Workshops</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Workshops" value={stats.total_workshops} />
          <StatCard label="Active" value={stats.active_workshops} color="text-emerald-600" />
          <StatCard label="Total Bookings" value={stats.total_bookings} />
          <StatCard label="Paid Bookings" value={stats.paid_bookings} color="text-emerald-600" />
          <StatCard label="Upcoming Sessions" value={stats.upcoming_sessions} color="text-blue-600" />
          <StatCard label="Completed Sessions" value={stats.completed_sessions} />
          <StatCard label="Quote Requests" value={stats.quote_requests} />
          <StatCard label="Converted Quotes" value={stats.converted_quotes} color="text-emerald-600" />
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">Engagement</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Polls" value={stats.total_polls} />
          <StatCard label="Total Votes" value={stats.total_votes.toLocaleString()} color="text-primary" />
          <StatCard label="Total Blogs" value={stats.total_blogs} />
          <StatCard label="Published Blogs" value={stats.published_blogs} color="text-emerald-600" />
        </div>
      </div>

      <div>
        <div className="mb-3">
          <h3 className="font-semibold">Amazon Affiliate Clicks</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.affiliate_disclaimer || "Site click data only. Amazon sales/commission data is not included."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Product Views" value={stats.affiliate_product_views.toLocaleString()} />
          <StatCard label="CTA Clicks" value={stats.affiliate_cta_clicks.toLocaleString()} />
          <StatCard label="Outbound Clicks" value={stats.affiliate_outbound_clicks.toLocaleString()} color="text-primary" />
          <StatCard label="Affiliate CTR" value={`${stats.affiliate_ctr}%`} color="text-emerald-600" />
          <StatCard label="Instagram Events" value={stats.affiliate_instagram_events.toLocaleString()} color="text-pink-600" />
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-semibold">Imported Amazon Reports</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.amazon_report_disclaimer || "Imported Amazon Associates report data only. It is not inferred from site clicks."}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
            {uploadingAmazonReport ? "Uploading..." : "Upload Amazon CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={uploadingAmazonReport}
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.target.value = "";
                void handleAmazonReportUpload(file);
              }}
            />
          </label>
        </div>
        {amazonReportMessage ? <p className="mb-3 text-sm text-muted-foreground">{amazonReportMessage}</p> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Report Rows" value={stats.amazon_report_summary.rows.toLocaleString()} />
          <StatCard label="Ordered Items" value={stats.amazon_report_summary.ordered_items.toLocaleString()} />
          <StatCard label="Shipped Items" value={stats.amazon_report_summary.shipped_items.toLocaleString()} />
          <StatCard label="Report Revenue" value={formatPrice(stats.amazon_report_summary.revenue)} color="text-primary" />
          <StatCard label="Commission" value={formatPrice(stats.amazon_report_summary.commission)} color="text-emerald-600" />
        </div>
      </div>

      {stats.affiliate_experiments.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Affiliate CTA Experiments</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {stats.affiliate_experiments.map((item) => (
              <div key={`${item.experiment_name}-${item.experiment_variant}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.experiment_variant}</span>
                  <span className="font-semibold tabular-nums">{item.ctr}% CTR</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.clicks} clicks - {item.views} views - {item.experiment_name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Top Affiliate Products</h3>
          <div className="space-y-3">
            {stats.top_affiliate_products.length ? stats.top_affiliate_products.map((item) => (
              <div key={item.product_id || item.title} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="font-semibold tabular-nums">{item.clicks}</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.views} views - {item.ctr}% CTR - {item.asin || "No ASIN"}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">No affiliate clicks yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Top Categories</h3>
          <div className="space-y-3">
            {stats.top_affiliate_categories.length ? stats.top_affiliate_categories.map((item) => (
              <div key={item.category} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{item.category}</span>
                <span className="font-semibold tabular-nums">{item.clicks} clicks</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No category data yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Top Campaigns</h3>
          <div className="space-y-3">
            {stats.top_affiliate_campaigns.length ? stats.top_affiliate_campaigns.map((item) => (
              <div key={item.campaign} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{item.campaign}</span>
                <span className="font-semibold tabular-nums">{item.clicks} clicks</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No campaign data yet.</p>}
          </div>
        </div>
      </div>

      {stats.top_amazon_report_products.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Top Imported Amazon Report Products</h3>
          <div className="space-y-3">
            {stats.top_amazon_report_products.map((item) => (
              <div key={`${item.product_id || item.asin}-${item.marketplace || "unknown"}`} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="font-semibold tabular-nums">{formatPrice(item.commission)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.shipped_items} shipped - {formatPrice(item.revenue)} revenue - {item.asin || "No ASIN"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.recent_affiliate_clicks.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Recent Affiliate Clicks</h3>
          <div className="space-y-2">
            {stats.recent_affiliate_clicks.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
                <span className="truncate">{item.product_title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(item.created_at)} - {item.utm_source || "direct"} {item.utm_campaign ? `- ${item.utm_campaign}` : ""}{item.is_bot ? " - bot flagged" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.most_booked.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold">Most Booked Workshops</h3>
          <div className="space-y-2">
            {stats.most_booked.map((item) => (
              <div key={item.workshop_title} className="flex items-center justify-between text-sm">
                <span className="truncate">{item.workshop_title}</span>
                <span className="font-semibold tabular-nums">{item.count} bookings</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
