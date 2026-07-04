import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { CheckCircle2, Package, ArrowRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { customerFetch } from "@/contexts/CustomerAuthContext";

type OrderData = {
  id: string;
  order_number?: string | null;
  guest_name: string;
  guest_email: string;
  total: number;
  status: string;
  payment_method?: string | null;
  createdAt?: string;
  created_at?: string;
  items: { product_title: string; price: number; quantity: number }[];
};

const formatPrice = (n: number) => `\u20B9${Number(n || 0).toLocaleString("en-IN")}`;

const OrderConfirmation = () => {
  const router = useRouter();
  const orderId = typeof router.query.orderId === "string" ? router.query.orderId : "";
  const receiptToken = typeof router.query.t === "string" ? router.query.t : "";
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!router.isReady || !orderId) return;

    const loadOrder = async () => {
      try {
        if (receiptToken) {
          const data = await apiFetch<OrderData>(`/orders/${orderId}/receipt?t=${encodeURIComponent(receiptToken)}`);
          setOrder(data);
          return;
        }

        const data = await customerFetch<OrderData>(`/orders/${orderId}`);
        setOrder(data);
      } catch {
        setOrder(null);
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [orderId, receiptToken, router.isReady]);

  const displayOrderNumber = order?.order_number || orderId.slice(0, 8).toUpperCase();

  const handleCopy = () => {
    navigator.clipboard.writeText(displayOrderNumber);
    setCopied(true);
    toast.success("Order number copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto flex items-center justify-center py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto flex flex-col items-center justify-center py-32 text-center">
          <Package className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h1 className="mb-2 font-serif text-2xl">Order not found</h1>
          <p className="mb-6 text-muted-foreground">We couldn&apos;t load this receipt. Please check your email confirmation or sign in to view your orders.</p>
          <Button asChild>
            <Link href="/products">Browse Products</Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto max-w-2xl py-12 md:py-20">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mb-10 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50"
          >
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </motion.div>
          <h1 className="mb-3 font-serif text-3xl md:text-4xl">Order Confirmed!</h1>
          <p className="text-lg text-muted-foreground">
            Thank you, <span className="font-medium text-foreground">{order.guest_name}</span>. Your order has been placed successfully.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-6 rounded-2xl border border-border bg-card p-6 md:p-8"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Order Number</p>
              <p className="font-mono text-lg font-semibold">{displayOrderNumber}</p>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="rounded-xl bg-accent/50 p-4 text-sm">
            A confirmation is linked to <span className="font-medium">{order.guest_email}</span>.
          </div>

          <div>
            <h3 className="mb-3 text-sm font-medium">Items Ordered</h3>
            <div className="space-y-3">
              {order.items.map((item, index) => (
                <div key={`${item.product_title}-${index}`} className="flex justify-between text-sm">
                  <span>
                    {item.product_title}
                    {item.quantity > 1 ? <span className="text-muted-foreground"> × {item.quantity}</span> : null}
                  </span>
                  <span className="font-medium tabular-nums">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between border-t border-border pt-4 font-semibold">
            <span>Total Paid</span>
            <span className="text-lg tabular-nums">{formatPrice(Number(order.total))}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            <span className="text-muted-foreground">
              Status: <span className="font-medium capitalize text-foreground">{order.status}</span>
            </span>
          </div>
        </motion.div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!receiptToken ? (
            <Button asChild size="lg" variant="outline" className="rounded-xl">
              <Link href={`/account/orders/${order.id}`}>View Full Order</Link>
            </Button>
          ) : null}
          <Button asChild size="lg" className="rounded-xl">
            <Link href="/products">
              Continue Shopping <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default OrderConfirmation;
