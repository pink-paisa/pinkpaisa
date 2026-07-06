import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2, ShoppingBag, ArrowLeft, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { calculateShippingCost, FREE_SHIPPING_THRESHOLD } from "@/lib/commerceConfig";

const formatPrice = (n: number) => `\u20B9${n.toLocaleString("en-IN")}`;

const Cart = () => {
  const router = useRouter();
  const {
    items,
    subtotal,
    updateQuantity,
    removeItem,
    totalItems,
    validateCart,
    cartNotices,
    isValidating,
  } = useCart();
  const shipping = calculateShippingCost(subtotal);
  const total = subtotal + shipping;
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    if (hasValidatedRef.current || items.length === 0) return;
    hasValidatedRef.current = true;
    validateCart().catch(() => undefined);
  }, [items.length, validateCart]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-10 md:py-16">
        <Link
          href="/products"
          className="mb-8 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Continue Shopping
        </Link>

        <h1 className="mb-10 font-serif text-3xl md:text-4xl">Shopping Cart ({totalItems})</h1>

        {items.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <ShoppingBag className="mb-4 h-16 w-16 text-muted-foreground/25" />
            <h2 className="mb-2 font-serif text-xl">Your cart is empty</h2>
            <p className="mb-6 max-w-sm text-muted-foreground">
              Browse our products and find something that matches where you are in your wellness journey.
            </p>
            <Button asChild>
              <Link href="/products">Browse Products</Link>
            </Button>
          </motion.div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-3">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4 lg:col-span-2"
            >
              {cartNotices.length ? (
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                  {cartNotices.map((notice) => (
                    <p key={notice}>{notice}</p>
                  ))}
                </div>
              ) : null}

              {items.map((item, index) => {
                const canIncrease = item.stock_quantity_at_add == null || item.quantity < item.stock_quantity_at_add;
                const productHref = item.slug ? `/product/${item.slug}` : "/products";

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.06 }}
                    className="flex gap-5 rounded-2xl border border-border bg-card p-5 md:p-6"
                  >
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-accent">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-primary">
                          <ShoppingBag className="h-6 w-6" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link href={productHref} className="mb-1 block text-base font-medium leading-tight hover:text-primary">
                        {item.title}
                      </Link>
                      <p className="mb-3 text-xs text-muted-foreground">
                        {item.stock_quantity_at_add != null
                          ? item.stock_quantity_at_add > 0
                            ? `${item.stock_quantity_at_add} available right now`
                            : "Currently out of stock"
                          : "Availability will be confirmed again at checkout"}
                      </p>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 rounded-lg border border-border">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            aria-label="Decrease quantity"
                            className="flex min-h-10 min-w-10 items-center justify-center rounded-l-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium tabular-nums">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            disabled={!canIncrease}
                            aria-label="Increase quantity"
                            className="flex min-h-10 min-w-10 items-center justify-center rounded-r-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.title}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatPrice(item.price * item.quantity)}</p>
                      {item.quantity > 1 ? (
                        <p className="mt-1 text-xs text-muted-foreground">{formatPrice(item.price)} each</p>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="sticky top-24 space-y-4 rounded-2xl border border-border bg-card p-6">
                <h2 className="font-serif text-lg">Order Summary</h2>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Subtotal ({totalItems} item{totalItems > 1 ? "s" : ""})
                    </span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span>{shipping === 0 ? <span className="font-medium text-emerald-600">FREE</span> : formatPrice(shipping)}</span>
                  </div>
                  {shipping > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Free shipping on orders above {formatPrice(FREE_SHIPPING_THRESHOLD)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Taxes and any final stock adjustments are confirmed again during checkout.</p>
                </div>

                <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatPrice(total)}</span>
                </div>

                <Button size="lg" className="w-full rounded-xl font-semibold" onClick={() => router.push("/checkout")}>
                  Proceed to Checkout <ArrowRight className="h-4 w-4" />
                </Button>

                {isValidating ? (
                  <p className="text-xs text-muted-foreground">Refreshing live price and stock…</p>
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default Cart;
