import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Layers3, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  downloadVendorErrorsCsv,
  downloadVendorTemplate,
  parseVendorUploadFile,
  VendorImportMode,
  VendorImportPreviewRow,
  VendorImportPreviewSummary,
  VendorUploadLog,
  VendorProduct,
  VendorUploadError,
} from "@/lib/vendor";
import { vendorFetch } from "@/lib/vendor-api";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import VendorAssignedCategories from "@/components/vendor/VendorAssignedCategories";
import VendorMetricCard from "@/components/vendor/VendorMetricCard";

const DEFAULT_VENDOR_UPLOAD_LIMIT = 25;
const MAX_VENDOR_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

type ImportSummary = {
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  upload_status: string;
  file_name: string;
  errors: VendorUploadError[];
  current_uploaded_count?: number;
  remaining_slots?: number;
  max_products_allowed?: number;
  import_mode?: VendorImportMode;
};

const VendorUploads = () => {
  const { vendor, refreshVendor } = useVendorAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<Array<Record<string, string | number | boolean>>>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewRows, setPreviewRows] = useState<VendorImportPreviewRow[]>([]);
  const [previewSummary, setPreviewSummary] = useState<VendorImportPreviewSummary | null>(null);
  const [logs, setLogs] = useState<VendorUploadLog[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importMode, setImportMode] = useState<VendorImportMode>("create_only");

  const remainingSlots = vendor?.remaining_slots ?? 0;
  const uploadLimit = vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT;
  const uploadedCount = vendor?.current_uploaded_count ?? 0;
  const limitReached = remainingSlots <= 0;

  const loadLogs = async () => {
    try {
      const response = await vendorFetch<VendorUploadLog[]>("/vendor-products/mine/logs");
      setLogs(response || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load upload history");
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    if (!parsedRows.length || !selectedFile) return;
    requestPreview(parsedRows, selectedFile.name);
  }, [importMode]);

  const resetPreview = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setHeaderError(null);
    setPreviewRows([]);
    setPreviewSummary(null);
    setPreviewLoading(false);
  };

  const requestPreview = async (rows: Array<Record<string, string | number | boolean>>, fileName: string) => {
    try {
      setPreviewLoading(true);
      const response = await vendorFetch<{ summary: VendorImportPreviewSummary; preview_rows: VendorImportPreviewRow[] }>("/vendor-products/preview-import", {
        method: "POST",
        body: JSON.stringify({ rows, file_name: fileName, mode: importMode }),
      });
      setPreviewSummary(response.summary);
      setPreviewRows(response.preview_rows || []);
      toast.success(`Preview ready for ${fileName}`);
    } catch (error) {
      setPreviewRows([]);
      setPreviewSummary(null);
      toast.error(error instanceof Error ? error.message : "Could not validate upload preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isValidType = file.name.endsWith(".xlsx");
    if (!isValidType) {
      toast.error("Please upload a modern .xlsx file");
      return;
    }
    if (file.size > MAX_VENDOR_IMPORT_FILE_SIZE_BYTES) {
      toast.error("Vendor Excel uploads must be 5 MB or smaller");
      return;
    }

    try {
      setSummary(null);
      setSelectedFile(file);
      const parsed = await parseVendorUploadFile(file);
      setParsedRows(parsed.rows);
      setHeaderError(parsed.headerError);
      setPreviewRows([]);
      setPreviewSummary(null);

      if (parsed.headerError) {
        toast.error(parsed.headerError);
        return;
      }

      if (!parsed.rows.length) {
        toast.error("No product rows found in the uploaded file");
        return;
      }

      await requestPreview(parsed.rows, file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse file");
    }
  };

  const handleImport = async () => {
    if (!selectedFile || headerError || parsedRows.length === 0 || !previewSummary?.valid_rows) return;
    try {
      setUploading(true);
      const response = await vendorFetch<{ summary: ImportSummary; imported_products: VendorProduct[] }>("/vendor-products/import", {
        method: "POST",
        body: JSON.stringify({ rows: parsedRows, file_name: selectedFile.name, mode: importMode }),
      });
      setSummary(response.summary);
      await Promise.all([refreshVendor(), loadLogs()]);
      toast.success("Import completed. Uploaded products remain Pending Approval.");
      resetPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import products");
    } finally {
      setUploading(false);
    }
  };

  const validRows = useMemo(() => previewRows.filter((row) => row.status === "valid"), [previewRows]);
  const invalidRows = useMemo(() => previewRows.filter((row) => row.status === "invalid"), [previewRows]);
  const failedRetryRows = useMemo(
    () => (summary?.errors || []).map((entry) => entry.row_data).filter(Boolean) as Array<Record<string, string | number | boolean>>,
    [summary]
  );

  const retryFailedRows = async () => {
    if (!failedRetryRows.length) return;
    setParsedRows(failedRetryRows);
    setSelectedFile(null);
    setSummary(null);
    await requestPreview(failedRetryRows, "retry-failed-rows");
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c09090]">Vendor product upload</p>
            <h2 className="mt-2 font-serif text-3xl text-[#3a1525]">Upload products with a gentle preview flow</h2>
            <p className="mt-2 text-sm leading-7 text-[#8a6070]">
              Upload Excel, preview every row before import, and confirm only after the validation table looks correct. Imported items stay pending until Admin approves them.
            </p>
          </div>
          <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-[#fff0f2] text-[#c05070] hover:bg-[#ffe7ed]" onClick={() => void downloadVendorTemplate()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Download template
          </Button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <VendorMetricCard label="Uploaded" value={uploadedCount} helper={`of ${uploadLimit} allowed`} />
          <VendorMetricCard label="Allowed" value={uploadLimit} helper="Default limit is 25 for new vendors" />
          <VendorMetricCard label="Remaining slots" value={remainingSlots} helper={limitReached ? "Upload disabled" : "Ready for the next confirmed import"} tone={limitReached ? "warning" : "default"} />
          <div className="rounded-[1.35rem] border border-[#f3dbe2] bg-white/90 p-5 shadow-[0_18px_40px_rgba(184,110,138,0.08)]">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#b88a98]"><Layers3 className="h-4 w-4 text-[#c05070]" /> Assigned categories</div>
            <div className="mt-3">
              <VendorAssignedCategories vendor={vendor} compact />
            </div>
          </div>
        </div>

        {limitReached ? (
          <div className="mt-5 flex items-start gap-3 rounded-[1.1rem] border border-[#f2e2c6] bg-[#fff9ef] px-4 py-3 text-sm text-[#9c7b43]">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>You have reached your upload limit. Upload is disabled until Admin increases your product allowance.</span>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f9c4d0,#e8a0b0)] text-lg">🌸</div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Step 1</p>
              <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Upload and preview</h3>
            </div>
          </div>

          <div className="mt-6 rounded-[1.4rem] border border-dashed border-[#e7d7cc] bg-[#fffaf7] p-6">
            <input
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              disabled={limitReached || previewLoading || uploading}
              className="block w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[linear-gradient(135deg,#c05070,#a03050)] file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white"
            />
            <p className="mt-3 text-sm text-[#8d6b77]">Accepted format: .xlsx. Import only happens after you click Confirm Import.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-[#6a4050]">Import mode</label>
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as VendorImportMode)} className="h-10 rounded-full border border-[#efd3db] bg-white px-4 text-sm text-[#6a4050] outline-none">
                <option value="create_only">Create new products only</option>
                <option value="upsert">Update existing SKU/slug if found</option>
              </select>
              <p className="text-xs text-[#8d6b77]">{importMode === "upsert" ? "Duplicate SKU or slug rows update the existing product and send it back for review." : "Duplicate SKU or slug rows will fail validation."}</p>
            </div>
          </div>

          {selectedFile ? (
            <div className="mt-6 rounded-[1.3rem] border border-[#f5ede5] bg-[#fff7f8] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-[#4a2030]">{selectedFile.name}</p>
                  <p className="mt-1 text-sm text-[#8d6b77]">Parsed rows: {parsedRows.length}</p>
                </div>
                {previewLoading ? (
                  <span className="inline-flex items-center rounded-full border border-[#efd3db] bg-white px-3 py-1 text-xs font-medium text-[#6a4050]">
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Validating
                  </span>
                ) : headerError ? <VendorStatusBadge status="failed" /> : <VendorStatusBadge status="uploaded" />}
              </div>
            </div>
          ) : null}

          {headerError ? <div className="mt-6 rounded-[1.1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{headerError}</div> : null}

          {previewSummary ? (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.1rem] border border-[#f5ede5] bg-[#fff8fa] p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">Total rows</p><p className="mt-2 font-serif text-3xl text-[#3a1525]">{previewSummary.total_rows}</p></div>
                <div className="rounded-[1.1rem] border border-emerald-200 bg-[#f2fbf5] p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-emerald-700">Valid rows</p><p className="mt-2 font-serif text-3xl text-emerald-700">{previewSummary.valid_rows}</p></div>
                <div className="rounded-[1.1rem] border border-rose-200 bg-rose-50 p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-rose-700">Invalid rows</p><p className="mt-2 font-serif text-3xl text-rose-700">{previewSummary.invalid_rows}</p></div>
              </div>

              <div className="overflow-hidden rounded-[1.4rem] border border-[#f5ede5] bg-[#fffaf8]">
                <div className="flex items-center justify-between gap-3 border-b border-[#f5ede5] bg-[#fff2f4] px-4 py-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">Step 2</p>
                    <h4 className="font-medium text-[#4a2030]">Preview table before import</h4>
                  </div>
                  <p className="text-sm text-[#8d6b77]">Only valid rows import after confirmation.</p>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#fff7f8] text-left text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">
                        <tr>
                          <th className="px-4 py-3">Row</th>
                          <th className="px-4 py-3">Action</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Title / SKU</th>
                          <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.row} className={`border-t border-[#f5ede5] align-top ${row.status === "invalid" ? "bg-rose-50/50" : "bg-emerald-50/30"}`}>
                          <td className="px-4 py-3 font-medium text-[#4a2030]">{row.row}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${row.action === "update" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-700"}`}>
                              {row.action === "update" ? "Update" : "Create"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {row.status === "valid" ? (
                              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Valid</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700"><XCircle className="mr-1.5 h-3.5 w-3.5" /> Invalid</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#4a2030]">{row.title || "—"}</p>
                            <p className="text-xs text-[#b98c97]">{row.sku || "No SKU"}</p>
                          </td>
                          <td className="px-4 py-3 text-[#8d6b77]">{row.category || "—"}{row.subcategory ? ` / ${row.subcategory}` : ""}</td>
                          <td className="px-4 py-3 text-[#8d6b77]">{row.errors.length ? row.errors.join(" • ") : "Ready to import"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button className="rounded-full bg-[linear-gradient(135deg,#c05070,#a03050)] px-5 hover:opacity-95" onClick={handleImport} disabled={uploading || previewLoading || limitReached || !!headerError || !previewSummary.valid_rows}>
                  {uploading ? "Importing..." : "Confirm Import"}
                </Button>
                <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" onClick={resetPreview} disabled={uploading || previewLoading}>
                  Cancel Upload
                </Button>
                {invalidRows.length ? <Button type="button" variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" onClick={() => downloadVendorErrorsCsv(invalidRows.map((row) => ({ row: row.row, title: row.title, sku: row.sku, errors: row.errors })), "vendor-preview-errors.csv")}>Download preview errors</Button> : null}
                <p className="text-sm text-[#8d6b77]">Only the valid rows shown above will be imported after confirmation.</p>
              </div>
            </div>
          ) : selectedFile && !headerError && previewLoading ? (
            <div className="mt-6 rounded-[1.2rem] border border-dashed border-[#ecd8de] p-10 text-center text-[#8d6b77]">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mt-3">Preparing preview table...</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f9c4d0,#e8a0b0)] text-lg">🌸</div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Import summary</p>
                <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Last result</h3>
              </div>
            </div>
            {summary ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between"><p className="font-medium text-[#4a2030]">{summary.file_name}</p><VendorStatusBadge status={summary.upload_status} /></div>
                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-[1rem] bg-[#fff8fa] p-4"><div className="font-serif text-2xl text-[#3a1525]">{summary.total_rows}</div><div className="text-[#8d6b77]">Total</div></div>
                  <div className="rounded-[1rem] bg-[#f2fbf5] p-4"><div className="font-serif text-2xl text-emerald-700">{summary.success_rows}</div><div className="text-[#8d6b77]">Imported</div></div>
                  <div className="rounded-[1rem] bg-rose-50 p-4"><div className="font-serif text-2xl text-rose-700">{summary.failed_rows}</div><div className="text-[#8d6b77]">Failed</div></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center text-sm">
                  <div className="rounded-[1rem] bg-[#fff8fa] p-4"><div className="text-lg font-semibold text-[#4a2030]">{summary.current_uploaded_count ?? vendor?.current_uploaded_count ?? 0}</div><div className="text-[#8d6b77]">Uploaded now</div></div>
                  <div className="rounded-[1rem] bg-[#fff8fa] p-4"><div className="text-lg font-semibold text-[#4a2030]">{summary.remaining_slots ?? vendor?.remaining_slots ?? 0}</div><div className="text-[#8d6b77]">Remaining slots</div></div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {summary.errors?.length ? <Button type="button" variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" onClick={() => downloadVendorErrorsCsv(summary.errors, `${summary.file_name.replace(/\.[^.]+$/, "") || "vendor-upload"}-errors.csv`)}>Download failure file</Button> : null}
                  {failedRetryRows.length ? <Button type="button" variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" onClick={retryFailedRows}>Retry only failed rows</Button> : null}
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[1.2rem] border border-dashed border-[#ecd8de] p-10 text-center text-[#8d6b77]">
                Parse a file to preview it, then confirm import to see the latest result here.
              </div>
            )}
          </div>

          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Validation snapshot</p>
            <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Current preview health</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1rem] border border-emerald-200 bg-[#f2fbf5] p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-emerald-700">Ready rows</p><p className="mt-2 font-serif text-3xl text-emerald-700">{validRows.length}</p></div>
              <div className="rounded-[1rem] border border-rose-200 bg-rose-50 p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-rose-700">Needs fixes</p><p className="mt-2 font-serif text-3xl text-rose-700">{invalidRows.length}</p></div>
            </div>
            <p className="mt-4 text-sm text-[#8d6b77]">Invalid rows can fail because of missing fields, duplicate SKU or slug, limit overflow, taxonomy mismatch, or categories not assigned by Admin.</p>
          </div>

          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#c09090]">Upload history</p>
            <h3 className="mt-1 font-serif text-2xl text-[#3a1525]">Recent files</h3>
            <div className="mt-5 space-y-3">
              {logs.length === 0 ? (
                <div className="rounded-[1.2rem] border border-dashed border-[#ecd8de] p-8 text-center text-[#8d6b77]">No uploads yet.</div>
              ) : (
                logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="rounded-[1.1rem] border border-[#f5ede5] bg-[#fff8fa] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#4a2030]">{log.file_name}</p>
                        <p className="mt-1 text-xs text-[#b98c97]">{new Date(log.created_at).toLocaleDateString("en-IN")}</p>
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

export default VendorUploads;
