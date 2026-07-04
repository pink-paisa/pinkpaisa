import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import { VendorDashboardStats, VendorProduct, VendorUploadLog, formatCurrency, formatDate } from "@/lib/vendor";
import { vendorFetch } from "@/lib/vendor-api";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import VendorAssignedCategories from "@/components/vendor/VendorAssignedCategories";
import VendorMetricCard from "@/components/vendor/VendorMetricCard";
import VendorPayoutPauseBanner from "@/components/vendor/VendorPayoutPauseBanner";

const DEFAULT_VENDOR_UPLOAD_LIMIT = 25;

const VendorDashboard = () => {
  const { vendor, refreshVendor } = useVendorAuth();
  const [stats, setStats] = useState<VendorDashboardStats | null>(null);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [logs, setLogs] = useState<VendorUploadLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await refreshVendor();
        const [statsRes, productsRes, logsRes] = await Promise.all([
          vendorFetch<VendorDashboardStats>("/vendor-products/mine/stats"),
          vendorFetch<{ items: VendorProduct[] }>("/vendor-products/mine?page=1&limit=6"),
          vendorFetch<VendorUploadLog[]>("/vendor-products/mine/logs"),
        ]);
        setStats(statsRes);
        setProducts(productsRes.items || []);
        setLogs(logsRes || []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load vendor dashboard");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [refreshVendor]);

  const remainingSlots = stats?.remaining_slots ?? vendor?.remaining_slots ?? 0;
  const uploadLimit = vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT;
  const uploadedCount = stats?.total_uploaded_products ?? vendor?.current_uploaded_count ?? 0;
  const limitReached = remainingSlots <= 0;

  const statCards = useMemo(
    () => [
      { label: "Uploaded", value: uploadedCount, helper: `of ${uploadLimit} allowed`, tone: "default" as const },
      { label: "Pending review", value: stats?.pending_approval_products ?? 0, helper: "Awaiting admin action", tone: "warning" as const },
      { label: "Approved", value: stats?.approved_products ?? 0, helper: "Visible on public products", tone: "success" as const },
      { label: "Remaining slots", value: remainingSlots, helper: limitReached ? "Upload limit reached" : "Ready for next import", tone: limitReached ? "warning" as const : "default" as const },
    ],
    [limitReached, remainingSlots, stats?.approved_products, stats?.pending_approval_products, uploadLimit, uploadedCount]
  );

  return (
    <div className="space-y-6">
      <VendorPayoutPauseBanner vendor={vendor} />
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_55%,#fdf0e8_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c09090]">Vendor dashboard</p>
              <VendorStatusBadge status={vendor?.status || "verified"} />
            </div>
            <h2 className="mt-3 font-serif text-4xl leading-tight text-[#3a1525]">Welcome back,<br /><span className="text-[#c05070]">{vendor?.shop_name}</span></h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#8a6070] md:text-base">
              Manage uploads, track approval flow, and operate your vendor catalog in a softer editorial ERP experience inspired by the Organic Soft concept.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:max-w-2xl">
              <div className="rounded-[1.2rem] border border-[#f5ede5] bg-white/90 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-[#6a4050]">
                  <ShieldCheck className="h-4 w-4 text-[#c05070]" /> Verification badge
                </div>
                <p className="mt-2 text-sm text-[#8d6b77]">Your uploads remain pending until Pink Paisa approves them.</p>
              </div>
              <div className="rounded-[1.2rem] border border-[#f5ede5] bg-white/90 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-[#6a4050]">
                  <Sparkles className="h-4 w-4 text-[#c05070]" /> Assigned category access
                </div>
                <div className="mt-3">
                  <VendorAssignedCategories vendor={vendor} compact />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[320px]">
            <Button className={`rounded-full bg-[linear-gradient(135deg,#c05070,#a03050)] px-5 hover:opacity-95 ${limitReached ? "pointer-events-none opacity-60" : ""}`} asChild>
              <Link href="/vendor/uploads">
                Upload Products <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" asChild>
              <Link href="/vendor/products">Open Product Table</Link>
            </Button>
            <div className="rounded-[1.2rem] border border-[#f0d7de] bg-white/80 px-4 py-4 text-sm text-[#7a5060] sm:col-span-2">
              Uploaded <span className="font-semibold text-[#4a2030]">{uploadedCount}</span> / Allowed <span className="font-semibold text-[#4a2030]">{uploadLimit}</span> | Remaining <span className="font-semibold text-[#4a2030]">{remainingSlots}</span>
            </div>
          </div>
        </div>
        {limitReached ? (
          <div className="mt-5 rounded-[1.1rem] border border-[#f2e2c6] bg-[#fff9ef] px-4 py-3 text-sm text-[#9c7b43]">
            Upload is disabled because the current vendor limit is fully used. Ask Admin to increase the allowed product count.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <VendorMetricCard key={card.label} label={card.label} value={loading ? "-" : card.value} helper={card.helper} tone={card.tone} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#c09090]">Product table</p>
              <h3 className="mt-2 font-serif text-2xl text-[#3a1525]">Latest uploaded products</h3>
            </div>
            <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" asChild>
              <Link href="/vendor/products">View all products</Link>
            </Button>
          </div>
          <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-[#f5ede5] bg-[#fffaf8]">
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#fff2f4] text-left text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">
                  <tr>
                    <th className="px-4 py-4">Product</th>
                    <th className="px-4 py-4">Category</th>
                    <th className="px-4 py-4">Price</th>
                    <th className="px-4 py-4">Approval</th>
                    <th className="px-4 py-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="px-4 py-16 text-center text-[#8d6b77]" colSpan={5}>Loading product table...</td></tr>
                  ) : products.length === 0 ? (
                    <tr><td className="px-4 py-16 text-center text-[#8d6b77]" colSpan={5}>No products uploaded yet.</td></tr>
                  ) : (
                    products.map((product) => (
                      <tr key={product.id} className="border-t border-[#f5ede5] align-top">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 overflow-hidden rounded-[1rem] bg-[#fff1f3]">
                              {product.featured_image ? (
                                <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[#c09090]">No image</div>
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-[#4a2030]">{product.title}</p>
                              <p className="text-xs text-[#b98c97]">{product.sku || "No SKU"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[#8d6b77]">{product.category || "-"}{product.subcategory ? ` / ${product.subcategory}` : ""}</td>
                        <td className="px-4 py-4 font-medium text-[#4a2030]">{formatCurrency(product.price)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <VendorStatusBadge status={product.upload_status} />
                            <VendorStatusBadge status={product.approval_status} />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[#8d6b77]">{formatDate(product.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f9c4d0,#e8a0b0)]">
                <Sparkles className="h-5 w-5 text-[#8b3a57]" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Upload summary</p>
                <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Capacity overview</h3>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.1rem] border border-[#f5ede5] bg-[#fff7f8] p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">Allowed products</p>
                <p className="mt-2 font-serif text-3xl text-[#3a1525]">{uploadLimit}</p>
              </div>
              <div className="rounded-[1.1rem] border border-[#f5ede5] bg-[#fffaf3] p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">Remaining slots</p>
                <p className="mt-2 font-serif text-3xl text-[#3a1525]">{remainingSlots}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Link href="/vendor/uploads" className="flex items-center justify-between rounded-[1.1rem] border border-[#f5ede5] bg-[#fff8fa] px-4 py-4 text-sm font-medium text-[#6a4050] transition-all hover:bg-[#fff2f4]">
                <span className="flex items-center gap-3"><FileSpreadsheet className="h-4 w-4 text-[#c05070]" /> Upload Excel or CSV</span>
                <ArrowRight className="h-4 w-4 text-[#c09090]" />
              </Link>
              <Link href="/vendor/history" className="flex items-center justify-between rounded-[1.1rem] border border-[#f5ede5] bg-[#fff8fa] px-4 py-4 text-sm font-medium text-[#6a4050] transition-all hover:bg-[#fff2f4]">
                <span className="flex items-center gap-3"><Sparkles className="h-4 w-4 text-[#c05070]" /> View upload history</span>
                <ArrowRight className="h-4 w-4 text-[#c09090]" />
              </Link>
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Upload history</p>
                <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Recent files</h3>
              </div>
              <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" asChild>
                <Link href="/vendor/history">Open history</Link>
              </Button>
            </div>
            <div className="mt-5 space-y-3">
              {loading ? (
                <div className="rounded-[1.2rem] border border-dashed border-[#ecd8de] p-10 text-center text-[#8d6b77]">Loading upload history...</div>
              ) : logs.length === 0 ? (
                <div className="rounded-[1.2rem] border border-dashed border-[#ecd8de] p-10 text-center text-[#8d6b77]">No upload history available yet.</div>
              ) : (
                logs.slice(0, 4).map((log) => (
                  <div key={log.id} className="rounded-[1.1rem] border border-[#f5ede5] bg-[#fff8fa] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#4a2030]">{log.file_name}</p>
                        <p className="mt-1 text-xs text-[#b98c97]">{formatDate(log.created_at)}</p>
                      </div>
                      <VendorStatusBadge status={log.upload_status} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-[1rem] bg-white px-2 py-3 text-[#4a2030]">{log.total_rows}<div className="text-[#b98c97]">Rows</div></div>
                      <div className="rounded-[1rem] bg-white px-2 py-3 text-[#4a2030]">{log.success_rows}<div className="text-[#b98c97]">Imported</div></div>
                      <div className="rounded-[1rem] bg-white px-2 py-3 text-[#4a2030]">{log.failed_rows}<div className="text-[#b98c97]">Failed</div></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default VendorDashboard;
