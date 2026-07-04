import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Eye, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatCurrency, formatDate, VendorProduct } from "@/lib/vendor";
import { vendorFetch } from "@/lib/vendor-api";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import VendorMetricCard from "@/components/vendor/VendorMetricCard";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";

const DEFAULT_VENDOR_UPLOAD_LIMIT = 25;

type ProductListResponse = {
  items: VendorProduct[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
  usage: { current_uploaded_count: number; max_products_allowed: number; remaining_slots: number };
};

const VendorProducts = () => {
  const router = useRouter();
  const { vendor, refreshVendor } = useVendorAuth();
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, total_pages: 1 });
  const [productToDelete, setProductToDelete] = useState<VendorProduct | null>(null);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({ page: String(page), limit: "10", approval_status: approvalStatus, search }).toString();
      const response = await vendorFetch<ProductListResponse>(`/vendor-products/mine?${query}`);
      setProducts(response.items || []);
      setPagination(response.pagination);
      await refreshVendor();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load vendor products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadProducts();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [page, approvalStatus, search]);

  const handleDelete = async () => {
    if (!productToDelete) return;
    try {
      await vendorFetch(`/vendor-products/${productToDelete.id}`, { method: "DELETE" });
      toast.success("Product deleted");
      setProductToDelete(null);
      await loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete product");
    }
  };

  const metrics = useMemo(() => ([
    { label: "Uploaded", value: vendor?.current_uploaded_count ?? 0, helper: `of ${vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT} allowed`, tone: "default" as const },
    { label: "Remaining slots", value: vendor?.remaining_slots ?? 0, helper: "Available for next confirmed import", tone: "default" as const },
    { label: "Pending approval", value: vendor?.pending_products_count ?? 0, helper: "Waiting for admin review", tone: "warning" as const },
    { label: "Approved", value: vendor?.approved_products_count ?? 0, helper: "Visible on public products", tone: "success" as const },
  ]), [vendor]);

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_60%,#fdf4ee_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c09090]">Vendor products</p>
            <h2 className="mt-2 font-serif text-3xl text-[#3a1525]">Catalog control in Organic Soft style</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-[#8a6070]">
              Review uploaded products, track approval progress, and open any item for edits while keeping the portal soft, warm, and pastel-forward.
            </p>
          </div>
          <Button className="rounded-full bg-[linear-gradient(135deg,#c05070,#a03050)] px-5 hover:opacity-95" onClick={() => void router.push("/vendor/products/new")}>
            Add one product
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <VendorMetricCard key={metric.label} label={metric.label} value={metric.value} helper={metric.helper} tone={metric.tone} />
        ))}
      </section>

      <section className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="grid gap-4 lg:grid-cols-[1fr,240px]">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b98c97]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, SKU, or category" className="h-12 rounded-full border-[#efd3db] bg-[#fffaf8] pl-11" />
          </div>
          <select value={approvalStatus} onChange={(e) => { setApprovalStatus(e.target.value); setPage(1); }} className="h-12 rounded-full border border-[#efd3db] bg-[#fffaf8] px-4 text-sm text-[#6a4050] outline-none">
            <option value="all">All approval statuses</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 shadow-[0_20px_46px_rgba(186,131,149,0.08)]">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#fff2f4] text-left text-[11px] uppercase tracking-[0.14em] text-[#b88a98]">
              <tr>
                <th className="px-4 py-4">Product</th>
                <th className="px-4 py-4">SKU</th>
                <th className="px-4 py-4">Category</th>
                <th className="px-4 py-4">Price</th>
                <th className="px-4 py-4">Stock</th>
                <th className="px-4 py-4">Upload Status</th>
                <th className="px-4 py-4">Approval Status</th>
                <th className="px-4 py-4">Created</th>
                <th className="px-4 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-14 text-center text-[#8d6b77]" colSpan={9}>Loading products...</td></tr>
              ) : products.length === 0 ? (
                <tr><td className="px-4 py-14 text-center text-[#8d6b77]" colSpan={9}>No products found.</td></tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="border-t border-[#f5ede5] align-top">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 overflow-hidden rounded-[1rem] bg-[#fff1f3]">
                          {product.featured_image ? <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[#c09090]">No image</div>}
                        </div>
                        <div>
                          <p className="font-medium text-[#4a2030]">{product.title}</p>
                          <p className="text-xs text-[#b98c97]">{product.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[#6a4050]">{product.sku || "-"}</td>
                    <td className="px-4 py-4 text-[#8d6b77]">{product.category || "-"}{product.subcategory ? ` / ${product.subcategory}` : ""}</td>
                    <td className="px-4 py-4 font-medium text-[#4a2030]">{formatCurrency(product.price)}</td>
                    <td className="px-4 py-4 text-[#6a4050]">{product.stock_quantity}</td>
                    <td className="px-4 py-4"><VendorStatusBadge status={product.upload_status} /></td>
                    <td className="px-4 py-4"><VendorStatusBadge status={product.approval_status} /></td>
                    <td className="px-4 py-4 text-[#8d6b77]">{formatDate(product.created_at)}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => void router.push(`/vendor/products/${product.id}`)} className="rounded-full border border-[#efd3db] bg-white p-2 text-[#b98c97] transition-all hover:bg-[#fff4f7] hover:text-[#6a4050]" title="View"><Eye className="h-4 w-4" /></button>
                        <button onClick={() => void router.push(`/vendor/products/${product.id}`)} className="rounded-full border border-[#efd3db] bg-white p-2 text-[#b98c97] transition-all hover:bg-[#fff4f7] hover:text-[#6a4050]" title="Edit"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setProductToDelete(product)} className="rounded-full border border-[#f3d7dd] bg-white p-2 text-[#c09090] transition-all hover:bg-rose-50 hover:text-rose-700" title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-5 shadow-[0_20px_46px_rgba(186,131,149,0.08)] sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#8d6b77]">Showing page {pagination.page} of {pagination.total_pages}. Total products: {pagination.total}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" disabled={pagination.page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
          <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-white text-[#c05070] hover:bg-[#fff4f7]" disabled={pagination.page >= pagination.total_pages} onClick={() => setPage((prev) => Math.min(pagination.total_pages, prev + 1))}>Next</Button>
        </div>
      </section>
      <ConfirmActionDialog
        open={Boolean(productToDelete)}
        onOpenChange={(open) => { if (!open) setProductToDelete(null); }}
        title="Delete this vendor product?"
        description={productToDelete ? `This will permanently remove "${productToDelete.title}" from your vendor catalog.` : undefined}
        confirmLabel="Delete product"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default VendorProducts;
