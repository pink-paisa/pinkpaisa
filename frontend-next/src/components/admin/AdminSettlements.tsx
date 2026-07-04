import { useEffect, useMemo, useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Landmark, ReceiptIndianRupee, Search } from "lucide-react";

type VendorOption = { id: string; owner_name?: string; business_name?: string; shop_name?: string; email?: string };
type SettlementItem = {
  id: string;
  settlement_number: string;
  vendor_id: string;
  vendor?: { id: string; owner_name?: string; business_name?: string; shop_name?: string; email?: string; commission_percent?: number };
  period_start?: string | null;
  period_end?: string | null;
  line_count: number;
  gross_amount: number;
  commission_amount: number;
  commission_gst_amount: number;
  tds_amount: number;
  chargeback_amount: number;
  net_payable: number;
  status: string;
  payout_provider?: string | null;
  payout_reference?: string | null;
  utr_number?: string | null;
  initiated_at?: string | null;
  processed_at?: string | null;
  bank_snapshot?: { account_holder_name?: string | null; account_number?: string | null; ifsc_code?: string | null; bank_name?: string | null };
  invoice?: { invoice_number?: string | null; generated_at?: string | null };
  items?: Array<{ id: string; order_id: string; product_title: string; quantity: number; payout_amount: number; commission_amount: number }>;
};

type SettlementResponse = {
  items: SettlementItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
};

const formatPrice = (value: number) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";

const formatDateTime = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";

const statusClass = (status: string) => {
  if (["paid", "processing", "initiated"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["failed", "reversed"].includes(status)) return "bg-rose-100 text-rose-700 border-rose-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
};

export const AdminSettlements = () => {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [vendorId, setVendorId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementItem | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, total_pages: 1 });
  const [manualUtr, setManualUtr] = useState("");
  const [manualPaidAt, setManualPaidAt] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);

  const loadVendors = async () => {
    try {
      const response = await apiFetch<{ items: VendorOption[] }>("/vendors?limit=200");
      setVendors(response.items || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendors");
    }
  };

  const loadSettlements = async (page = pagination.page) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (vendorId !== "all") params.set("vendor_id", vendorId);
      if (status !== "all") params.set("status", status);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      params.set("page", String(page));
      params.set("limit", String(pagination.limit));

      const response = await apiFetch<SettlementResponse>(`/settlements?${params}`);
      setItems(response.items || []);
      setPagination(response.pagination || { page: 1, limit: 10, total: 0, total_pages: 1 });
      setSelectedSettlement((current) => {
        if (!current) return null;
        return (response.items || []).find((item) => item.id === current.id) || current;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settlements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadVendors();
  }, []);

  useEffect(() => {
    void loadSettlements();
  }, [vendorId, status, fromDate, toDate, pagination.page, pagination.limit]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const hay = `${item.settlement_number} ${item.vendor?.shop_name || ""} ${item.vendor?.business_name || ""} ${item.vendor?.owner_name || ""}`.toLowerCase();
        return !search || hay.includes(search.toLowerCase());
      }),
    [items, search],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, item) => {
          acc.gross += Number(item.gross_amount || 0);
          acc.commission += Number(item.commission_amount || 0);
          acc.net += Number(item.net_payable || 0);
          return acc;
        },
        { gross: 0, commission: 0, net: 0 },
      ),
    [filtered],
  );

  const openSettlement = async (settlementId: string) => {
    try {
      const detail = await apiFetch<SettlementItem>(`/settlements/${settlementId}`);
      setSelectedSettlement(detail);
      setManualUtr(detail.utr_number || "");
      setManualPaidAt(detail.processed_at ? detail.processed_at.slice(0, 16) : "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settlement details");
    }
  };

  const downloadInvoice = async (settlementId: string, invoiceNumber?: string | null) => {
    try {
      const response = await fetch(`${API_URL}/settlements/${settlementId}/invoice`, {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || "Could not download settlement invoice");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoiceNumber || `pinkpaisa-settlement-${settlementId.slice(0, 8).toUpperCase()}`}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download settlement invoice");
    }
  };

  const markPaidManually = async () => {
    if (!selectedSettlement) return;
    try {
      setMarkingPaid(true);
      const detail = await apiFetch<SettlementItem>(`/settlements/${selectedSettlement.id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({
          utr_number: manualUtr.trim() || null,
          paid_at: manualPaidAt ? new Date(manualPaidAt).toISOString() : null,
        }),
      });
      setSelectedSettlement(detail);
      toast.success("Settlement marked as paid");
      await loadSettlements(pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update settlement");
    } finally {
      setMarkingPaid(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Settlement registry</p>
            <h2 className="mt-2 font-serif text-3xl">Vendor settlements</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Every payout release now creates a settlement record with linked order items, bank snapshot, invoice, and immutable totals.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select value={vendorId} onValueChange={(value) => { setVendorId(value); setPagination((current) => ({ ...current, page: 1 })); }}>
              <SelectTrigger><SelectValue placeholder="Vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vendors</SelectItem>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>{vendor.shop_name || vendor.business_name || vendor.owner_name || vendor.email || vendor.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => { setStatus(value); setPagination((current) => ({ ...current, page: 1 })); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="reversed">Reversed</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPagination((current) => ({ ...current, page: 1 })); }} />
            <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPagination((current) => ({ ...current, page: 1 })); }} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Gross</p><p className="mt-2 text-2xl font-semibold">{formatPrice(totals.gross)}</p></div>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Commission</p><p className="mt-2 text-2xl font-semibold text-rose-600">{formatPrice(totals.commission)}</p></div>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Net payable</p><p className="mt-2 text-2xl font-semibold text-emerald-600">{formatPrice(totals.net)}</p></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="relative mb-4 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by settlement or vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-4">Settlement</th>
                    <th className="px-4 py-4">Vendor</th>
                    <th className="px-4 py-4">Gross</th>
                    <th className="px-4 py-4">Net</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-14 text-center text-muted-foreground">Loading settlements...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-14 text-center text-muted-foreground">No settlements created yet.</td></tr>
                  ) : filtered.map((item) => (
                    <tr key={item.id} className="border-t border-border align-top">
                      <td className="px-4 py-4">
                        <p className="font-medium">{item.settlement_number}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(item.period_start)} → {formatDate(item.period_end)}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">{item.vendor?.shop_name || item.vendor?.business_name || item.vendor?.owner_name || "Vendor"}</p>
                        <p className="text-xs text-muted-foreground">{item.line_count} item(s)</p>
                      </td>
                      <td className="px-4 py-4">{formatPrice(item.gross_amount)}</td>
                      <td className="px-4 py-4 font-medium text-emerald-700">{formatPrice(item.net_payable)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${statusClass(item.status)}`}>{item.status}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => void openSettlement(item.id)}>View</Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => void downloadInvoice(item.id, item.invoice?.invoice_number)}>Invoice</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-muted-foreground">Page {pagination.page} of {pagination.total_pages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.total_pages} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}>Next</Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Settlement detail</p>
                <h3 className="font-serif text-2xl">{selectedSettlement?.settlement_number || "Select a settlement"}</h3>
              </div>
            </div>
            {!selectedSettlement ? (
              <p className="mt-4 text-sm text-muted-foreground">Pick a settlement to inspect the linked order items and frozen bank snapshot.</p>
            ) : (
              <div className="mt-5 space-y-3 text-sm">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Vendor</p>
                  <p className="mt-1 font-medium">{selectedSettlement.vendor?.shop_name || selectedSettlement.vendor?.business_name || selectedSettlement.vendor?.owner_name}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Bank snapshot</p>
                  <p className="mt-1 font-medium">{selectedSettlement.bank_snapshot?.account_holder_name || "—"}</p>
                  <p className="text-muted-foreground">{selectedSettlement.bank_snapshot?.bank_name || "—"} {selectedSettlement.bank_snapshot?.ifsc_code ? `· ${selectedSettlement.bank_snapshot.ifsc_code}` : ""}</p>
                  <p className="text-muted-foreground">{selectedSettlement.bank_snapshot?.account_number ? `${selectedSettlement.bank_snapshot.account_number.slice(0, 2)}******${selectedSettlement.bank_snapshot.account_number.slice(-2)}` : "—"}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Settlement status</p>
                  <p className="mt-1 capitalize">{selectedSettlement.status}</p>
                  <p className="text-muted-foreground">Provider {selectedSettlement.payout_provider || "manual"}</p>
                  <p className="text-muted-foreground">UTR {selectedSettlement.utr_number || "—"}</p>
                  <p className="text-muted-foreground">Processed {formatDateTime(selectedSettlement.processed_at)}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Totals</p>
                  <p className="mt-1">Gross {formatPrice(selectedSettlement.gross_amount)}</p>
                  <p>Commission {formatPrice(selectedSettlement.commission_amount)}</p>
                  <p>Net payable {formatPrice(selectedSettlement.net_payable)}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Linked items</p>
                  <div className="mt-2 space-y-2">
                    {(selectedSettlement.items || []).length === 0 ? (
                      <p className="text-muted-foreground">No line items loaded.</p>
                    ) : (selectedSettlement.items || []).map((item) => (
                      <div key={item.id} className="rounded-lg bg-secondary/25 px-3 py-2">
                        <p className="font-medium">{item.product_title}</p>
                        <p className="text-xs text-muted-foreground">Qty {item.quantity} · Commission {formatPrice(item.commission_amount)} · Vendor payout {formatPrice(item.payout_amount)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {selectedSettlement.status !== "paid" && selectedSettlement.status !== "reversed" && (
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Manual completion</p>
                    <div className="mt-3 grid gap-3">
                      <Input placeholder="UTR / bank reference" value={manualUtr} onChange={(e) => setManualUtr(e.target.value)} />
                      <Input type="datetime-local" value={manualPaidAt} onChange={(e) => setManualPaidAt(e.target.value)} />
                      <Button onClick={() => void markPaidManually()} disabled={markingPaid}>
                        {markingPaid ? "Saving..." : "Mark paid manually"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <ReceiptIndianRupee className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Current release mode</p>
                <h3 className="font-serif text-2xl">Manual settlement</h3>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">This Phase 9 slice adds manual mark-paid handling and date-filtered registry views. Automated payout provider wiring remains a separate follow-up.</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdminSettlements;
