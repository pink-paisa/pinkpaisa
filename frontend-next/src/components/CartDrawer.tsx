import Link from "next/link";
import { useRouter } from "next/router";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCart } from "@/contexts/CartContext";

const formatPrice = (value: number) => `₹${value.toLocaleString("en-IN")}`;

const CartDrawer = () => {
  const {
    items,
    isCartOpen,
    setIsCartOpen,
    removeItem,
    updateQuantity,
    subtotal,
    totalItems,
    cartNotices,
    isValidating,
  } = useCart();
  const router = useRouter();

  return (
    <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-serif text-xl">
            <ShoppingBag className="h-5 w-5" />
            Your Cart ({totalItems})
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <ShoppingBag className="h-12 w-12 opacity-30" />
            <p className="text-sm">Your cart is empty</p>
            <Button variant="outline" size="sm" onClick={() => setIsCartOpen(false)}>
              Continue Shopping
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto py-4">
              {cartNotices.length ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {cartNotices.map((notice) => (
                    <p key={notice}>{notice}</p>
                  ))}
                </div>
              ) : null}

              {isValidating ? (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
                  Refreshing current price and stock...
                </div>
              ) : null}

              {items.map((item) => (
                <div key={item.id} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-accent/40">
                    {item.image_url ? (
                      item.slug ? (
                        <Link href={`/product/${item.slug}`} onClick={() => setIsCartOpen(false)}>
                          <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
                        </Link>
                      ) : (
                        <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {item.slug ? (
                      <Link href={`/product/${item.slug}`} onClick={() => setIsCartOpen(false)} className="line-clamp-2 text-sm font-medium leading-tight hover:text-primary">
                        {item.title}
                      </Link>
                    ) : (
                      <h4 className="line-clamp-2 text-sm font-medium leading-tight">{item.title}</h4>
                    )}
                    {item.format ? <p className="mt-1 text-xs text-muted-foreground">{item.format}</p> : null}
                    <div className="mt-2 flex items-center gap-2">
                      <p className="text-sm font-semibold">{formatPrice(item.price)}</p>
                      {item.priceMax > item.price ? (
                        <span className="text-xs text-muted-foreground line-through">{formatPrice(item.priceMax)}</span>
                      ) : null}
                    </div>
                    {item.stock_quantity_at_add != null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.stock_quantity_at_add > 0
                          ? `${item.stock_quantity_at_add} available now`
                          : "Currently unavailable"}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end justify-between">
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                    <div className="flex items-center gap-2 rounded-lg border border-border">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="rounded-l-lg p-1.5 transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-sm font-medium tabular-nums">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        disabled={item.stock_quantity_at_add != null && item.quantity >= item.stock_quantity_at_add}
                        className="rounded-r-lg p-1.5 transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold">{formatPrice(subtotal)}</span>
              </div>
              <Button
                variant="default"
                size="lg"
                className="w-full rounded-xl font-semibold"
                onClick={() => {
                  setIsCartOpen(false);
                  router.push("/checkout");
                }}
                disabled={!items.length}
              >
                Proceed to Checkout
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setIsCartOpen(false)}
              >
                Continue Shopping
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default CartDrawer;
