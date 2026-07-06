/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronDown, ChevronUp, Package, RefreshCw, Truck, User, MapPin, Mail, Phone, Store, CreditCard, Receipt, Calendar, Clock, FileText, Percent, Hash, Warehouse, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { StatCard, StatusBadge, LoadingSpinner, EmptyState, Field, formatPrice, ORDER_STATUSES, DELIVERY_STATUSES } from "./AdminShared";
import { formatDateIN } from "@/lib/date";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/* ── Types ── */
type AdminWarehouse = { warehouse_name?: string; warehouse_address?: string | null; warehouse_city?: string | null; warehouse_state?: string | null; warehouse_pincode?: string | null; warehouse_phone?: string | null; warehouse_email?: string | null };
type VendorInfo = { id: string; shop_name?: string; business_name?: string; owner_name?: string; city?: string; state?: string; mobile?: string; email?: string; commission_percent?: number; gstin?: string; address?: string | null; pincode?: string | null };
type OrderItem = { id?: string; product_title: string; price: number; quantity: number; vendor_status?: string; return_status?: string; vendor_id?: string | null; vendor?: VendorInfo | null; source_type?: "admin" | "vendor"; admin_warehouse?: AdminWarehouse | null; payout_amount?: number; commission_percent?: number; commission_amount?: number; payout_status?: string; returnable?: boolean };
type OrderRow = { id: string; order_number?: string; guest_name: string; guest_email: string; guest_phone: string; shipping_address: string; shipping_city: string; shipping_state: string; shipping_pincode: string; subtotal: number; shipping_cost: number; total: number; status: string; delivery_status: string; payment_status: string; payment_method: string; createdAt?: string; created_at?: string; delivery_partner_id?: string | null; delivery_partner?: { id: string; name: string; company_name?: string | null; phone?: string | null } | null; items?: OrderItem[]; user?: { full_name?: string; email?: string; phone?: string } | null; pickup_address?: string | null; pickup_city?: string | null; pickup_state?: string | null; pickup_pincode?: string | null; vendor_payout_amount?: number; pinkpaisa_commission_amount?: number; vendor_payout_status?: string; invoice_number?: string | null; delivered_at?: string | null; phonepe_transaction_id?: string | null; wallet_used?: number; admin_warehouse?: AdminWarehouse | null };
type PaginationMeta = { page: number; limit: number; total: number; total_pages: number };
type OrderListSummary = { total_orders: number; revenue: number; in_transit: number; delivered: number };
type OrderListResponse = { items: OrderRow[]; pagination: PaginationMeta; summary: OrderListSummary };

const ADMIN_ORDER_PAGE_SIZE = 25;

/* ── Shipment group type ── */
type ShipmentGroup = {
  key: string;
  source_type: "admin" | "vendor";
  label: string;
  vendor?: VendorInfo | null;
  pickup_address: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_pincode: string | null;
  items: OrderItem[];
  currentStatus: string;
};

/* ── Shipment lifecycle ── */
const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  new: ["picked_up", "rejected"],
  accepted: ["picked_up", "rejected"],
  pickup_assigned: ["picked_up", "rejected"],
  picked_up: ["shipped"],
  shipped: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: ["return_requested"],
  return_requested: ["out_for_return_pickup"],
  out_for_return_pickup: ["return_pickup_done"],
  return_pickup_done: ["in_transit_return"],
  in_transit_return: ["returned"],
  returned: [],
  rejected: [],
  refunded: [],
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  accepted: "Accepted",
  pickup_assigned: "Pickup Assigned",
  picked_up: "Picked Up",
  rejected: "Rejected",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  return_requested: "Return Requested",
  out_for_return_pickup: "Out for Return Pickup",
  return_pickup_done: "Return Pickup Done",
  in_transit_return: "In Transit (Return)",
  returned: "Returned",
  refunded: "Refunded",
};

const formatOrderDate = (value?: string | null, options: Intl.DateTimeFormatOptions = {}) =>
  formatDateIN(value, { day: "numeric", month: "short", year: "numeric", ...options }) || "—";

/* ── Section wrapper ── */
const DetailSection = ({ icon: Icon, title, children, className = "" }: { icon: any; title: string; children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-border bg-background/50 p-4 ${className}`}>
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {title}
    </div>
    {children}
  </div>
);

/* ── Group order items by shipment source ── */
function groupItemsByShipment(items: OrderItem[], adminWarehouse?: AdminWarehouse | null): ShipmentGroup[] {
  const vendorGroups = new Map<string, ShipmentGroup>();
  let adminGroup: ShipmentGroup | null = null;

  for (const item of items) {
    if (item.source_type === "vendor" && item.vendor?.id) {
      const vid = item.vendor.id;
      if (!vendorGroups.has(vid)) {
        vendorGroups.set(vid, {
          key: `vendor-${vid}`,
          source_type: "vendor",
          label: item.vendor.shop_name || item.vendor.business_name || "Vendor",
          vendor: item.vendor,
          pickup_address: item.vendor.address || null,
          pickup_city: item.vendor.city || null,
          pickup_state: item.vendor.state || null,
          pickup_pincode: item.vendor.pincode || null,
          items: [],
          currentStatus: item.vendor_status || "new",
        });
      }
      vendorGroups.get(vid)!.items.push(item);
    } else {
      const wh = item.admin_warehouse || adminWarehouse;
      if (!adminGroup) {
        adminGroup = {
          key: "admin",
          source_type: "admin",
          label: wh?.warehouse_name || "PinkPaisa Warehouse",
          vendor: null,
          pickup_address: wh?.warehouse_address || null,
          pickup_city: wh?.warehouse_city || null,
          pickup_state: wh?.warehouse_state || null,
          pickup_pincode: wh?.warehouse_pincode || null,
          items: [],
          currentStatus: item.vendor_status || "new",
        };
      }
      adminGroup.items.push(item);
    }
  }

  // Determine group currentStatus: use the "lowest" status among items in the group
  const statusOrder = ["new", "accepted", "pickup_assigned", "picked_up", "shipped", "out_for_delivery", "delivered", "return_requested", "out_for_return_pickup", "return_pickup_done", "in_transit_return", "returned", "refunded", "rejected"];
  const resolveGroupStatus = (group: ShipmentGroup) => {
    const itemStatuses = group.items.map((i) => i.vendor_status || "new");
    // All items should be at the same status. Use the minimum.
    const minIdx = Math.min(...itemStatuses.map((s) => { const i = statusOrder.indexOf(s); return i >= 0 ? i : 0; }));
    group.currentStatus = statusOrder[minIdx] || "new";
  };

  const groups: ShipmentGroup[] = [];
  vendorGroups.forEach((g) => { resolveGroupStatus(g); groups.push(g); });
  if (adminGroup) { resolveGroupStatus(adminGroup); groups.push(adminGroup); }
  return groups;
}

/* ── Status color helpers ── */
function getStatusColor(status: string) {
  if (["delivered"].includes(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["shipped", "out_for_delivery", "picked_up"].includes(status)) return "bg-blue-50 text-blue-700 border-blue-200";
  if (["rejected", "refunded"].includes(status)) return "bg-red-50 text-red-700 border-red-200";
  if (["return_requested", "out_for_return_pickup", "return_pickup_done", "in_transit_return", "returned"].includes(status)) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
}

/* ── Shipment Card Component ── */
const ShipmentCard = ({ group, index, orderId, onUpdate }: { group: ShipmentGroup; index: number; orderId: string; onUpdate: (updatedOrder: OrderRow) => void }) => {
  const [updating, setUpdating] = useState(false);
  const isAdmin = group.source_type === "admin";
  const pickupFull = [group.pickup_address, group.pickup_city, group.pickup_state, group.pickup_pincode].filter(Boolean).join(", ");
  const groupTotal = group.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const nextStatuses = SHIPMENT_TRANSITIONS[group.currentStatus] || [];
  const hasReturnableItems = group.items.some((i) => i.returnable !== false);

  // Filter out return_requested if no returnable items
  const availableNextStatuses = nextStatuses.filter((s) => {
    if (s === "return_requested" && !hasReturnableItems) return false;
    return true;
  });

  const handleStatusUpdate = async (newStatus: string) => {
    setUpdating(true);
    try {
      const result = await apiFetch<{ order: OrderRow }>(`/orders/${orderId}/shipment-status`, {
        method: "PUT",
        body: JSON.stringify({ shipment_key: group.key, status: newStatus }),
      });
      if (result?.order) onUpdate(result.order);
      toast.success(`${group.label} → ${STATUS_LABELS[newStatus] || newStatus}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update shipment status");
    } finally { setUpdating(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
      {/* Shipment header */}
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${isAdmin ? "bg-primary/5 border-b border-primary/10" : "bg-violet-50/50 border-b border-violet-100"}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${isAdmin ? "bg-primary/10" : "bg-violet-100"}`}>
            {isAdmin ? <Warehouse className="h-3.5 w-3.5 text-primary" /> : <Store className="h-3.5 w-3.5 text-violet-600" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{group.label}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${isAdmin ? "bg-primary/10 text-primary" : "bg-violet-100 text-violet-700"}`}>
                {isAdmin ? "Admin" : "Vendor"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">Shipment {index + 1} · {group.items.length} item{group.items.length > 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${getStatusColor(group.currentStatus)}`}>
            {STATUS_LABELS[group.currentStatus] || group.currentStatus}
          </span>
          <p className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatPrice(groupTotal)}</p>
        </div>
      </div>

      {/* Pickup address */}
      {pickupFull ? (
        <div className="flex items-start gap-2 border-b border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-foreground/70">Pickup: </span>
            {pickupFull}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground/60 italic">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          No pickup address configured
        </div>
      )}

      {/* Items */}
      <div className="divide-y divide-border/50">
        {group.items.map((item, idx) => (
          <div key={idx} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-medium truncate">{item.product_title}</span>
              <span className="text-xs text-muted-foreground">× {item.quantity}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold tabular-nums">{formatPrice(item.price * item.quantity)}</span>
              {item.vendor_status && <StatusBadge status={item.vendor_status} />}
              {item.return_status && item.return_status !== "not_requested" && <StatusBadge status={`return ${item.return_status}`} />}
            </div>
          </div>
        ))}
      </div>

      {/* Status update controls */}
      {availableNextStatuses.length > 0 && (
        <div className="border-t border-border bg-accent/30 px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Update Shipment Status</p>
          <div className="flex flex-wrap gap-2">
            {availableNextStatuses.map((nextStatus) => (
              <Button
                key={nextStatus}
                variant={nextStatus === "rejected" ? "destructive" : "outline"}
                size="sm"
                className="rounded-lg gap-1.5 text-xs h-8"
                disabled={updating}
                onClick={() => handleStatusUpdate(nextStatus)}
              >
                <ArrowRight className="h-3 w-3" />
                {STATUS_LABELS[nextStatus] || nextStatus}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Vendor details footer (for vendor shipments) */}
      {!isAdmin && group.vendor && (
        <div className="border-t border-border bg-accent/20 px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {group.vendor.owner_name && <div className="flex items-center gap-1.5"><User className="h-3 w-3 shrink-0" /> {group.vendor.owner_name}</div>}
          {group.vendor.mobile && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 shrink-0" /> {group.vendor.mobile}</div>}
          {group.vendor.email && <div className="flex items-center gap-1.5 col-span-2 truncate"><Mail className="h-3 w-3 shrink-0" /> {group.vendor.email}</div>}
          {group.vendor.gstin && <div className="flex items-center gap-1.5"><Hash className="h-3 w-3 shrink-0" /> GSTIN: {group.vendor.gstin}</div>}
          {group.vendor.commission_percent != null && <div className="flex items-center gap-1.5"><Percent className="h-3 w-3 shrink-0" /> Commission: {group.vendor.commission_percent}%</div>}
        </div>
      )}
    </div>
  );
};

/* ── Main Component ── */
export const AdminOrders = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: ADMIN_ORDER_PAGE_SIZE, total: 0, total_pages: 1 });
  const [summary, setSummary] = useState<OrderListSummary>({ total_orders: 0, revenue: 0, in_transit: 0, delivered: 0 });
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);

  const fetchDeliveryPartners = useCallback(async () => {
    try {
      const partnerData = await apiFetch<any[]>("/delivery-partners");
      setPartners(partnerData || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load delivery partners");
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ADMIN_ORDER_PAGE_SIZE),
        status: statusFilter,
      });
      const trimmedSearch = debouncedSearch.trim();
      if (trimmedSearch) params.set("search", trimmedSearch);
      const orderData = await apiFetch<OrderListResponse>(`/orders?${params.toString()}`);
      setOrders(orderData.items || []);
      setPagination(orderData.pagination || { page, limit: ADMIN_ORDER_PAGE_SIZE, total: 0, total_pages: 1 });
      setSummary(orderData.summary || { total_orders: 0, revenue: 0, in_transit: 0, delivered: 0 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load orders");
    } finally { setLoading(false); }
  }, [debouncedSearch, page, statusFilter]);

  const refreshOrderScreen = useCallback(async () => {
    await Promise.all([fetchOrders(), fetchDeliveryPartners()]);
  }, [fetchDeliveryPartners, fetchOrders]);

  useEffect(() => { void fetchDeliveryPartners(); }, [fetchDeliveryPartners]);
  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (page > pagination.total_pages) {
      setPage(Math.max(pagination.total_pages, 1));
    }
  }, [page, pagination.total_pages]);

  const assignDelivery = async (id: string, delivery_partner_id: string, delivery_status?: string) => {
    try {
      const response = await apiFetch<any>(`/orders/${id}/assign-delivery`, { method: "PUT", body: JSON.stringify({ delivery_partner_id, delivery_status }) });
      setOrders((current) => current.map((order) => order.id === id ? response.order : order));
      toast.success("Delivery assignment updated");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not assign delivery partner"); }
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

  const handleShipmentUpdate = (orderId: string, updatedOrder: OrderRow) => {
    setOrders((current) => current.map((o) => o.id === orderId ? { ...o, ...updatedOrder } : o));
  };

  const visibleOrders = orders;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-serif text-2xl">Product Orders</h2>
        <p className="text-sm text-muted-foreground">Track buyer orders, manage per-shipment status, and handle returns individually per vendor/admin source.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Orders" value={summary.total_orders || pagination.total} />
        <StatCard label="Revenue" value={formatPrice(summary.revenue || 0)} color="text-primary" />
        <StatCard label="In Transit" value={summary.in_transit || 0} />
        <StatCard label="Delivered" value={summary.delivered || 0} color="text-emerald-600" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search orders..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}><SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Filter" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{[...ORDER_STATUSES, ...DELIVERY_STATUSES.filter((s) => !ORDER_STATUSES.includes(s as any))].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void refreshOrderScreen()}><RefreshCw className="mr-2 h-4 w-4 sm:mr-0" /><span className="sm:hidden">Refresh orders</span></Button>
      </div>
      {loading ? <LoadingSpinner /> : visibleOrders.length === 0 ? <EmptyState icon={Package} text="No orders found" /> : <div className="space-y-3">{visibleOrders.map((order) => (
        <div key={order.id} className="overflow-hidden rounded-xl border border-border bg-card">
          <button onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)} className="flex w-full flex-col gap-3 p-4 text-left transition-colors hover:bg-accent/30 sm:flex-row sm:items-center">
            <div className="grid w-full min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-5">
              <div><p className="text-xs text-muted-foreground">Order</p><p className="font-mono text-sm font-medium truncate">{(order.order_number || order.id.slice(0, 8)).toUpperCase()}</p></div>
              <div><p className="text-xs text-muted-foreground">Customer</p><p className="text-sm truncate">{order.guest_name}</p></div>
              <div><p className="text-xs text-muted-foreground">Payment</p><p className="text-sm capitalize">{order.payment_method} · {order.payment_status.replace(/_/g, " ")}</p></div>
              <div><p className="text-xs text-muted-foreground">Amount</p><p className="text-sm font-semibold">{formatPrice(order.total)}</p></div>
              <div><p className="text-xs text-muted-foreground">Date</p><p className="text-sm">{formatOrderDate(order.createdAt || order.created_at, { year: undefined })}</p></div>
            </div>
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end"><StatusBadge status={order.status} /><StatusBadge status={order.delivery_status || "pending"} /></div>
              {expandedOrder === order.id ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          </button>

          {/* ── Expanded Detail Panel ── */}
          {expandedOrder === order.id && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-border p-5 space-y-5">

            {/* Row 1: Customer · Order Info */}
            <div className="grid gap-4 md:grid-cols-2">
              <DetailSection icon={User} title="Customer Information">
                <div className="space-y-2.5 text-sm">
                  <p className="font-medium text-foreground">{order.guest_name}</p>
                  <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{order.guest_email}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" /><span>{order.guest_phone || order.user?.phone || "—"}</span></div>
                  <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{[order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_pincode].filter(Boolean).join(", ") || "—"}</span></div>
                </div>
              </DetailSection>

              <DetailSection icon={Receipt} title="Order Information">
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="font-mono">{(order.order_number || order.id.slice(0, 8)).toUpperCase()}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-3.5 w-3.5 shrink-0" /><span>Placed: {formatOrderDate(order.createdAt || order.created_at)}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-3.5 w-3.5 shrink-0" /><span className="capitalize">{order.payment_method} · {order.payment_status.replace(/_/g, " ")}</span></div>
                  {order.invoice_number && <div className="flex items-center gap-2 text-muted-foreground"><Receipt className="h-3.5 w-3.5 shrink-0" /><span className="font-mono text-xs">Invoice: {order.invoice_number}</span></div>}
                  {order.delivered_at && <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-3.5 w-3.5 shrink-0" /><span>Delivered: {formatOrderDate(order.delivered_at)}</span></div>}
                  <div className="flex flex-wrap gap-1.5 mt-1"><StatusBadge status={order.status} /><StatusBadge status={order.delivery_status || "pending"} /></div>
                </div>
              </DetailSection>
            </div>

            {/* Row 2: Shipment Groups (with per-shipment status controls) */}
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Package className="h-3.5 w-3.5" />
                Shipments ({groupItemsByShipment(order.items || [], order.admin_warehouse).length})
              </div>
              <div className="space-y-3">
                {groupItemsByShipment(order.items || [], order.admin_warehouse).map((group, idx) => (
                  <ShipmentCard
                    key={group.key}
                    group={group}
                    index={idx}
                    orderId={order.id}
                    onUpdate={(updatedOrder) => handleShipmentUpdate(order.id, updatedOrder)}
                  />
                ))}
              </div>
            </div>

            {/* Row 3: Financials · Delivery Partner */}
            <div className="grid gap-4 md:grid-cols-2">

              {/* Financial Summary */}
              <DetailSection icon={CreditCard} title="Financial Summary">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{formatPrice(order.shipping_cost)}</span></div>
                  {order.wallet_used ? <div className="flex justify-between"><span className="text-muted-foreground">Wallet Used</span><span className="text-emerald-600">−{formatPrice(order.wallet_used)}</span></div> : null}
                  <div className="h-px bg-border my-1" />
                  <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{formatPrice(order.total)}</span></div>
                  {order.vendor_payout_amount ? <>
                    <div className="h-px bg-border my-1" />
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Vendor Payout</span><span>{formatPrice(order.vendor_payout_amount)}</span></div>
                    {order.pinkpaisa_commission_amount ? <div className="flex justify-between text-xs"><span className="text-muted-foreground">Platform Commission</span><span className="text-primary">{formatPrice(order.pinkpaisa_commission_amount)}</span></div> : null}
                    {order.vendor_payout_status && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Payout Status</span><StatusBadge status={order.vendor_payout_status} /></div>}
                  </> : null}
                  <div className="flex gap-2 pt-2">{order.status === "delivered" || order.invoice_number ? <Button variant="outline" size="sm" className="rounded-xl w-full" onClick={() => downloadInvoice(order.id, order.invoice_number)}>Download Invoice</Button> : null}</div>
                </div>
              </DetailSection>

              {/* Delivery Partner Assignment */}
              <DetailSection icon={Truck} title="Delivery Partner">
                <div className="space-y-3">
                  <Field label="Assign delivery partner">
                    <Select value={order.delivery_partner_id || "none"} onValueChange={(value) => value !== "none" && assignDelivery(order.id, value, "pickup_assigned")}><SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger><SelectContent><SelectItem value="none">Select partner</SelectItem>{partners.filter((p) => p.status === "active").map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                  </Field>
                  {order.delivery_partner && <div className="rounded-lg bg-accent/50 p-2.5 text-xs">
                    <p className="font-medium flex items-center gap-1.5"><Truck className="h-3 w-3" /> {order.delivery_partner.name}</p>
                    {order.delivery_partner.phone && <p className="mt-1 text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" /> {order.delivery_partner.phone}</p>}
                    <p className="mt-0.5 text-muted-foreground">{order.delivery_partner.company_name || "Delivery partner assigned"}</p>
                  </div>}
                  <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground/80 mb-1">How it works</p>
                    <p>Use the status buttons on each shipment card above to manage the lifecycle individually. Refund is auto-processed when return pickup is done.</p>
                  </div>
                </div>
              </DetailSection>
            </div>

          </motion.div>}
        </div>
      ))}</div>}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {visibleOrders.length} of {pagination.total} order(s). Page {pagination.page} of {pagination.total_pages}.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" disabled={pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" className="w-full sm:w-auto" disabled={pagination.page >= pagination.total_pages || loading} onClick={() => setPage((current) => Math.min(pagination.total_pages, current + 1))}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};
