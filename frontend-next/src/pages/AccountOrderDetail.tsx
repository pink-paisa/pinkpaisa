import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, Download, Package, Truck, CreditCard } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import TextActionDialog from "@/components/ui/text-action-dialog";
import { customerFetch } from "@/contexts/CustomerAuthContext";
import { API_URL } from "@/lib/api";
import { toast } from "sonner";

type VendorSummary = {
  id: string;
  shop_name?: string | null;
  business_name?: string | null;
};

type OrderItemRow = {
  id: string;
  product_title: string;
  quantity: number;
  price: number;
  vendor_status?: string | null;
  return_status?: string | null;
  refund_status?: string | null;
  returnable?: boolean;
  vendor?: VendorSummary | null;
};

type OrderDetail = {
  id: string;
  order_number?: string | null;
  invoice_number?: string | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  status: string;
  delivery_status: string;
  payment_status: string;
  payment_method?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  shipping_address?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_pincode?: string | null;
  createdAt?: string;
  created_at?: string;
  delivery_partner?: { name?: string | null; company_name?: string | null; phone?: string | null } | null;
  items: OrderItemRow[];
};

const formatPrice = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const TIMELINE_STEPS = [
  { key: "confirmed", label: "Confirmed" },
  { key: "pickup_assigned", label: "Pickup Assigned" },
  { key: "picked_up", label: "Picked Up" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const;

const resolveTimelineKey = (order: OrderDetail) => {
  const deliveryStatus = String(order.delivery_status || "").trim();
  if (TIMELINE_STEPS.some((step) => step.key === deliveryStatus)) return deliveryStatus;
  if (["cancelled", "refunded", "returned"].includes(String(order.status || ""))) return String(order.status || "");
  if (["confirmed", "processing"].includes(String(order.status || ""))) return "confirmed";
  return "confirmed";
};

const statusPillClass = (value?: string | null) => {
  const normalized = String(value || "").toLowerCase();
  if (["delivered", "processed", "paid", "refunded"].includes(normalized)) return "bg-emerald-50 text-emerald-700";
  if (["cancelled", "failed", "rejected"].includes(normalized)) return "bg-rose-50 text-rose-700";
  if (["return_requested", "requested", "approved", "in_transit", "pickup_assigned", "picked_up", "shipped"].includes(normalized)) return "bg-amber-50 text-amber-700";
  return "bg-secondary/70 text-foreground";
};

const AccountOrderDetail = () => {
  const router = useRouter();
  const orderId = typeof router.query.orderId === "string" ? router.query.orderId : "";
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [returnOrderItemId, setReturnOrderItemId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const loadOrder = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = await customerFetch<OrderDetail>(`/orders/${orderId}`);
      setOrder(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load this order");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady || !orderId) return;
    void loadOrder();
  }, [orderId, router.isReady]);

  const timelineIndex = useMemo(() => {
    const key = resolveTimelineKey(order || { delivery_status: "", status: "confirmed" } as OrderDetail);
    return TIMELINE_STEPS.findIndex((step) => step.key === key);
  }, [order]);

  const canCancelOrder = Boolean(
    order &&
      ["pending", "confirmed", "processing", "pickup_assigned"].includes(String(order.status || "")) &&
      ["pending", "pickup_assigned"].includes(String(order.delivery_status || "pending")),
  );

  const downloadInvoice = async () => {
    if (!order) return;
    try {
      const response = await fetch(`${API_URL}/orders/${order.id}/invoice`, { credentials: "include" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || "Could not download invoice");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${order.invoice_number || `pinkpaisa-invoice-${order.id.slice(0, 8).toUpperCase()}`}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Invoice downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download invoice");
    }
  };

  const handleReturnRequest = async () => {
    if (!returnOrderItemId || !returnReason.trim()) return;
    setPending(true);
    try {
      await customerFetch("/orders/request-return", {
        method: "POST",
        body: JSON.stringify({ order_item_id: returnOrderItemId, reason: returnReason.trim() }),
      });
      toast.success("Return request submitted");
      setReturnOrderItemId(null);
      setReturnReason("");
      await loadOrder();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request return");
    } finally {
      setPending(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    setPending(true);
    try {
      const response = await customerFetch<{ message?: string }>(`/orders/${order.id}/cancel`, {
        method: "POST",
      });
      toast.success(response?.message || "Order cancelled successfully");
      setCancelOpen(false);
      await loadOrder();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel order");
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto py-24 text-center text-muted-foreground">Loading your order...</div>
        <Footer />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto flex flex-col items-center justify-center py-24 text-center">
          <Package className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h1 className="font-serif text-3xl">Order not found</h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            We couldn&apos;t find this order in your account. It may have been placed as a guest order or the link may be incomplete.
          </p>
          <Button className="mt-6 rounded-2xl" asChild>
            <Link href="/account?tab=orders">Back to orders</Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-10 md:py-16">
        <Link href="/account?tab=orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to orders
        </Link>

        <section className="mt-6 rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,#fff8fb,#fff3ec)] p-8 shadow-sm md:p-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Order detail</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight">
                #{order.order_number || order.id.slice(0, 8).toUpperCase()}
              </h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Placed on {formatDate(order.createdAt || order.created_at)} • Paid via{" "}
                <span className="font-medium capitalize text-foreground">{order.payment_method || "unknown"}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canCancelOrder ? (
                <Button variant="outline" className="rounded-2xl" onClick={() => setCancelOpen(true)}>
                  Cancel order
                </Button>
              ) : null}
              {order.status === "delivered" || order.invoice_number ? (
                <Button variant="outline" className="rounded-2xl" onClick={downloadInvoice}>
                  <Download className="mr-2 h-4 w-4" /> Download invoice
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium capitalize ${statusPillClass(order.status)}`}>
              Order {String(order.status || "").replace(/_/g, " ")}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium capitalize ${statusPillClass(order.delivery_status)}`}>
              Delivery {String(order.delivery_status || "").replace(/_/g, " ")}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium capitalize ${statusPillClass(order.payment_status)}`}>
              Payment {String(order.payment_status || "").replace(/_/g, " ")}
            </span>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
          <div className="space-y-6">
            <section className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
              <h2 className="font-serif text-2xl">Order timeline</h2>
              <div className="mt-6 grid gap-4 md:grid-cols-5">
                {TIMELINE_STEPS.map((step, index) => {
                  const isComplete = timelineIndex >= index;
                  return (
                    <div key={step.key} className={`rounded-2xl border px-4 py-4 text-sm ${isComplete ? "border-primary bg-primary/5" : "border-border bg-secondary/20"}`}>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Step {index + 1}</p>
                      <p className="mt-2 font-medium">{step.label}</p>
                    </div>
                  );
                })}
              </div>
              {["cancelled", "returned", "refunded"].includes(String(order.status || "")) ? (
                <p className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                  This order is currently marked as <span className="font-medium capitalize text-foreground">{order.status.replace(/_/g, " ")}</span>.
                </p>
              ) : null}
            </section>

            <section className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-2xl">Items in this order</h2>
              </div>
              <div className="mt-6 space-y-4">
                {order.items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{item.product_title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Qty {item.quantity} • {formatPrice(item.price)} each
                        </p>
                        {item.vendor?.shop_name || item.vendor?.business_name ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            Sold by {item.vendor?.shop_name || item.vendor?.business_name}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            Sold by Pink Paisa
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${statusPillClass(item.vendor_status)}`}>
                          {String(item.vendor_status || "ordered").replace(/_/g, " ")}
                        </span>
                        {item.return_status && item.return_status !== "not_requested" ? (
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${statusPillClass(item.return_status)}`}>
                            Return {item.return_status.replace(/_/g, " ")}
                          </span>
                        ) : null}
                        {item.refund_status && item.refund_status !== "none" ? (
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${statusPillClass(item.refund_status)}`}>
                            Refund {item.refund_status.replace(/_/g, " ")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {item.returnable && order.status === "delivered" && item.return_status === "not_requested" ? (
                      <div className="mt-4">
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => { setReturnOrderItemId(item.id); setReturnReason(""); }}>
                          Request return
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
              <div className="flex items-center gap-3">
                <Truck className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-2xl">Delivery details</h2>
              </div>
              <div className="mt-5 space-y-3 text-sm leading-7 text-muted-foreground">
                <p className="font-medium text-foreground">{order.guest_name || "Customer"}</p>
                {order.guest_phone ? <p>{order.guest_phone}</p> : null}
                <p>{[order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_pincode].filter(Boolean).join(", ")}</p>
                {order.delivery_partner?.name || order.delivery_partner?.company_name ? (
                  <div className="rounded-2xl bg-secondary/30 px-4 py-3">
                    <p className="font-medium text-foreground">
                      {order.delivery_partner?.company_name || order.delivery_partner?.name}
                    </p>
                    {order.delivery_partner?.phone ? <p>{order.delivery_partner.phone}</p> : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-2xl">Payment summary</h2>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatPrice(order.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{order.shipping_cost ? formatPrice(order.shipping_cost) : "Free"}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <TextActionDialog
        open={Boolean(returnOrderItemId)}
        onOpenChange={(open) => {
          if (!open) {
            setReturnOrderItemId(null);
            setReturnReason("");
          }
        }}
        title="Request a return"
        description="Share the reason for this return so the Pink Paisa team can review it quickly."
        label="Reason"
        value={returnReason}
        onValueChange={setReturnReason}
        onConfirm={handleReturnRequest}
        confirmLabel="Submit return request"
        placeholder="Tell us what went wrong with the product or delivery."
        multiline
        disabled={!returnReason.trim() || pending}
      />
      <ConfirmActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this order?"
        description="We’ll stop fulfillment for any items that have not been picked up yet. If payment was already captured, the refund will be started automatically."
        confirmLabel="Cancel order"
        onConfirm={handleCancelOrder}
        pending={pending}
        destructive
      />
      <Footer />
    </div>
  );
};

export default AccountOrderDetail;
