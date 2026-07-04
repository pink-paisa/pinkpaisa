import { useEffect, useMemo, useState } from "react";
import { Download, Landmark } from "lucide-react";
import { toast } from "sonner";
import { vendorFetch } from "@/lib/vendor-api";
import { VendorSettlement, formatCurrency, formatDate, statusBadgeClass } from "@/lib/vendor";
import { Button } from "@/components/ui/button";
import VendorMetricCard from "@/components/vendor/VendorMetricCard";
import { API_URL } from "@/lib/api";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import VendorPayoutPauseBanner from "@/components/vendor/VendorPayoutPauseBanner";

const VendorPayouts = () => {
  const { vendor } = useVendorAuth();
  const [items, setItems] = useState<VendorSettlement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const response = await vendorFetch<{ items: VendorSettlement[] }>("/settlements/mine");
      setItems(response.items || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settlements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => items.reduce((acc, item) => {
    const net = Number(item.net_payable || 0);
    if (item.status === "paid") acc.paid += net;
    else if (["draft", "initiated", "processing"].includes(item.status)) acc.processing += net;
    else if (item.status === "failed") acc.failed += net;
    return acc;
  }, { paid: 0, processing: 0, failed: 0 }), [items]);

  const downloadInvoice = async (settlement: VendorSettlement) => {
    try {
      const response = await fetch(`${API_URL}/settlements/mine/${settlement.id}/invoice`, {
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
      link.download = `${settlement.invoice?.invoice_number || settlement.settlement_number}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download settlement invoice");
    }
  };

  return (
    <div className="space-y-6">
      <VendorPayoutPauseBanner vendor={vendor} />
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_55%,#fdf0e8_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Settlement statement</p>
        <h2 className="mt-2 font-serif text-3xl">Vendor payouts</h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">Every payout release now lands as a settlement with linked order items, a frozen bank snapshot, and a downloadable Pink Paisa commission invoice.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <VendorMetricCard label="Paid" value={formatCurrency(summary.paid)} helper="Settlements marked paid" tone="success" />
        <VendorMetricCard label="Processing" value={formatCurrency(summary.processing)} helper="Waiting on final payout status" tone="warning" />
        <VendorMetricCard label="Failed" value={formatCurrency(summary.failed)} helper="Needs admin retry" tone="warning" />
      </section>

      <section className="overflow-hidden rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="border-b border-[#f5ede5] bg-[#fff6f7] px-4 py-4">
          <div className="flex items-center gap-3">
            <Landmark className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Settlement history</p>
              <h3 className="mt-1 font-serif text-2xl">Released payouts</h3>
            </div>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#fffafb] text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-4">Settlement</th>
                <th className="px-4 py-4">Period</th>
                <th className="px-4 py-4">Gross</th>
                <th className="px-4 py-4">Commission</th>
                <th className="px-4 py-4">Net payable</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Loading settlements...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No settlements yet.</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="border-t border-[#f5ede5] align-top">
                  <td className="px-4 py-4">
                    <p className="font-medium">{item.settlement_number}</p>
                    <p className="text-xs text-muted-foreground">{item.line_count} item(s)</p>
                  </td>
                  <td className="px-4 py-4">
                    <p>{formatDate(item.period_start)}</p>
                    <p className="text-xs text-muted-foreground">to {formatDate(item.period_end)}</p>
                  </td>
                  <td className="px-4 py-4">{formatCurrency(item.gross_amount)}</td>
                  <td className="px-4 py-4">
                    <p>{formatCurrency(item.commission_amount)}</p>
                    <p className="text-xs text-muted-foreground">GST {formatCurrency(item.commission_gst_amount)}</p>
                  </td>
                  <td className="px-4 py-4 font-medium text-emerald-700">{formatCurrency(item.net_payable)}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${statusBadgeClass(item.status)}`}>{item.status}</span>
                    <p className="mt-2 text-xs text-muted-foreground">Processed {formatDate(item.processed_at || item.initiated_at || null)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => downloadInvoice(item)} disabled={!item.invoice?.invoice_number}>
                      <Download className="mr-2 h-4 w-4" /> Invoice
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default VendorPayouts;
