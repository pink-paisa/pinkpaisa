import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCustomerAuth, customerFetch } from "@/contexts/CustomerAuthContext";
import { API_URL } from "@/lib/api";
import { useCart } from "@/contexts/CartContext";
import { toast } from "sonner";
import { Heart, Package2, Wallet, ShoppingBag, MapPin } from "lucide-react";
import TextActionDialog from "@/components/ui/text-action-dialog";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { useWishlist } from "@/hooks/useWishlist";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { hasVisibleAffiliatePrice } from "@/lib/affiliateProductData";

const formatPrice = (n: number) => `${String.fromCharCode(8377)}${Number(n || 0).toLocaleString("en-IN")}`;
type AccountTab = "profile" | "orders" | "wishlist" | "wallet";

const Account = () => {
  const router = useRouter();
  const { user, loading, logout, updateUser } = useCustomerAuth();
  const { addItem } = useCart();
  const queryTab = typeof router.query.tab === "string" ? (router.query.tab as AccountTab) : "profile";
  const [tab, setTab] = useState<AccountTab>(queryTab);
  const [profileForm, setProfileForm] = useState({ full_name: "", phone: "", address: "", city: "", state: "", pincode: "" });
  const [orders, setOrders] = useState<any[]>([]);
  const [wallet, setWallet] = useState<{ balance: number; transactions: any[] }>({ balance: 0, transactions: [] });
  const [returnOrderItemId, setReturnOrderItemId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const { wishlistItems, toggleWishlist } = useWishlist();

  useEffect(() => {
    setTab(queryTab);
  }, [queryTab]);

  useEffect(() => {
    if (!user) return;
    setProfileForm({
      full_name: user.full_name || "",
      phone: user.phone || "",
      address: user.address || "",
      city: user.city || "",
      state: user.state || "",
      pincode: user.pincode || "",
    });
  }, [user]);

  const loadAccount = async () => {
    if (!user) return;
    try {
      const [ordersData, walletData] = await Promise.all([
        customerFetch<any[]>("/account/orders"),
        customerFetch<{ balance: number; transactions: any[] }>("/wallet"),
      ]);
      setOrders(ordersData);
      setWallet(walletData);
      updateUser({ wallet_balance: walletData.balance });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load account details");
    }
  };

  useEffect(() => {
    loadAccount();
  }, [user?.id]);

  const stats = useMemo(
    () => [
      { label: "Orders", value: orders.length, icon: Package2 },
      { label: "Wishlist", value: wishlistItems.length, icon: Heart },
      { label: "Wallet", value: formatPrice(wallet.balance), icon: Wallet },
    ],
    [orders.length, wishlistItems.length, wallet.balance],
  );

  const setActiveTab = (nextTab: AccountTab) => {
    setTab(nextTab);
    router.replace({ pathname: "/account", query: { tab: nextTab } }, undefined, { shallow: true });
  };

  if (loading || !user) {
    return <div className="min-h-screen bg-background"><Navbar /><div className="container mx-auto py-24 text-center text-muted-foreground">Loading account...</div><Footer /></div>;
  }

  const requestReturn = async () => {
    if (!returnOrderItemId || !returnReason.trim()) return;
    try {
      await customerFetch("/orders/request-return", { method: "POST", body: JSON.stringify({ order_item_id: returnOrderItemId, reason: returnReason.trim() }) });
      toast.success("Return request submitted");
      const refreshed = await customerFetch<any[]>("/account/orders");
      setOrders(refreshed || []);
      setReturnOrderItemId(null);
      setReturnReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request return");
    }
  };

  const cancelOrder = async () => {
    if (!cancelOrderId) return;
    setCancelPending(true);
    try {
      const response = await customerFetch<{ message?: string }>("/orders/" + cancelOrderId + "/cancel", {
        method: "POST",
      });
      toast.success(response?.message || "Order cancelled successfully");
      setCancelOrderId(null);
      await loadAccount();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel order");
    } finally {
      setCancelPending(false);
    }
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
      toast.success("Invoice downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download invoice");
    }
  };

  const saveProfile = async () => {
    try {
      const updated = await customerFetch<any>("/account/profile", { method: "PUT", body: JSON.stringify(profileForm) });
      updateUser(updated);
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update profile");
    }
  };

  const addMoney = async () => {
    toast.info("Wallet top-ups are temporarily unavailable until the secure payment-backed flow is enabled.");
  };

  const removeWishlist = async (item: any) => {
    try {
      await toggleWishlist({
        id: item.product.id,
        slug: item.product.slug,
        title: item.product.title,
        featured_image: item.product.featured_image,
        price: item.product.price,
        sale_price: item.product.sale_price,
        stock_quantity: item.product.stock_quantity,
        is_affiliate: item.product.is_affiliate,
        affiliate_url: item.product.affiliate_url,
        affiliate_data_source: item.product.affiliate_data_source,
        affiliate_data_last_refreshed_at: item.product.affiliate_data_last_refreshed_at,
        affiliate_data_expires_at: item.product.affiliate_data_expires_at,
        affiliate_compliance_status: item.product.affiliate_compliance_status,
      });
      toast.success("Removed from wishlist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove item");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-10 md:py-16">
        <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,#fff8fb,#fff3ec)] p-8 shadow-sm md:p-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Pink Paisa buyer account</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight">Hi, {user.full_name || user.email}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">Manage your orders, wallet balance, profile details, and wishlist from one place.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="rounded-2xl bg-white/80" onClick={async () => { await logout(); router.push("/"); }}>Logout</Button>
              <Button className="rounded-2xl" asChild><Link href="/products">Continue shopping</Link></Button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {stats.map((item) => <div key={item.label} className="rounded-2xl border border-white/70 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p><p className="mt-2 text-2xl font-semibold">{item.value}</p></div>)}
          </div>
          {!user.email_verified ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Email not verified yet. Check your inbox to unlock password recovery and future account protections.
            </div>
          ) : null}
        </section>

        <div className="mt-8 inline-flex rounded-2xl border border-border bg-card p-1">
          {(["profile", "orders", "wishlist", "wallet"] as const).map((item) => <button key={item} onClick={() => setActiveTab(item)} className={`rounded-xl px-4 py-2 text-sm font-medium capitalize ${tab === item ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{item}</button>)}
        </div>

        <div className="mt-6 rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
          {tab === "profile" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Full name</Label><Input value={profileForm.full_name} onChange={(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={user.email} disabled /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={profileForm.address} onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))} /></div>
              <div className="space-y-2"><Label>City</Label><Input value={profileForm.city} onChange={(e) => setProfileForm((p) => ({ ...p, city: e.target.value }))} /></div>
              <div className="space-y-2"><Label>State</Label><Input value={profileForm.state} onChange={(e) => setProfileForm((p) => ({ ...p, state: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Pincode</Label><Input value={profileForm.pincode} onChange={(e) => setProfileForm((p) => ({ ...p, pincode: e.target.value }))} /></div>
              <div className="sm:col-span-2 flex flex-wrap gap-3">
                <Button className="rounded-2xl" onClick={saveProfile}>Save profile</Button>
                <Button variant="outline" className="rounded-2xl" asChild>
                  <Link href="/account/addresses">
                    <MapPin className="mr-2 h-4 w-4" /> Manage address book
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {tab === "orders" && (
            <div className="space-y-4">
              {orders.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No orders yet.</div> : orders.map((order) => (
                <div key={order.id} className="rounded-2xl border border-border p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={`/account/orders/${order.id}`} className="font-medium transition-colors hover:text-primary">
                        Order #{order.order_number || order.id.slice(0, 8).toUpperCase()}
                      </Link>
                      <p className="text-sm text-muted-foreground">{new Date(order.createdAt || order.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-semibold">{formatPrice(order.total)}</p>
                      <p className="capitalize text-muted-foreground">{order.delivery_status || order.status}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="rounded-full" asChild>
                      <Link href={`/account/orders/${order.id}`}>View details</Link>
                    </Button>
                    {["pending", "confirmed", "processing", "pickup_assigned"].includes(String(order.status || "")) &&
                    ["pending", "pickup_assigned"].includes(String(order.delivery_status || "pending")) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => setCancelOrderId(order.id)}
                      >
                        Cancel order
                      </Button>
                    ) : null}
                    {order.status === "delivered" || order.invoice_number ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => downloadInvoice(order.id, order.invoice_number)}>Download PinkPaisa Invoice</Button> : null}
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                    {(order.items || []).map((item: any, index: number) => (
                      <div key={index} className="flex flex-col gap-2 rounded-xl bg-secondary/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p>{item.product_title} x {item.quantity}</p>
                          <p className="text-xs capitalize">{item.vendor_status || item.return_status || "ordered"}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {item.returnable && order.status === "delivered" && item.return_status === "not_requested" ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setReturnOrderItemId(item.id); setReturnReason(""); }}>Return product</Button> : null}
                          {item.return_status && item.return_status !== "not_requested" ? <span className="inline-flex items-center rounded-full border border-border bg-white px-3 py-1 text-xs capitalize">{item.return_status.replace(/_/g, " ")}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "wishlist" && (
            <div className="space-y-4">
              {wishlistItems.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Your wishlist is empty.</div> : wishlistItems.map((item) => {
                const isAffiliate = Boolean(item.product.is_affiliate && item.product.affiliate_url);
                const showAffiliatePrice = hasVisibleAffiliatePrice(item.product);
                const checkoutPrice = Number(item.product.sale_price ?? item.product.price ?? 0);
                return (
                  <div key={item.id} className="flex flex-col gap-4 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-2xl bg-accent">{item.product.featured_image ? <img src={item.product.featured_image} alt={item.product.title} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-primary"><ShoppingBag className="h-5 w-5" /></div>}</div>
                      <div>
                        <p className="font-medium">{item.product.title}</p>
                        {isAffiliate ? (
                          <p className="text-sm text-muted-foreground">
                            {showAffiliatePrice ? `${formatPrice(checkoutPrice)} - confirm on Amazon` : "Check price on Amazon"}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">{formatPrice(checkoutPrice)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="rounded-2xl" asChild><Link href={`/product/${item.product.slug}`}>View</Link></Button>
                      {isAffiliate ? (
                        item.product.affiliate_compliance_status === "compliant" ? (
                          <AffiliateCta product={item.product} size="sm" variant="secondary" className="rounded-2xl" />
                        ) : null
                      ) : (
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          onClick={() =>
                            addItem(
                              {
                                id: item.product.id,
                                title: item.product.title,
                                price: checkoutPrice,
                                priceMax: Number(item.product.price ?? checkoutPrice),
                                format: "Physical Product",
                                image_url: item.product.featured_image,
                                slug: item.product.slug,
                                stock_quantity_at_add: item.product.stock_quantity,
                              },
                              1,
                            )
                          }
                        >
                          Add to cart
                        </Button>
                      )}
                      <Button variant="ghost" className="rounded-2xl text-rose-500" onClick={() => removeWishlist(item)}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "wallet" && (
            <div className="grid gap-6 lg:grid-cols-[0.8fr,1.2fr]">
              <div className="rounded-2xl border border-border bg-secondary/20 p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Available balance</p>
                <p className="mt-3 text-4xl font-semibold">{formatPrice(wallet.balance)}</p>
                <div className="mt-5 space-y-3">
                  <Label>Wallet top-ups</Label>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Wallet credits are currently added only through verified refunds and admin adjustments. Self-serve top-ups will return once the PhonePe-backed flow is live.
                  </p>
                  <Button className="w-full rounded-2xl" variant="outline" onClick={addMoney}>Notify me when top-ups return</Button>
                </div>
              </div>
              <div>
                <h3 className="font-serif text-2xl">Wallet transactions</h3>
                <div className="mt-4 space-y-3">
                  {wallet.transactions.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No wallet transactions yet.</div> : wallet.transactions.map((txn) => (
                    <div key={txn.id} className="flex items-center justify-between rounded-2xl border border-border p-4 text-sm">
                      <div>
                        <p className="font-medium capitalize">{txn.source.replace(/_/g, " ")}</p>
                        <p className="text-muted-foreground">{txn.note || "Wallet activity"}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${txn.type === "credit" ? "text-emerald-600" : "text-rose-600"}`}>{txn.type === "credit" ? "+" : "-"}{formatPrice(txn.amount)}</p>
                        <p className="text-muted-foreground">Balance: {formatPrice(txn.balance_after)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
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
        onConfirm={requestReturn}
        confirmLabel="Submit return request"
        placeholder="Tell us what went wrong with the product or delivery."
        multiline
        disabled={!returnReason.trim()}
      />
      <ConfirmActionDialog
        open={Boolean(cancelOrderId)}
        onOpenChange={(open) => {
          if (!open) setCancelOrderId(null);
        }}
        title="Cancel this order?"
        description="We will stop fulfillment for any items that have not been picked up yet. If payment was already captured, the refund will be started automatically."
        confirmLabel="Cancel order"
        onConfirm={cancelOrder}
        pending={cancelPending}
        destructive
      />
      <Footer />
    </div>
  );
};

export default Account;
