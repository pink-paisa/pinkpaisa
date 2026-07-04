/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Download, FileSpreadsheet, Check, AlertTriangle, Trash2 } from "lucide-react";
import { FormCard, StatusBadge } from "./AdminShared";
import { apiFetch } from "@/lib/api";
import { downloadWorkbook, readFirstWorksheetObjects } from "@/lib/excelWorkbook";

type ParsedProduct = {
  title: string;
  slug: string;
  short_description: string;
  full_description: string;
  category_name: string;
  subcategory_name: string;
  price: number;
  sale_price: number | null;
  mrp: number | null;
  gst_rate_percent: number | null;
  hsn_code: string;
  brand_name: string;
  country_of_origin: string;
  sku: string;
  stock_quantity: number;
  tags: string[];
  weight: number | null;
  dimensions: string;
  seo_meta_title: string;
  seo_meta_description: string;
  seo_keywords: string[];
  status: string;
  featured: boolean;
  bestseller: boolean;
  sort_order: number;
  featured_image: string;
  additional_images: string[];
  _valid: boolean;
  _errors: string[];
};

const TEMPLATE_COLUMNS = [
  "title*", "slug*", "price*", "sale_price", "sku", "stock_quantity",
  "category_name*", "subcategory_name*", "mrp", "gst_rate_percent", "hsn_code", "brand_name", "country_of_origin",
  "short_description", "full_description", "tags", "seo_meta_title", "seo_meta_description", "seo_keywords",
  "weight", "dimensions", "status", "featured", "bestseller", "sort_order",
  "featured_image", "additional_images"
];
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
const ALLOWED_COLUMNS = new Set(TEMPLATE_COLUMNS.flatMap((column) => [column, column.replace(/\*$/, "")]));

const SAMPLE_DATA = [
  ["Rose Quartz Roller", "rose-quartz-roller", 899, 699, "WP-001", 50,
   "Wellness", "Self Care", 999, 18, "33049910", "Pink Paisa", "India",
   "Natural rose quartz face roller", "Premium rose quartz crystal face roller for daily skincare routine.",
   "skincare, wellness, crystal", "Rose Quartz Roller | Pink Paisa", "Natural rose quartz face roller for skincare rituals.", "skincare, roller, wellness", 150, "15x5x3 cm", "active", "yes", "no", 1,
   "https://example.com/images/rose-quartz.jpg", "https://example.com/img2.jpg, https://example.com/img3.jpg"],
  ["Lavender Candle Set", "lavender-candle-set", 1299, "", "WP-002", 30,
   "Wellness", "Relaxation", 1499, 12, "34060000", "Pink Paisa", "India",
   "Set of 3 lavender scented candles", "Hand-poured soy wax candles with natural lavender essential oil.",
   "candles, aromatherapy", "Lavender Candle Set", "Soy candles with lavender essential oil.", "candles, aromatherapy", 450, "10x10x8 cm", "active", "no", "yes", 2,
   "https://example.com/images/lavender-candle.jpg", ""],
];

const downloadTemplate = async () => {
  const data = [TEMPLATE_COLUMNS, ...SAMPLE_DATA];
  const instructions = [
    ["Column", "Required", "Description", "Example"],
    ["title", "Yes", "Product name", "Rose Quartz Roller"],
    ["slug", "Yes", "URL-friendly identifier (lowercase, hyphens)", "rose-quartz-roller"],
    ["price", "Yes", "Product price in ₹", "899"],
    ["sale_price", "No", "Discounted price in ₹ (leave empty if none)", "699"],
    ["sku", "No", "Stock Keeping Unit code", "WP-001"],
    ["stock_quantity", "No", "Number of items in stock (default: 0)", "50"],
    ["category_name", "Yes", "Category name from taxonomy", "Wellness"],
    ["subcategory_name", "Yes", "Subcategory name from taxonomy", "Self Care"],
    ["mrp", "No", "Maximum retail price in ₹", "999"],
    ["gst_rate_percent", "No", "GST rate percentage", "18"],
    ["hsn_code", "No", "HSN code for invoicing", "33049910"],
    ["brand_name", "No", "Brand name", "Pink Paisa"],
    ["country_of_origin", "No", "Country of origin", "India"],
    ["short_description", "No", "Brief product description", "Natural rose quartz roller"],
    ["full_description", "No", "Detailed product description", "Premium crystal roller..."],
    ["tags", "No", "Comma-separated tags", "skincare, wellness"],
    ["seo_meta_title", "No", "SEO title", "Rose Quartz Roller | Pink Paisa"],
    ["seo_meta_description", "No", "SEO description", "Natural rose quartz face roller..."],
    ["seo_keywords", "No", "Comma-separated SEO keywords", "skincare, roller, wellness"],
    ["weight", "No", "Weight in grams", "150"],
    ["dimensions", "No", "Product dimensions", "15x5x3 cm"],
    ["status", "No", "active / draft / out_of_stock (default: active)", "active"],
    ["featured", "No", "yes / no (default: no)", "no"],
    ["bestseller", "No", "yes / no (default: no)", "no"],
    ["sort_order", "No", "Display order number (default: 0)", "1"],
    ["featured_image", "No", "URL for main product image", "https://example.com/image.jpg"],
    ["additional_images", "No", "Comma-separated URLs for extra images", "https://example.com/img2.jpg, https://example.com/img3.jpg"],
  ];
  await downloadWorkbook("product_upload_template.xlsx", [
    {
      name: "Products",
      rows: data,
      widths: TEMPLATE_COLUMNS.map((col) => Math.max(col.length + 2, 16)),
    },
    {
      name: "Instructions",
      rows: instructions,
      widths: [20, 10, 50, 25],
    },
  ]);
  toast.success("Template downloaded!");
};

const parseBool = (v: any): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "yes" || s === "true" || s === "1";
};

const parseRow = (row: any): ParsedProduct => {
  const errors: string[] = [];
  const title = String(row["title*"] ?? row["title"] ?? "").trim();
  const slug = String(row["slug*"] ?? row["slug"] ?? "").trim();
  const priceRaw = row["price*"] ?? row["price"];
  const price = Number(priceRaw);

  if (!title) errors.push("Title required");
  if (!slug) errors.push("Slug required");
  if (!priceRaw || isNaN(price) || price <= 0) errors.push("Valid price required");

  const salePriceRaw = row["sale_price"];
  const salePrice = salePriceRaw && !isNaN(Number(salePriceRaw)) ? Number(salePriceRaw) : null;
  const mrpRaw = row["mrp"];
  const mrp = mrpRaw && !isNaN(Number(mrpRaw)) ? Number(mrpRaw) : null;
  const tagsStr = String(row["tags"] ?? "");
  const tags = tagsStr ? tagsStr.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const seoKeywordsStr = String(row["seo_keywords"] ?? "");
  const seoKeywords = seoKeywordsStr ? seoKeywordsStr.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const weightRaw = row["weight"];
  const weight = weightRaw && !isNaN(Number(weightRaw)) ? Number(weightRaw) : null;
  const gstRateRaw = row["gst_rate_percent"];
  const gstRate = gstRateRaw && !isNaN(Number(gstRateRaw)) ? Number(gstRateRaw) : null;
  const status = String(row["status"] ?? "active").toLowerCase().trim();
  if (!["active", "draft", "out_of_stock"].includes(status)) errors.push(`Invalid status: ${status}`);
  const categoryName = String(row["category_name"] ?? row["category"] ?? "").trim();
  const subcategoryName = String(row["subcategory_name"] ?? row["subcategory"] ?? "").trim();
  if (!categoryName) errors.push("Category required");
  if (!subcategoryName) errors.push("Subcategory required");
  if (mrp != null && mrp < price) errors.push("MRP must be greater than or equal to price");
  if (gstRate != null && (gstRate < 0 || gstRate > 50)) errors.push("GST rate must be between 0 and 50");

  const featuredImage = String(row["featured_image"] ?? "").trim();
  const addlImagesStr = String(row["additional_images"] ?? "");
  const additionalImages = addlImagesStr ? addlImagesStr.split(",").map((u: string) => u.trim()).filter(Boolean) : [];

  return {
    title, slug, price: isNaN(price) ? 0 : price,
    short_description: String(row["short_description"] ?? ""),
    full_description: String(row["full_description"] ?? ""),
    category_name: categoryName,
    subcategory_name: subcategoryName,
    sale_price: salePrice,
    mrp,
    gst_rate_percent: gstRate,
    hsn_code: String(row["hsn_code"] ?? "").trim(),
    brand_name: String(row["brand_name"] ?? "").trim(),
    country_of_origin: String(row["country_of_origin"] ?? "India").trim() || "India",
    sku: String(row["sku"] ?? ""),
    stock_quantity: Number(row["stock_quantity"] ?? 0) || 0,
    tags, weight,
    dimensions: String(row["dimensions"] ?? ""),
    seo_meta_title: String(row["seo_meta_title"] ?? "").trim(),
    seo_meta_description: String(row["seo_meta_description"] ?? "").trim(),
    seo_keywords: seoKeywords,
    status,
    featured: parseBool(row["featured"]),
    bestseller: parseBool(row["bestseller"]),
    sort_order: Number(row["sort_order"] ?? 0) || 0,
    featured_image: featuredImage,
    additional_images: additionalImages,
    _valid: errors.length === 0,
    _errors: errors,
  };
};

export const BulkProductUpload = () => {
  const [parsedRows, setParsedRows] = useState<ParsedProduct[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Upload a modern Excel file with .xlsx extension");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      toast.error("Excel import files must be 5 MB or smaller");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    void readFirstWorksheetObjects(file)
      .then((json) => {
        if (!json.length) { toast.error("No data rows found"); return; }
        if (json.length > MAX_IMPORT_ROWS) {
          toast.error(`Bulk product imports are limited to ${MAX_IMPORT_ROWS} rows`);
          return;
        }
        const unknownColumns = Object.keys(json[0] || {}).filter((column) => !ALLOWED_COLUMNS.has(column));
        if (unknownColumns.length) {
          toast.error(`Unknown column(s): ${unknownColumns.join(", ")}`);
          return;
        }
        const parsed = json.map(parseRow);
        setParsedRows(parsed);
        setShowReview(true);
        toast.success(`${parsed.length} product(s) parsed`);
      })
      .catch(() => toast.error("Failed to read file"));
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeRow = (i: number) => setParsedRows((prev) => prev.filter((_, idx) => idx !== i));

  const confirmUpload = async () => {
    const valid = parsedRows.filter((r) => r._valid);
    if (!valid.length) { toast.error("No valid products to upload"); return; }
    setUploading(true);
    const payloads = valid.map((row) => ({
      title: row.title,
      slug: row.slug,
      price: row.price,
      mrp: row.mrp,
      gst_rate_percent: row.gst_rate_percent,
      hsn_code: row.hsn_code || null,
      brand_name: row.brand_name || null,
      country_of_origin: row.country_of_origin || "India",
      short_description: row.short_description || null,
      full_description: row.full_description || null,
      category_name: row.category_name,
      subcategory_name: row.subcategory_name,
      sale_price: row.sale_price,
      sku: row.sku || null,
      stock_quantity: row.stock_quantity,
      tags: row.tags,
      weight: row.weight,
      dimensions: row.dimensions || null,
      seo_meta_title: row.seo_meta_title || null,
      seo_meta_description: row.seo_meta_description || null,
      seo_keywords: row.seo_keywords,
      status: row.status === "out_of_stock" ? "inactive" : row.status,
      featured: row.featured,
      bestseller: row.bestseller,
      sort_order: row.sort_order,
      featured_image: row.featured_image || null,
      additional_images: row.additional_images.length > 0 ? row.additional_images : [],
    }));
    try {
      const response = await apiFetch<{ summary: { success_rows: number; failed_rows: number }; errors: Array<{ row: number; errors: string[] }> }>(`/products/bulk-import`, {
        method: "POST",
        body: JSON.stringify({ rows: payloads, mode: "create_only" }),
      });
      if (response.summary.failed_rows > 0) {
        toast.error(`${response.summary.failed_rows} row(s) failed during import. Review the server validation errors and retry those rows.`);
      } else {
        toast.success(`${response.summary.success_rows} product(s) uploaded!`);
      }
      setParsedRows([]);
      setShowReview(false);
      queryClient.invalidateQueries({ queryKey: ["physical_products"] });
      queryClient.invalidateQueries({ queryKey: ["catalog_products"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
      console.error(error);
    }
    setUploading(false);
  };

  const validCount = parsedRows.filter((r) => r._valid).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center gap-2 mb-1">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h4 className="font-medium text-sm">Bulk Upload via Excel</h4>
            </div>
            <p className="text-xs text-muted-foreground">Upload an Excel file (.xlsx) to add multiple products at once. Download the template first.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()} className="rounded-lg">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Sample Template
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()} className="rounded-lg">
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload Excel
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} className="hidden" />
          </div>
        </div>
      </div>

      {showReview && parsedRows.length > 0 && (
        <FormCard title="Review Products Before Upload" onClose={() => { setShowReview(false); setParsedRows([]); }}>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-600"><Check className="h-4 w-4" /> {validCount} valid</span>
            {invalidCount > 0 && <span className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-4 w-4" /> {invalidCount} with errors</span>}
            <span className="text-muted-foreground">Total: {parsedRows.length}</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Title</th>
                  <th className="px-3 py-2 text-left font-medium">Slug</th>
                  <th className="px-3 py-2 text-left font-medium">Price</th>
                  <th className="px-3 py-2 text-left font-medium">SKU</th>
                  <th className="px-3 py-2 text-left font-medium">Stock</th>
                  <th className="px-3 py-2 text-left font-medium">Taxonomy</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Issues</th>
                  <th className="px-3 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r, i) => (
                  <tr key={i} className={`border-b border-border last:border-0 ${!r._valid ? "bg-destructive/5" : ""}`}>
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium max-w-[160px] truncate">{r.title || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{r.slug || "—"}</td>
                    <td className="px-3 py-2">₹{r.price}{r.sale_price ? <span className="text-muted-foreground ml-1">(₹{r.sale_price})</span> : ""}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.sku || "—"}</td>
                    <td className="px-3 py-2">{r.stock_quantity}</td>
                    <td className="px-3 py-2">{r.category_name} / {r.subcategory_name}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">{r._valid ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="text-destructive text-[10px]">{r._errors.join(", ")}</span>}</td>
                    <td className="px-3 py-2"><button onClick={() => removeRow(i)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => { setShowReview(false); setParsedRows([]); }}>Cancel</Button>
            <Button onClick={confirmUpload} disabled={uploading || validCount === 0}>
              {uploading ? "Uploading…" : `Upload ${validCount} Product${validCount !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </FormCard>
      )}
    </div>
  );
};
