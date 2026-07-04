import { useEffect, useState } from "react";
import { vendorFetch } from "@/lib/vendor-api";
import { formatDate, VendorUploadLog } from "@/lib/vendor";
import { toast } from "sonner";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";

const VendorHistory = () => {
  const [logs, setLogs] = useState<VendorUploadLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await vendorFetch<VendorUploadLog[]>("/vendor-products/mine/logs");
        setLogs(response || []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load upload history");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_60%,#fdf4ee_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c09090]">Upload history</p>
        <h2 className="mt-2 font-serif text-3xl text-[#3a1525]">Validation results and import logs</h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[#8a6070]">
          Review file-level summaries, failed rows, and upload outcomes for every import attempt made by this vendor in the Organic Soft workspace.
        </p>
      </section>

      <div className="space-y-4">
        {loading ? (
          <div className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-10 text-center text-[#8d6b77] shadow-[0_20px_46px_rgba(186,131,149,0.08)]">Loading upload history...</div>
        ) : logs.length === 0 ? (
          <div className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-10 text-center text-[#8d6b77] shadow-[0_20px_46px_rgba(186,131,149,0.08)]">No upload history available yet.</div>
        ) : (
          logs.map((log) => (
            <section key={log.id} className="rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-medium text-[#4a2030]">{log.file_name}</p>
                  <p className="mt-1 text-sm text-[#8d6b77]">Uploaded on {formatDate(log.created_at)}</p>
                </div>
                <VendorStatusBadge status={log.upload_status} />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1rem] bg-[#fff8fa] p-4 text-center"><div className="font-serif text-2xl text-[#3a1525]">{log.total_rows}</div><div className="text-[#8d6b77]">Total rows</div></div>
                <div className="rounded-[1rem] bg-[#f2fbf5] p-4 text-center"><div className="font-serif text-2xl text-emerald-700">{log.success_rows}</div><div className="text-[#8d6b77]">Successful rows</div></div>
                <div className="rounded-[1rem] bg-rose-50 p-4 text-center"><div className="font-serif text-2xl text-rose-700">{log.failed_rows}</div><div className="text-[#8d6b77]">Failed rows</div></div>
              </div>
              {log.error_json?.length > 0 && (
                <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-[#f5ede5] bg-[#fffaf8]">
                  <div className="max-h-[320px] overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#fff2f4] text-left text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">
                        <tr>
                          <th className="px-4 py-3">Row</th>
                          <th className="px-4 py-3">Title</th>
                          <th className="px-4 py-3">SKU</th>
                          <th className="px-4 py-3">Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {log.error_json.map((error) => (
                          <tr key={`${log.id}-${error.row}`} className="border-t border-[#f5ede5] align-top">
                            <td className="px-4 py-3 font-medium text-[#4a2030]">{error.row}</td>
                            <td className="px-4 py-3 text-[#6a4050]">{error.title || "—"}</td>
                            <td className="px-4 py-3 text-[#6a4050]">{error.sku || "—"}</td>
                            <td className="px-4 py-3 text-[#8d6b77]">{error.errors.join(" • ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default VendorHistory;
