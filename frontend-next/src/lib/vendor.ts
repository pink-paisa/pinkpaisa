import { downloadWorkbook, readFirstWorksheetRows } from "@/lib/excelWorkbook";

export type VendorStatus = "pending" | "verified" | "rejected" | "banned";
export type ProductStatus = "active" | "draft" | "inactive";
export type ApprovalStatus = "pending_approval" | "approved" | "rejected";
export type UploadStatus = "uploaded" | "processed" | "completed" | "partial" | "failed" | "limit_reached";
export type VendorImportMode = "create_only" | "upsert";

export type VendorAssignedCategory = { id: string; name: string; slug: string; is_active?: boolean };
export type VendorBankDetails = { account_holder_name?: string | null; account_number?: string | null; ifsc_code?: string | null; bank_name?: string | null; branch_name?: string | null; upi_id?: string | null };
export type VendorKycDocuments = {
  pan_url?: string | null;
  gst_certificate_url?: string | null;
  aadhaar_url?: string | null;
  cancelled_cheque_url?: string | null;
  uploaded_at?: string | null;
};

export type Vendor = {
  id: string;
  owner_name: string;
  mobile: string;
  email: string;
  email_verified?: boolean;
  business_name: string;
  shop_name: string;
  business_type: string;
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  website: string | null;
  status: VendorStatus;
  max_products_allowed: number;
  commission_percent?: number;
  assigned_categories?: VendorAssignedCategory[];
  has_category_restrictions?: boolean;
  kyc_verified?: boolean;
  bank_verified?: boolean;
  kyc_documents?: VendorKycDocuments;
  bank_details?: VendorBankDetails;
  bank_changed_at?: string | null;
  bank_cooldown_ends_at?: string | null;
  payout_paused?: boolean;
  payout_pause_reason?: string | null;
  order_reject_count?: number;
  auto_ban_threshold?: number;
  current_uploaded_count: number;
  remaining_slots: number;
  pending_products_count?: number;
  approved_products_count?: number;
  rejected_products_count?: number;
  admin_notes: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at?: string;
  meta?: { product_count: number; upload_count: number; pending_products_count?: number; approved_products_count?: number; rejected_products_count?: number };
};

export type VendorProduct = {
  id: string;
  vendor_id: string;
  vendor?: { id: string; owner_name: string; business_name: string; shop_name: string; email: string };
  title: string;
  slug: string;
  price: number;
  sale_price: number | null;
  sku: string | null;
  stock_quantity: number;
  category_id?: string | null;
  subcategory_id?: string | null;
  category: string | null;
  subcategory?: string | null;
  short_description: string | null;
  full_description: string | null;
  tags: string[];
  weight: string | null;
  dimensions: string | null;
  status: ProductStatus;
  upload_status: UploadStatus;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  rejection_reason?: string | null;
  rejection_note?: string | null;
  resubmission_count?: number;
  returnable?: boolean;
  return_window_days?: number;
  return_liability?: "vendor" | "pinkpaisa";
  featured: boolean;
  bestseller: boolean;
  sort_order: number;
  featured_image: string | null;
  additional_images: string[];
  images?: string[];
  created_at: string;
  updated_at?: string;
};

export type VendorUploadError = { row: number; title?: string | null; sku?: string | null; errors: string[]; row_data?: Record<string, unknown> };
export type VendorUploadLog = { id: string; vendor_id: string; file_name: string; total_rows: number; success_rows: number; failed_rows: number; upload_status: "completed" | "partial" | "failed"; error_json: VendorUploadError[]; created_at: string };
export type VendorImportPreviewRow = { row: number; title: string | null; sku: string | null; category: string | null; subcategory: string | null; action?: "create" | "update"; status: "valid" | "invalid"; errors: string[] };
export type VendorImportPreviewSummary = { total_rows: number; valid_rows: number; invalid_rows: number; max_products_allowed: number; current_uploaded_count: number; remaining_slots: number; import_mode?: VendorImportMode };
export type VendorOrderItem = { id: string; order_id: string; order_number: string; invoice_number?: string | null; product_title: string; price: number; quantity: number; vendor_status: string; return_status: string; returnable: boolean; return_window_days: number; payout_status: string; payout_amount: number; gross_amount: number; commission_percent: number; commission_amount: number; order_status: string; delivery_status: string; created_at: string; delivered_at?: string | null; payout_released_at?: string | null; settlement_stage?: string };
export type VendorOrderSummary = { total_payout_amount: number; hold_amount: number; ready_amount: number; received_amount: number; blocked_amount: number; order_count: number };
export type VendorSettlement = {
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
  bank_snapshot?: {
    account_holder_name?: string | null;
    account_number?: string | null;
    ifsc_code?: string | null;
    bank_name?: string | null;
  };
  invoice?: {
    invoice_number?: string | null;
    generated_at?: string | null;
  };
  items?: VendorOrderItem[];
};
export type VendorDashboardStats = { total_uploaded_products: number; active_products: number; out_of_stock_products: number; featured_products: number; bestseller_products: number; pending_approval_products: number; rejected_products: number; approved_products: number; max_products_allowed: number; remaining_slots: number };

export const vendorExcelColumns = ["title*", "slug*", "price*", "sale_price", "sku", "stock_quantity", "category", "subcategory", "short_description", "full_description", "tags", "weight", "dimensions", "status", "returnable", "return_window_days", "sort_order", "featured_image", "additional_images"] as const;
export const VENDOR_IMPORT_MAX_ROWS = 1000;

export const vendorTemplateSampleRows: string[][] = [
  ["Rose Quartz Gua Sha", "rose-quartz-gua-sha", "1299", "999", "PP-VEN-001", "24", "Shop By Concern", "Ageing Skin", "Cooling facial sculpting tool", "Premium rose quartz gua sha for sculpting and de-puffing.", "gua sha,beauty,self care", "120g", "9x6x1 cm", "active", "TRUE", "7", "1", "https://example.com/gua-sha.jpg", "https://example.com/gua-sha-2.jpg,https://example.com/gua-sha-3.jpg"],
  ["Sleep Ritual Mist", "sleep-ritual-mist", "899", "749", "PP-VEN-002", "12", "Women's Health", "Hormonal Care", "Lavender sleep mist", "Botanical bedtime mist crafted for relaxation and calm.", "sleep,lavender,wellness", "200ml", "18x4x4 cm", "active", "FALSE", "0", "2", "https://example.com/sleep-mist.jpg", ""],
];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_REGEX = /^[6-9][0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
export function parseBooleanLike(value: unknown) { if (typeof value === "boolean") return value; return ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase()); }
export function statusBadgeClass(status: string) {
  if (status === "verified" || status === "approved") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "rejected" || status === "banned") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "pending" || status === "pending_approval") return "bg-amber-100 text-amber-700 border-amber-200";
  if (["active", "accepted", "delivered", "ready", "released"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["paid", "initiated", "processing"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["settled", "ready_for_release"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["in_hold_window", "blocked"].includes(status)) return "bg-amber-100 text-amber-700 border-amber-200";
  if (["draft", "new", "pickup_assigned", "picked_up", "return_requested", "return_in_transit", "on_hold"].includes(status)) return "bg-amber-100 text-amber-700 border-amber-200";
  if (["inactive", "refunded", "failed", "returned", "reversed"].includes(status)) return "bg-slate-100 text-slate-700 border-slate-200";
  if (status === "uploaded") return "bg-primary/10 text-primary border-primary/20";
  if (status === "processed") return "bg-violet-100 text-violet-700 border-violet-200";
  if (status === "completed") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "partial" || status === "limit_reached") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-muted text-muted-foreground border-border";
}
export function formatDate(value?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
export function formatCurrency(value?: number | null) { if (value == null) return "—"; return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value); }

export async function downloadVendorTemplate() {
  await downloadWorkbook("pinkpaisa_vendor_upload_template.xlsx", [
    {
      name: "Products",
      rows: [vendorExcelColumns as unknown as string[], ...vendorTemplateSampleRows],
      widths: [...vendorExcelColumns].map((column) => Math.max(column.length + 2, 18)),
    },
    {
      name: "Guide",
      rows: [
        ["Instructions"],
        ["Do not rename columns or change their order."],
        ["Every uploaded product is saved as Pending Approval after you confirm import."],
        ["Featured and Bestseller are set only by Admin, not by vendor uploads."],
        ["Returnable and return window days are vendor-controlled fields."],
        ["Use comma-separated values for tags and additional_images."],
        ["Category and subcategory must match the admin wellness taxonomy."],
      ],
      widths: [90],
    },
  ]);
}

export function downloadVendorErrorsCsv(errors: VendorUploadError[], fileName = "vendor-upload-errors.csv") {
  const header = ["row", "title", "sku", "errors"];
  const lines = errors.map((entry) => [
    entry.row,
    entry.title || "",
    entry.sku || "",
    entry.errors.join(" | "),
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function parseVendorUploadFile(file: File) {
  const rows = await readFirstWorksheetRows(file);
  if (!rows.length) return { rows: [], errors: [], headerError: "The uploaded file is empty." };
  const header = rows[0].map((cell) => String(cell).trim());
  const expected = [...vendorExcelColumns];
  const headerMatches = header.length === expected.length && header.every((value, index) => value === expected[index]);
  if (!headerMatches) return { rows: [], errors: [], headerError: "File structure does not match the official template. Please use the exact column order from the template." };
  const mappedRows = rows.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== "")).map((row) => {
    const record: Record<string, string | number | boolean> = {};
    expected.forEach((column, index) => { record[column.replace(/\*$/, "")] = row[index] ?? ""; });
    return record;
  });
  if (mappedRows.length > VENDOR_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [], headerError: `Vendor imports are limited to ${VENDOR_IMPORT_MAX_ROWS} rows.` };
  }
  const errors: Array<{ row: number; errors: string[] }> = [];
  mappedRows.forEach((row, index) => {
    const rowErrors: string[] = [];
    if (!String(row.title ?? "").trim()) rowErrors.push("Title is required");
    if (!String(row.slug ?? "").trim()) row.slug = slugify(String(row.title ?? ""));
    if (row.price === "" || Number.isNaN(Number(row.price))) rowErrors.push("Price must be a valid number");
    if (row.sale_price !== "" && Number.isNaN(Number(row.sale_price))) rowErrors.push("Sale price must be a valid number");
    if (row.stock_quantity !== "" && Number.isNaN(Number(row.stock_quantity))) rowErrors.push("Stock quantity must be a valid number");
    if (row.return_window_days !== "" && Number.isNaN(Number(row.return_window_days))) rowErrors.push("Return window days must be a valid number");
    if (row.sort_order !== "" && Number.isNaN(Number(row.sort_order))) rowErrors.push("Sort order must be a valid number");
    if (!String(row.category ?? "").trim()) rowErrors.push("Category is required");
    if (!String(row.subcategory ?? "").trim()) rowErrors.push("Subcategory is required");
    row.returnable = row.returnable === "" || row.returnable == null ? true : parseBooleanLike(row.returnable);
    row.return_window_days = row.return_window_days === "" || row.return_window_days == null ? 7 : Number(row.return_window_days);
    row.status = String(row.status || "active").toLowerCase() || "active";
    if (rowErrors.length) errors.push({ row: index + 2, errors: rowErrors });
  });
  return { rows: mappedRows, errors, headerError: null };
}

export function validateVendorSignup(payload: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  if (!String(payload.owner_name ?? "").trim()) errors.owner_name = "Owner name is required";
  if (!String(payload.mobile ?? "").trim()) errors.mobile = "Mobile is required";
  if (payload.mobile && !MOBILE_REGEX.test(String(payload.mobile).trim())) errors.mobile = "Enter a valid 10 digit mobile number";
  if (!String(payload.email ?? "").trim()) errors.email = "Email is required";
  if (payload.email && !EMAIL_REGEX.test(String(payload.email).trim())) errors.email = "Enter a valid email address";
  if (!String(payload.password ?? "").trim()) errors.password = "Password is required";
  if (String(payload.password ?? "").length < 10) errors.password = "Password must be at least 10 characters";
  if (payload.password && (!/[A-Za-z]/.test(String(payload.password)) || !/[0-9]/.test(String(payload.password)))) {
    errors.password = "Password must include at least one letter and one number";
  }
  if (payload.password !== payload.confirm_password) errors.confirm_password = "Passwords do not match";
  if (!String(payload.business_name ?? "").trim()) errors.business_name = "Business name is required";
  if (!String(payload.shop_name ?? "").trim()) errors.shop_name = "Shop name is required";
  if (!String(payload.business_type ?? "").trim()) errors.business_type = "Business type is required";
  if (!String(payload.gstin ?? "").trim()) errors.gstin = "GSTIN is required";
  if (payload.gstin && !GSTIN_REGEX.test(String(payload.gstin).trim().toUpperCase())) errors.gstin = "Enter a valid GSTIN";
  if (!String(payload.pan ?? "").trim()) errors.pan = "PAN is required";
  if (payload.pan && !PAN_REGEX.test(String(payload.pan).trim().toUpperCase())) errors.pan = "Enter a valid PAN";
  if (!String(payload.address ?? "").trim()) errors.address = "Address is required";
  if (!String(payload.city ?? "").trim()) errors.city = "City is required";
  if (!String(payload.state ?? "").trim()) errors.state = "State is required";
  if (!String(payload.pincode ?? "").trim()) errors.pincode = "Pincode is required";
  if (payload.pincode && String(payload.pincode).trim().length !== 6) errors.pincode = "Enter a valid 6 digit pincode";
  if (!String(payload.account_holder_name ?? "").trim()) errors.account_holder_name = "Account holder name is required";
  if (!String(payload.account_number ?? "").trim()) errors.account_number = "Account number is required";
  if (!String(payload.ifsc_code ?? "").trim()) errors.ifsc_code = "IFSC code is required";
  if (payload.ifsc_code && !IFSC_REGEX.test(String(payload.ifsc_code).trim().toUpperCase())) errors.ifsc_code = "Enter a valid IFSC code";
  if (!String(payload.bank_name ?? "").trim()) errors.bank_name = "Bank name is required";
  if (!payload.agree_terms) errors.agree_terms = "Please accept the terms";
  if (!payload.confirm_gst) errors.confirm_gst = "Please confirm your GST details";
  return errors;
}
