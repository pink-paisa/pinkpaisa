import { useEffect, useMemo, useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { HandCoins, Landmark, ReceiptIndianRupee, Search } from "lucide-react";
import { StatCard } from "./AdminShared";


type VendorOption = { id: string; owner_name?: string; business_name?: string; shop_name?: string; email?: string };
type OutstandingRow = { id: string; order_id: string; order_number: string; invoice_number?: string | null; product_title: string; quantity: number; gross_amount: number; commission_percent: number | null; commission_amount: number; payout_amount: number; delivered_at?: string | null; releaseable_at?: string | null; payout_status: string; returnable?: boolean; return_hold_days?: number; bank_ready?: boolean; eligible_for_release?: boolean; hold_reason?: string | null };
type OutstandingSummary = { vendor_id: string; vendor_name: string; total_orders: number; gross_amount: number; commission_amount: number; release_amount: number; bank_account_holder?: string | null; bank_account_number?: string | null; bank_ifsc?: string | null; bank_name?: string | null; bank_verified?: boolean; bank_ready?: boolean; on_hold_count?: number; eligible_count?: number };

const formatPrice = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const AdminVendorOutstanding = () => {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [summary, setSummary] = useState<OutstandingSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadVendors = async () => {
    try {
      const response = await apiFetch<{ items: VendorOption[] }>("/vendors?limit=200");
      setVendors(response.items || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendors");
    }
  };

  const loadOutstanding = async (selectedVendorId: string) => {
    if (!selectedVendorId || selectedVendorId === "all") {
      setRows([]);
      setSummary(null);
      setSelectedIds([]);
      return;
    }
    try {
      setLoading(true);
      const response = await apiFetch<{ vendor: OutstandingSummary; items: OutstandingRow[] }>(`/orders/vendor-outstanding?vendor_id=${selectedVendorId}`);
      setSummary(response.vendor || null);
      setRows(response.items || []);
      setSelectedIds([]);
    } catch (error) {
      setRows([]);
      setSummary(null);
      toast.error(error instanceof Error ? error.message : "Could not load vendor outstanding");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadVendors(); }, []);
  useEffect(() => { loadOutstanding(vendorId); }, [vendorId]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const hay = `${row.order_number} ${row.product_title}`.toLowerCase();
    return !search || hay.includes(search.toLowerCase());
  }), [rows, search]);

  const releaseableRows = useMemo(() => filteredRows.filter((row) => row.eligible_for_release), [filteredRows]);

  const toggle = (id: string) => {
    const row = filteredRows.find((item) => item.id === id);
    if (!row?.eligible_for_release) return;
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const toggleAll = () => {
    if (releaseableRows.length && selectedIds.length === releaseableRows.length) setSelectedIds([]);
    else setSelectedIds(releaseableRows.map((row) => row.id));
  };

  const releasePayment = async () => {
    if (!vendorId || vendorId === "all" || selectedIds.length === 0) return toast.error("Select at least one order item");
    try {
      setReleasing(true);
      const response = await apiFetch<{ released_count: number; released_amount: number; settlement_number?: string }>("/orders/vendor-outstanding/release-payment", {
        method: "POST",
        body: JSON.stringify({ vendor_id: vendorId, order_item_ids: selectedIds }),
      });
      toast.success(`Created settlement ${response.settlement_number || ""} for ${response.released_count} payout item(s) worth ${formatPrice(response.released_amount)}`.trim());
      await loadOutstanding(vendorId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not release vendor payment");
    } finally {
      setReleasing(false);
    }
  };

  const downloadInvoice = async (orderId: string, invoiceNumber?: string | null) => {
    try {
      const response = await fetch(`${API_URL}/orders/${orderId}/invoice`, {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as any).message || "Could not download invoice");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoiceNumber || `pinkpaisa-invoice-${orderId.slice(0, 8).toUpperCase()}`}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download invoice");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Vendor Outstanding & Payment Release</p>
            <h2 className="mt-2 font-serif text-3xl">Vendor outstanding</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Select a vendor to view delivered items ready for payout. Non-returnable items become eligible immediately after delivery. Returnable items become eligible only after the 7-day return hold is over. Release Payment marks the vendor amount as settled after PinkPaisa retains its commission.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-[260px]"><Select value={vendorId} onValueChange={setVendorId}><SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger><SelectContent><SelectItem value="all">Select vendor</SelectItem>{vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.shop_name || vendor.business_name || vendor.owner_name || vendor.email || vendor.id}</SelectItem>)}</SelectContent></Select></div>
            <Button className="rounded-xl" disabled={selectedIds.length === 0 || releasing || !summary || !summary.bank_ready} onClick={releasePayment}><HandCoins className="mr-2 h-4 w-4" /> {releasing ? "Releasing..." : "Release Payment"}</Button>
          </div>
        </div>
      </section>

      {summary ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Eligible Items" value={summary.eligible_count ?? summary.total_orders} color="text-foreground" />
          <StatCard label="Gross Delivered Value" value={formatPrice(summary.gross_amount)} color="text-foreground" />
          <StatCard label="PinkPaisa Commission" value={formatPrice(summary.commission_amount)} color="text-rose-600" />
          <StatCard label="Vendor Release Amount" value={formatPrice(summary.release_amount)} color="text-emerald-600" />
          <StatCard label="On Hold" value={summary.on_hold_count ?? 0} color="text-amber-600" />
        </section>
      ) : null}

      {summary ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search by order or product" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="mt-5 overflow-hidden rounded-2xl border border-border">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-secondary/40 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-4"><input type="checkbox" checked={releaseableRows.length > 0 && selectedIds.length === releaseableRows.length} onChange={toggleAll} /></th>
                      <th className="px-4 py-4">Order</th>
                      <th className="px-4 py-4">Product</th>
                      <th className="px-4 py-4">Delivered</th>
                      <th className="px-4 py-4">Release Rule</th>
                      <th className="px-4 py-4">Commission</th>
                      <th className="px-4 py-4">Vendor Amount</th>
                      <th className="px-4 py-4">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">Loading vendor outstanding...</td></tr> : filteredRows.length === 0 ? <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">No vendor payout rows found for this vendor yet.</td></tr> : filteredRows.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="px-4 py-4"><input type="checkbox" checked={selectedIds.includes(row.id)} disabled={!row.eligible_for_release} onChange={() => toggle(row.id)} /></td>
                        <td className="px-4 py-4"><p className="font-medium">{row.order_number}</p><p className="text-xs text-muted-foreground">{row.invoice_number || "Invoice generated on delivery"}</p></td>
                        <td className="px-4 py-4"><p className="font-medium">{row.product_title}</p><p className="text-xs text-muted-foreground">Qty {row.quantity}</p></td>
                        <td className="px-4 py-4"><p>{row.delivered_at ? new Date(row.delivered_at).toLocaleDateString("en-IN") : "—"}</p><p className="text-xs text-muted-foreground">Release after {row.releaseable_at ? new Date(row.releaseable_at).toLocaleDateString("en-IN") : "—"}</p></td>
                        <td className="px-4 py-4"><p className="font-medium text-foreground">{row.returnable ? `Hold ${row.return_hold_days || 7} days` : "Release immediately"}</p><p className="text-xs text-muted-foreground">{row.eligible_for_release ? "Eligible now" : row.hold_reason || "On hold"}</p></td>
                        <td className="px-4 py-4"><p>{formatPrice(row.commission_amount)}</p><p className="text-xs text-muted-foreground">{row.commission_percent == null ? "Snapshot missing" : `${row.commission_percent}% retained`}</p></td>
                        <td className="px-4 py-4 font-medium text-emerald-700">{formatPrice(row.payout_amount)}</td>
                        <td className="px-4 py-4"><Button size="sm" variant="outline" className="rounded-full" onClick={() => downloadInvoice(row.order_id, row.invoice_number)}>Download</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3"><Landmark className="h-5 w-5 text-primary" /><div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Selected vendor bank payout</p><h3 className="font-serif text-2xl">{summary.vendor_name}</h3></div></div>
              <div className="mt-5 space-y-3 text-sm">
                <div className="rounded-xl border border-border p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Account Holder</p><p className="mt-1 font-medium">{summary.bank_account_holder || "—"}</p></div>
                <div className="rounded-xl border border-border p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Bank / IFSC</p><p className="mt-1 font-medium">{summary.bank_name || "—"} {summary.bank_ifsc ? `· ${summary.bank_ifsc}` : ""}</p></div>
                <div className="rounded-xl border border-border p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Account Number</p><p className="mt-1 font-medium">{summary.bank_account_number || "—"}</p></div>
                <div className={`rounded-xl border p-3 ${summary.bank_ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Bank Verification</p><p className="mt-1 font-medium">{summary.bank_ready ? "Verified and payout-ready" : "Bank details missing or not verified"}</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3"><ReceiptIndianRupee className="h-5 w-5 text-primary" /><div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Payment release note</p><h3 className="font-serif text-2xl">Settlement logic</h3></div></div>
              <p className="mt-4 text-sm text-muted-foreground">Release Payment is enabled only when the vendor bank is verified, the order item is delivered, there is no active return risk, and the payout row is eligible under the settlement rule.</p>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card p-14 text-center text-muted-foreground">Select a vendor to load outstanding delivered payouts.</div>
      )}
    </div>
  );
};

export default AdminVendorOutstanding;
