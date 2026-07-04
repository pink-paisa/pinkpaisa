import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Vendor, VendorProduct, formatCurrency, formatDate } from "@/lib/vendor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, Eye, CheckCircle2, XCircle, Store, Package2 } from "lucide-react";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { toast } from "sonner";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import TextActionDialog from "@/components/ui/text-action-dialog";

type VendorProductAdminResponse = {
  items: VendorProduct[];
  counts: { pending_approval: number; approved: number; rejected: number };
  vendors: Array<{ id: string; owner_name: string; business_name: string; shop_name: string; email: string; max_products_allowed: number }>;
  pagination: { page: number; total_pages: number; total: number; limit: number };
};

const AdminVendors = () => {
  const [activeTab, setActiveTab] = useState<"accounts" | "products">("accounts");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [openVendor, setOpenVendor] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [maxProductsAllowed, setMaxProductsAllowed] = useState("25");
  const [selectedAssignedCategoryIds, setSelectedAssignedCategoryIds] = useState<string[]>([]);
  const [kycVerified, setKycVerified] = useState(false);
  const [bankVerified, setBankVerified] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState({ pending: 0, verified: 0, rejected: 0 });
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productDebouncedSearch, setProductDebouncedSearch] = useState("");
  const [productStatus, setProductStatus] = useState("all");
  const [productVendorFilter, setProductVendorFilter] = useState("all");
  const [productPage, setProductPage] = useState(1);
  const [productLoading, setProductLoading] = useState(true);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<VendorProduct | null>(null);
  const [productReviewForm, setProductReviewForm] = useState({ category_id: "", subcategory_id: "", featured: false, bestseller: false });
  const [productRejectionTarget, setProductRejectionTarget] = useState<{ id: string; title: string } | null>(null);
  const [productRejectionReason, setProductRejectionReason] = useState("");
  const { data: taxonomy } = useProductTaxonomy({ includeInactive: true, includeUncategorized: true });
  const [productData, setProductData] = useState<VendorProductAdminResponse>({
    items: [],
    counts: { pending_approval: 0, approved: 0, rejected: 0 },
    vendors: [],
    pagination: { page: 1, total_pages: 1, total: 0, limit: 10 },
  });

  const loadVendors = async () => {
    try {
      setLoading(true);
      const response = await apiFetch<{ items: Vendor[]; counts: typeof counts; pagination: typeof pagination }>(`/vendors?search=${encodeURIComponent(debouncedSearch)}&status=${status}&page=${page}&limit=10`);
      setVendors(response.items || []);
      setCounts(response.counts || { pending: 0, verified: 0, rejected: 0 });
      setPagination(response.pagination || { page: 1, total_pages: 1, total: 0, limit: 10 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendors");
    } finally {
      setLoading(false);
    }
  };

  const loadProductQueue = async () => {
    try {
      setProductLoading(true);
      const response = await apiFetch<VendorProductAdminResponse>(`/vendor-products/admin?search=${encodeURIComponent(productDebouncedSearch)}&approval_status=${productStatus}&vendor_id=${productVendorFilter}&page=${productPage}&limit=10`);
      setProductData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendor products");
    } finally {
      setProductLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const id = setTimeout(() => {
      setProductDebouncedSearch(productSearch);
      setProductPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [productSearch]);

  useEffect(() => {
    loadVendors();
  }, [page, status, debouncedSearch]);

  useEffect(() => {
    loadProductQueue();
  }, [productPage, productStatus, productVendorFilter, productDebouncedSearch]);

  const openDetails = async (vendorId: string) => {
    try {
      const response = await apiFetch<Vendor>(`/vendors/${vendorId}`);
      setSelectedVendor(response);
      setRemarks(response.admin_notes || "");
      setMaxProductsAllowed(String(response.max_products_allowed ?? 25));
      setSelectedAssignedCategoryIds((response.assigned_categories || []).map((category) => category.id));
      setKycVerified(Boolean((response as any).kyc_verified));
      setBankVerified(Boolean((response as any).bank_verified));
      setOpenVendor(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendor details");
    }
  };

  const updateVendor = async (vendorId: string, nextStatus?: "pending" | "verified" | "rejected") => {
    try {
      setUpdating(true);
      const includeDetailFields = selectedVendor?.id === vendorId;
      await apiFetch(`/vendors/${vendorId}/status`, {
        method: "PUT",
        body: JSON.stringify({
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(includeDetailFields ? { remarks, max_products_allowed: Number(maxProductsAllowed), assigned_category_ids: selectedAssignedCategoryIds, kyc_verified: kycVerified, bank_verified: bankVerified } : {}),
        }),
      });
      toast.success(nextStatus ? `Vendor marked as ${nextStatus}` : "Vendor settings updated");
      setOpenVendor(false);
      await Promise.all([loadVendors(), loadProductQueue()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update vendor");
    } finally {
      setUpdating(false);
    }
  };

  const openProductDetails = async (productId: string) => {
    try {
      const response = await apiFetch<VendorProduct>(`/vendor-products/admin/${productId}`);
      setSelectedProduct(response);
      setProductReviewForm({ category_id: response.category_id || "", subcategory_id: response.subcategory_id || "", featured: Boolean(response.featured), bestseller: Boolean(response.bestseller) });
      setProductDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load product details");
    }
  };

  const reviewCategory = useMemo(() => (taxonomy ?? []).find((category) => category.id === productReviewForm.category_id), [taxonomy, productReviewForm.category_id]);
  const reviewSubcategories = reviewCategory?.subcategories ?? [];
  const assignableCategories = useMemo(() => (taxonomy ?? []).filter((category) => category.slug !== "uncategorized"), [taxonomy]);


  const updateProductApproval = async (
    productId: string,
    approval_status: "pending_approval" | "approved" | "rejected",
    rejectionReason: string | null = null,
  ) => {
    try {
      await apiFetch(`/vendor-products/admin/${productId}/approval`, {
        method: "PUT",
        body: JSON.stringify({
          approval_status,
          category_id: productReviewForm.category_id || null,
          subcategory_id: productReviewForm.subcategory_id || null,
          featured: productReviewForm.featured,
          bestseller: productReviewForm.bestseller,
          rejection_reason: approval_status === "rejected" ? rejectionReason?.trim() || null : null,
        }),
      });
      toast.success(approval_status === "approved" ? "Product approved and published" : approval_status === "rejected" ? "Product rejected" : "Product moved to pending review");
      setProductDialogOpen(false);
      await Promise.all([loadProductQueue(), loadVendors()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update product");
    }
  };

  const openProductRejection = (productId: string, title: string) => {
    setProductRejectionTarget({ id: productId, title });
    setProductRejectionReason("");
  };

  const submitProductRejection = async () => {
    if (!productRejectionTarget || !productRejectionReason.trim()) return;
    await updateProductApproval(productRejectionTarget.id, "rejected", productRejectionReason.trim());
    setProductRejectionTarget(null);
    setProductRejectionReason("");
  };

  const vendorCountCards = useMemo(() => ([
    { label: "Pending", value: counts.pending, color: "text-amber-600" },
    { label: "Verified", value: counts.verified, color: "text-emerald-600" },
    { label: "Rejected", value: counts.rejected, color: "text-rose-600" },
  ]), [counts]);

  const productCountCards = useMemo(() => ([
    { label: "Pending Approval", value: productData.counts.pending_approval, color: "text-amber-600" },
    { label: "Approved", value: productData.counts.approved, color: "text-emerald-600" },
    { label: "Rejected", value: productData.counts.rejected, color: "text-rose-600" },
  ]), [productData.counts]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-serif text-2xl">Vendor onboarding and approvals</h2>
        <p className="text-sm text-muted-foreground">Manage vendor verification, upload limits, and admin approval for vendor-uploaded products.</p>
      </div>

      <div className="inline-flex rounded-2xl border border-border bg-card p-1">
        <button className={`rounded-xl px-4 py-2 text-sm font-medium ${activeTab === "accounts" ? "bg-primary text-primary-foreground" : "text-foreground"}`} onClick={() => setActiveTab("accounts")}>Vendor Accounts</button>
        <button className={`rounded-xl px-4 py-2 text-sm font-medium ${activeTab === "products" ? "bg-primary text-primary-foreground" : "text-foreground"}`} onClick={() => setActiveTab("products")}>Vendor Products</button>
      </div>

      {activeTab === "accounts" && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {vendorCountCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p><p className={`mt-2 text-3xl font-semibold ${card.color}`}>{card.value}</p></div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-[1fr,200px]">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-11" placeholder="Search vendor name, email, GSTIN, mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-4">Vendor Name</th>
                    <th className="px-4 py-4">Business Name</th>
                    <th className="px-4 py-4">Email</th>
                    <th className="px-4 py-4">Mobile</th>
                    <th className="px-4 py-4">GSTIN</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4">Used / Allowed</th>
                    <th className="px-4 py-4">Created Date</th>
                    <th className="px-4 py-4">Verified Date</th>
                    <th className="px-4 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-14 text-center text-muted-foreground">Loading vendors...</td></tr>
                  ) : vendors.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-14 text-center text-muted-foreground">No vendors found.</td></tr>
                  ) : vendors.map((vendor) => (
                    <tr key={vendor.id} className="border-t border-border/70 align-top">
                      <td className="px-4 py-4 font-medium">{vendor.owner_name}</td>
                      <td className="px-4 py-4">{vendor.business_name}</td>
                      <td className="px-4 py-4">{vendor.email}</td>
                      <td className="px-4 py-4">{vendor.mobile}</td>
                      <td className="px-4 py-4">{vendor.gstin}</td>
                      <td className="px-4 py-4"><VendorStatusBadge status={vendor.status} /></td>
                      <td className="px-4 py-4">{vendor.current_uploaded_count} / {vendor.max_products_allowed}</td>
                      <td className="px-4 py-4">{formatDate(vendor.created_at)}</td>
                      <td className="px-4 py-4">{formatDate(vendor.verified_at)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openDetails(vendor.id)} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground" title="View"><Eye className="h-4 w-4" /></button>
                          <button onClick={() => updateVendor(vendor.id, "verified")} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-emerald-50 hover:text-emerald-700" title="Verify"><CheckCircle2 className="h-4 w-4" /></button>
                          <button onClick={() => updateVendor(vendor.id, "rejected")} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-rose-50 hover:text-rose-700" title="Reject"><XCircle className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="text-muted-foreground">Showing page {pagination.page} of {pagination.total_pages}. Total vendors: {pagination.total}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-xl" disabled={pagination.page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
              <Button variant="outline" className="rounded-xl" disabled={pagination.page >= pagination.total_pages} onClick={() => setPage((prev) => Math.min(pagination.total_pages, prev + 1))}>Next</Button>
            </div>
          </div>
        </>
      )}

      {activeTab === "products" && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {productCountCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p><p className={`mt-2 text-3xl font-semibold ${card.color}`}>{card.value}</p></div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-[1fr,220px,220px]">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-11" placeholder="Search product title, SKU, category" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
              </div>
              <select value={productStatus} onChange={(e) => { setProductStatus(e.target.value); setProductPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="all">All statuses</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select value={productVendorFilter} onChange={(e) => { setProductVendorFilter(e.target.value); setProductPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="all">All vendors</option>
                {productData.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.shop_name}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-4">Product</th>
                    <th className="px-4 py-4">Vendor</th>
                    <th className="px-4 py-4">Price</th>
                    <th className="px-4 py-4">Upload Status</th>
                    <th className="px-4 py-4">Approval Status</th>
                    <th className="px-4 py-4">Created</th>
                    <th className="px-4 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {productLoading ? (
                    <tr><td colSpan={7} className="px-4 py-14 text-center text-muted-foreground">Loading vendor products...</td></tr>
                  ) : productData.items.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-14 text-center text-muted-foreground">No vendor products found.</td></tr>
                  ) : productData.items.map((product) => (
                    <tr key={product.id} className="border-t border-border/70 align-top">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 overflow-hidden rounded-2xl bg-accent">
                            {product.featured_image ? <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover" /> : <div className="h-full w-full" />}
                          </div>
                          <div>
                            <p className="font-medium">{product.title}</p>
                            <p className="text-xs text-muted-foreground">{product.sku || "No SKU"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">{product.vendor?.shop_name || product.vendor?.business_name || "—"}</td>
                      <td className="px-4 py-4">{formatCurrency(product.price)}</td>
                      <td className="px-4 py-4"><VendorStatusBadge status={product.upload_status} /></td>
                      <td className="px-4 py-4"><VendorStatusBadge status={product.approval_status} /></td>
                      <td className="px-4 py-4">{formatDate(product.created_at)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openProductDetails(product.id)} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground" title="View"><Eye className="h-4 w-4" /></button>
                          <button onClick={() => updateProductApproval(product.id, "approved")} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-emerald-50 hover:text-emerald-700" title="Approve"><CheckCircle2 className="h-4 w-4" /></button>
                          <button onClick={() => openProductRejection(product.id, product.title)} className="rounded-xl border border-border p-2 text-muted-foreground transition-all hover:bg-rose-50 hover:text-rose-700" title="Reject"><XCircle className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="text-muted-foreground">Showing page {productData.pagination.page} of {productData.pagination.total_pages}. Total products: {productData.pagination.total}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-xl" disabled={productData.pagination.page <= 1} onClick={() => setProductPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
              <Button variant="outline" className="rounded-xl" disabled={productData.pagination.page >= productData.pagination.total_pages} onClick={() => setProductPage((prev) => Math.min(productData.pagination.total_pages, prev + 1))}>Next</Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={openVendor} onOpenChange={setOpenVendor}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-hidden rounded-3xl p-0">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6 font-serif text-2xl">Vendor details</DialogTitle>
          </DialogHeader>
          {selectedVendor && (
            <div className="max-h-[calc(100vh-7rem)] space-y-6 overflow-y-auto px-6 pb-6 pr-4">
              <div className="rounded-3xl bg-muted/40 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Store className="h-5 w-5" /></div>
                    <div>
                      <h3 className="font-serif text-2xl">{selectedVendor.shop_name}</h3>
                      <p className="text-sm text-muted-foreground">{selectedVendor.business_name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedVendor.email} · {selectedVendor.mobile}</p>
                    </div>
                  </div>
                  <VendorStatusBadge status={selectedVendor.status} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">GSTIN</p><p className="mt-2 font-medium">{selectedVendor.gstin}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Business Type</p><p className="mt-2 font-medium">{selectedVendor.business_type}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">City / State</p><p className="mt-2 font-medium">{selectedVendor.city}, {selectedVendor.state}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Created</p><p className="mt-2 font-medium">{formatDate(selectedVendor.created_at)}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Uploaded / Allowed</p><p className="mt-2 font-medium">{selectedVendor.current_uploaded_count} / {selectedVendor.max_products_allowed}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pending Products</p><p className="mt-2 font-medium">{selectedVendor.pending_products_count ?? selectedVendor.meta?.pending_products_count ?? 0}</p></div>
                <div className="md:col-span-2 rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Address</p><p className="mt-2 font-medium">{selectedVendor.address}, {selectedVendor.pincode}</p></div>
              </div>

              <div>
                <label className="mb-3 block text-sm font-medium">Assigned Categories</label>
                <div className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap gap-2">
                    {assignableCategories.map((category) => {
                      const isSelected = selectedAssignedCategoryIds.includes(category.id);
                      return (
                        <button
                          type="button"
                          key={category.id}
                          onClick={() => setSelectedAssignedCategoryIds((prev) => prev.includes(category.id) ? prev.filter((id) => id !== category.id) : [...prev, category.id])}
                          className={`rounded-full border px-3 py-2 text-sm transition-all ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent"}`}
                        >
                          {category.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Leave all unselected to allow this vendor across active wellness categories.</p>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Max Products Allowed</label>
                <Input type="number" min="0" value={maxProductsAllowed} onChange={(e) => setMaxProductsAllowed(e.target.value)} className="h-12 rounded-2xl" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Bank Account Holder</p><p className="mt-2 font-medium">{(selectedVendor as any).bank_details?.account_holder_name || "—"}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Bank Name</p><p className="mt-2 font-medium">{(selectedVendor as any).bank_details?.bank_name || "—"}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Account Number</p><p className="mt-2 font-medium">{(selectedVendor as any).bank_details?.account_number || "—"}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">IFSC</p><p className="mt-2 font-medium">{(selectedVendor as any).bank_details?.ifsc_code || "—"}</p></div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-4 text-sm"><input type="checkbox" checked={kycVerified} onChange={(e) => setKycVerified(e.target.checked)} /> KYC verified</label>
                <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-4 text-sm"><input type="checkbox" checked={bankVerified} onChange={(e) => setBankVerified(e.target.checked)} /> Bank details verified</label>
              </div>

              <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pink Paisa commission</p><p className="mt-2 text-lg font-semibold">Fixed 20%</p><p className="mt-1 text-sm text-muted-foreground">Vendor payout is released only to the bank account submitted by the vendor after delivery and return window closure.</p></div>

              <div>
                <label className="mb-2 block text-sm font-medium">Admin remarks</label>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[120px] rounded-2xl" placeholder="Add notes for verification or rejection" />
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" className="rounded-2xl" onClick={() => updateVendor(selectedVendor.id, "pending")} disabled={updating}>Mark pending</Button>
                <Button variant="outline" className="rounded-2xl" onClick={() => updateVendor(selectedVendor.id)} disabled={updating}>Save vendor settings</Button>
                <Button variant="outline" className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => updateVendor(selectedVendor.id, "rejected")} disabled={updating}>Reject vendor</Button>
                <Button className="rounded-2xl" onClick={() => updateVendor(selectedVendor.id, "verified")} disabled={updating}>Verify vendor</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-hidden rounded-3xl p-0">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6 font-serif text-2xl">Vendor product review</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="max-h-[calc(100vh-7rem)] space-y-6 overflow-y-auto px-6 pb-6 pr-4">
              <div className="grid gap-6 md:grid-cols-[220px,1fr]">
                <div className="overflow-hidden rounded-3xl bg-accent">
                  {selectedProduct.featured_image ? <img src={selectedProduct.featured_image} alt={selectedProduct.title} className="h-full w-full object-cover" /> : <div className="flex aspect-square items-center justify-center text-muted-foreground"><Package2 className="h-8 w-8" /></div>}
                </div>
                <div>
                  <div className="flex flex-wrap gap-2">
                    <VendorStatusBadge status={selectedProduct.upload_status} />
                    <VendorStatusBadge status={selectedProduct.approval_status} />
                  </div>
                  <h3 className="mt-3 font-serif text-3xl">{selectedProduct.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{selectedProduct.vendor?.shop_name || selectedProduct.vendor?.business_name || "—"} · {selectedProduct.vendor?.email || ""}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Price</p><p className="mt-2 font-medium">{formatCurrency(selectedProduct.price)}</p></div>
                    <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Stock</p><p className="mt-2 font-medium">{selectedProduct.stock_quantity}</p></div>
                    <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Created</p><p className="mt-2 font-medium">{formatDate(selectedProduct.created_at)}</p></div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">SKU</p><p className="mt-2 font-medium">{selectedProduct.sku || "—"}</p></div>
                <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Vendor Selection</p><p className="mt-2 font-medium">{selectedProduct.category || "—"}{selectedProduct.subcategory ? ` / ${selectedProduct.subcategory}` : ""}</p></div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Override Category</p>
                  <select value={productReviewForm.category_id} onChange={(e) => setProductReviewForm((prev) => ({ ...prev, category_id: e.target.value, subcategory_id: "" }))} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
                    <option value="">Select category</option>
                    {(taxonomy ?? []).filter((category) => category.slug !== "uncategorized").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Override Subcategory</p>
                  <select value={productReviewForm.subcategory_id} onChange={(e) => setProductReviewForm((prev) => ({ ...prev, subcategory_id: e.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" disabled={!productReviewForm.category_id}>
                    <option value="">Select subcategory</option>
                    {reviewSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-4 text-sm"><input type="checkbox" checked={productReviewForm.featured} onChange={(e) => setProductReviewForm((prev) => ({ ...prev, featured: e.target.checked }))} /> Featured product</label>
                  <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-4 text-sm"><input type="checkbox" checked={productReviewForm.bestseller} onChange={(e) => setProductReviewForm((prev) => ({ ...prev, bestseller: e.target.checked }))} /> Bestseller product</label>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Short Description</p><p className="mt-2 font-medium">{selectedProduct.short_description || "—"}</p></div>
                <div className="md:col-span-2 rounded-2xl border border-border p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Full Description</p><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{selectedProduct.full_description || "—"}</p></div>
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" className="rounded-2xl" onClick={() => updateProductApproval(selectedProduct.id, "pending_approval")}>Move to pending</Button>
                <Button variant="outline" className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => openProductRejection(selectedProduct.id, selectedProduct.title)}>Reject product</Button>
                <Button className="rounded-2xl" onClick={() => updateProductApproval(selectedProduct.id, "approved")}>Approve and publish</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <TextActionDialog
        open={Boolean(productRejectionTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setProductRejectionTarget(null);
            setProductRejectionReason("");
          }
        }}
        title="Reject vendor product"
        description={productRejectionTarget ? `Share the reason for rejecting "${productRejectionTarget.title}".` : undefined}
        label="Rejection reason"
        value={productRejectionReason}
        onValueChange={setProductRejectionReason}
        onConfirm={submitProductRejection}
        confirmLabel="Reject product"
        placeholder="Tell the vendor what needs to change before this product can go live."
        multiline
        disabled={!productRejectionReason.trim()}
      />
    </div>
  );
};

export default AdminVendors;
