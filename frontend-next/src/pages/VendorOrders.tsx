import { useCallback, useEffect, useState } from "react";
import { Download, HandCoins, PackageSearch, Search, WalletCards } from "lucide-react";
import { vendorFetch } from "@/lib/vendor-api";
import { VendorOrderItem, VendorOrderSummary, formatCurrency, formatDate } from "@/lib/vendor";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import VendorMetricCard from "@/components/vendor/VendorMetricCard";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const ACTIONS: Record<string, string[]> = {
  new: ["rejected"],
  accepted: ["rejected"],
  pickup_assigned: ["picked_up", "rejected"],
  picked_up: [],
  shipped: [],
  delivered: [],
  return_requested: [],
  return_in_transit: [],
  returned: [],
  refunded: [],
  rejected: [],
};

const VENDOR_ORDER_PAGE_SIZE = 25;

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
};

type VendorOrderListResponse = {
  items: VendorOrderItem[];
  summary: VendorOrderSummary;
  pagination: PaginationMeta;
};

const VendorOrders = () => {
  const [items, setItems] = useState<VendorOrderItem[]>([]);
  const [summary, setSummary] = useState<VendorOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerDownloading, setLedgerDownloading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: VENDOR_ORDER_PAGE_SIZE, total: 0, total_pages: 1 });
  const debouncedSearch = useDebouncedValue(search, 350);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({
        status,
        page: String(page),
        limit: String(VENDOR_ORDER_PAGE_SIZE),
      });
      const trimmedSearch = debouncedSearch.trim();
      if (trimmedSearch) query.set("search", trimmedSearch);
      const data = await vendorFetch<VendorOrderListResponse>(`/vendor-orders/mine?${query.toString()}`);
      setItems(data.items || []);
      setSummary(data.summary || null);
      setPagination(data.pagination || { page, limit: VENDOR_ORDER_PAGE_SIZE, total: 0, total_pages: 1 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendor orders");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (page > pagination.total_pages) {
      setPage(Math.max(pagination.total_pages, 1));
    }
  }, [page, pagination.total_pages]);

  const updateStatus = async (itemId: string, vendor_status: string) => {
    try {
      await vendorFetch(`/vendor-orders/mine/${itemId}/status`, { method: "PUT", body: JSON.stringify({ vendor_status }) });
      toast.success(`Vendor order updated to ${vendor_status.replace(/_/g, " ")}`);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update order status");
    }
  };

  const downloadLedger = async () => {
    try {
      setLedgerDownloading(true);
      const ledgerData = await vendorFetch<{ items: VendorOrderItem[] }>("/vendor-orders/mine/ledger");
      const ledger = ledgerData.items || [];
      if (!ledger.length) {
        toast.info("No payout ledger entries yet.");
        return;
      }
      const header = ["order_number", "invoice_number", "product_title", "gross_amount", "commission_amount", "payout_amount", "payout_status", "settlement_stage", "created_at", "delivered_at", "payout_released_at"];
      const rows = ledger.map((item) => [
        item.order_number,
        item.invoice_number || "",
        item.product_title,
        item.gross_amount,
        item.commission_amount,
        item.payout_amount,
        item.payout_status,
        item.settlement_stage || "",
        item.created_at,
        item.delivered_at || "",
        item.payout_released_at || "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vendor-payout-ledger.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download payout ledger");
    } finally {
      setLedgerDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_55%,#fdf0e8_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor order tab</p>
        <h2 className="mt-2 font-serif text-3xl">Buyer orders for your products</h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">When a buyer places an order for your product, the item appears here as Order Received. After Admin assigns the delivery partner, you can only take vendor-side actions like Reject or Pickup Done. Delivery completion is controlled by Admin, and delivered orders move into payout hold automatically.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <VendorMetricCard label="On hold" value={formatCurrency(summary?.hold_amount || 0)} helper="Held until delivery + return window" tone="warning" />
        <VendorMetricCard label="Ready" value={formatCurrency(summary?.ready_amount || 0)} helper="Eligible for payout release" tone="success" />
        <VendorMetricCard label="Received" value={formatCurrency(summary?.received_amount || 0)} helper="Released to vendor" tone="success" />
        <VendorMetricCard label="Blocked" value={formatCurrency(summary?.blocked_amount || 0)} helper="Rejected or refunded items" tone="warning" />
      </section>

      <section className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Payout ledger</p>
            <h3 className="mt-1 font-serif text-2xl">Settlement history, commission, and invoices</h3>
            <p className="mt-1 text-sm text-muted-foreground">This ledger shows the gross order value, Pink Paisa commission, vendor payout amount, invoice number, and release timing for every order item.</p>
          </div>
          <Button variant="outline" className="w-full rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7] md:w-auto" onClick={() => void downloadLedger()} disabled={ledgerDownloading}>
            <Download className="mr-2 h-4 w-4" /> {ledgerDownloading ? "Preparing..." : "Download statement"}
          </Button>
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="grid gap-3 md:grid-cols-[1fr,220px]">
          <div className="relative"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-12 rounded-full border-[#efd3db] bg-[#fffaf8] pl-11" placeholder="Search by order or product" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-12 rounded-full border border-[#efd3db] bg-[#fffaf8] px-4 text-sm text-[#6a4050] outline-none">
            <option value="all">All statuses</option>
            <option value="new">Order received</option>
            <option value="pickup_assigned">Pickup assigned</option>
            <option value="picked_up">Pickup done</option>
            <option value="delivered">Delivered</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="divide-y divide-[#f5ede5] md:hidden">
          {loading ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">Loading vendor orders...</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">No vendor orders found.</div>
          ) : items.map((item) => {
            const nextStatuses = ACTIONS[item.vendor_status] || [];
            return (
              <article key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[#4a2030]">{item.order_number}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
                    {item.invoice_number ? <p className="mt-1 text-xs text-muted-foreground">Invoice: {item.invoice_number}</p> : null}
                  </div>
                  <VendorStatusBadge status={item.vendor_status} />
                </div>

                <div className="mt-4">
                  <p className="break-words text-sm font-medium text-[#4a2030]">{item.product_title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.quantity} x {formatCurrency(item.price)}</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-[#fff8f5] p-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Payout</p>
                    <p className="font-semibold text-[#4a2030]">{formatCurrency(item.payout_amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Commission</p>
                    <p className="font-semibold text-[#4a2030]">{formatCurrency(item.commission_amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Rate</p>
                    <p className="font-semibold text-[#4a2030]">{item.commission_percent}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Return window</p>
                    <p className="font-semibold text-[#4a2030]">{item.return_window_days} day(s)</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <VendorStatusBadge status={item.payout_status} />
                  {item.return_status !== "not_requested" ? <VendorStatusBadge status={item.return_status} /> : null}
                </div>

                <div className="mt-4 grid gap-2">
                  {nextStatuses.length === 0 ? <span className="text-xs text-muted-foreground">Waiting for admin step</span> : null}
                  {nextStatuses.includes("picked_up") ? <Button variant="outline" className="w-full rounded-full" onClick={() => updateStatus(item.id, "picked_up")}>Pickup Done</Button> : null}
                  {nextStatuses.includes("rejected") ? <Button variant="outline" className="w-full rounded-full text-rose-600" onClick={() => updateStatus(item.id, "rejected")}>Reject</Button> : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-[#fff6f7] text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-4">Order</th>
                <th className="px-4 py-4">Product</th>
                <th className="px-4 py-4">Balance</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="px-4 py-14 text-center text-muted-foreground">Loading vendor orders...</td></tr> : items.length === 0 ? <tr><td colSpan={5} className="px-4 py-14 text-center text-muted-foreground">No vendor orders found.</td></tr> : items.map((item) => {
                const nextStatuses = ACTIONS[item.vendor_status] || [];
                return (
                  <tr key={item.id} className="border-t border-[#f5ede5] align-top">
                    <td className="px-4 py-4">
                      <p className="font-medium">{item.order_number}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
                      {item.invoice_number ? <p className="mt-1 text-xs text-muted-foreground">Invoice: {item.invoice_number}</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium">{item.product_title}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity} × {formatCurrency(item.price)}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium">{formatCurrency(item.payout_amount)}</p>
                      <p className="text-xs text-muted-foreground">{item.commission_percent}% commission: {formatCurrency(item.commission_amount)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Return window: {item.return_window_days} day(s)</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <VendorStatusBadge status={item.vendor_status} />
                        <VendorStatusBadge status={item.payout_status} />
                        {item.return_status !== "not_requested" ? <VendorStatusBadge status={item.return_status} /> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {nextStatuses.length === 0 ? <span className="text-xs text-muted-foreground">Waiting for admin step</span> : null}
                        {nextStatuses.includes("picked_up") ? <Button variant="outline" className="rounded-full" onClick={() => updateStatus(item.id, "picked_up")}>Pickup Done</Button> : null}
                        {nextStatuses.includes("rejected") ? <Button variant="outline" className="rounded-full text-rose-600" onClick={() => updateStatus(item.id, "rejected")}>Reject</Button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-[#f5ede5] px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing {items.length} of {pagination.total} order item(s). Page {pagination.page} of {pagination.total_pages}.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" className="w-full rounded-full sm:w-auto" disabled={pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </Button>
            <Button variant="outline" className="w-full rounded-full sm:w-auto" disabled={pagination.page >= pagination.total_pages || loading} onClick={() => setPage((current) => Math.min(pagination.total_pages, current + 1))}>
              Next
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Ledger table</p>
          <h3 className="mt-1 font-serif text-2xl">Commission and payout breakdown</h3>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Ledger rows are no longer loaded automatically. Use Download statement to generate the full CSV only when needed.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-sm">
          <div className="flex items-center gap-3"><WalletCards className="h-5 w-5 text-primary" /><h3 className="font-medium text-[#4a2030]">Payout logic</h3></div>
          <p className="mt-3 text-sm text-muted-foreground">PinkPaisa holds the vendor amount until delivery is completed and the buyer return window is over.</p>
        </div>
        <div className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-sm">
          <div className="flex items-center gap-3"><HandCoins className="h-5 w-5 text-primary" /><h3 className="font-medium text-[#4a2030]">Vendor action</h3></div>
          <p className="mt-3 text-sm text-muted-foreground">Vendor control is limited to Reject or Pickup Done. Shipping and delivery completion remain admin-controlled to keep the order flow consistent.</p>
        </div>
        <div className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-sm">
          <div className="flex items-center gap-3"><PackageSearch className="h-5 w-5 text-primary" /><h3 className="font-medium text-[#4a2030]">Return flow</h3></div>
          <p className="mt-3 text-sm text-muted-foreground">If the buyer requests a return after delivery, payout gets blocked and Admin can process the refund from the admin order panel.</p>
        </div>
      </section>
    </div>
  );
};

export default VendorOrders;
