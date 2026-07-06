/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { ArrowLeft, ShoppingBag, Wallet, Shield, Truck } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCart } from "@/contexts/CartContext";
import { customerFetch, useCustomerAuth } from "@/contexts/CustomerAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateShippingCost, FREE_SHIPPING_THRESHOLD } from "@/lib/commerceConfig";
import AddressPicker from "@/components/checkout/AddressPicker";
import type { UserAddress } from "@/hooks/useAccountAddresses";

type PaymentMethod = "wallet" | "phonepe" | "cod";

const formatPrice = (n: number) => `\u20B9${n.toLocaleString("en-IN")}`;
const buildAddressLine = (address: UserAddress) =>
  [address.line1, address.line2, address.landmark]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

const Checkout = () => {
  const router = useRouter();
  const { items, subtotal, clearCart } = useCart();
  const { user, loading } = useCustomerAuth();
  const [processing, setProcessing] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("phonepe");
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  const shipping = calculateShippingCost(subtotal);
  const total = subtotal + shipping;

  useEffect(() => {
    if (!user) return;

    setForm({
      name: user.full_name || "",
      email: user.email || "",
      phone: user.phone || "",
      address: user.address || "",
      city: user.city || "",
      state: user.state || "",
      pincode: user.pincode || "",
    });
    setWalletBalance(Number(user.wallet_balance || 0));

    customerFetch<{ balance: number }>("/wallet")
      .then((data) => setWalletBalance(Number(data.balance || 0)))
      .catch(() => undefined);
  }, [user]);

  const handleSelectAddress = (address: UserAddress | null) => {
    setSelectedAddressId(address?.id || null);
    if (!address) return;
    setForm((current) => ({
      ...current,
      name: address.full_name || current.name,
      phone: address.phone || current.phone,
      address: buildAddressLine(address) || current.address,
      city: address.city || current.city,
      state: address.state || current.state,
      pincode: address.pincode || current.pincode,
    }));
  };

  const isValid = useMemo(
    () =>
      Boolean(
        items.length > 0 &&
          form.name &&
          form.email &&
          form.phone &&
          form.address &&
          form.city &&
          form.state &&
          form.pincode,
      ),
    [form, items.length],
  );

  const buildOrderConfirmationPath = (order: any) => {
    if (!order?.id) return "/account";
    const suffix = order.receipt_token ? `?t=${encodeURIComponent(String(order.receipt_token))}` : "";
    return `/order-confirmation/${order.id}${suffix}`;
  };

  const buildCheckoutPayload = () => ({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
    })),
    guest_name: form.name,
    guest_email: form.email,
    guest_phone: form.phone,
    shipping_address: form.address,
    shipping_city: form.city,
    shipping_state: form.state,
    shipping_pincode: form.pincode,
    subtotal,
    shipping_cost: shipping,
    total,
  });

  const handleWalletCheckout = async () => {
    const order = await customerFetch<any>("/orders", {
      method: "POST",
      body: JSON.stringify({
        ...buildCheckoutPayload(),
        payment_method: "wallet",
      }),
    });
    clearCart();
    toast.success("Order placed using wallet balance");
    router.push(buildOrderConfirmationPath(order));
  };

  const handleCodCheckout = async () => {
    const order = await customerFetch<any>("/orders", {
      method: "POST",
      body: JSON.stringify({
        ...buildCheckoutPayload(),
        payment_method: "cod",
      }),
    });
    clearCart();
    toast.success("Order placed with cash on delivery");
    router.push(buildOrderConfirmationPath(order));
  };

  const handlePhonepeCheckout = async () => {
    const createData = await customerFetch<any>("/phonepe/create-order", {
      method: "POST",
      body: JSON.stringify(buildCheckoutPayload()),
    });

    if (createData.checkout_url) {
      sessionStorage.setItem(
        "phonepe_pending_order",
        JSON.stringify({ merchant_order_id: createData.merchant_order_id }),
      );
      window.location.href = createData.checkout_url;
      return;
    }

    toast.error("Unable to initiate PhonePe payment. Please try again.");
    setProcessing(false);
  };

  const handleCheckout = async () => {
    if (!isValid) {
      toast.error("Complete all required checkout fields");
      return;
    }

    setProcessing(true);
    try {
      if (paymentMethod === "wallet") {
        if (!user) {
          toast.error("Login to use wallet balance");
          return;
        }
        if (walletBalance < total) {
          toast.error("Insufficient wallet balance");
          return;
        }
        await handleWalletCheckout();
        return;
      }

      if (paymentMethod === "cod") {
        await handleCodCheckout();
        return;
      }

      await handlePhonepeCheckout();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setProcessing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto flex flex-col items-center justify-center py-32 text-center">
          <ShoppingBag className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h1 className="mb-2 font-serif text-2xl">Your cart is empty</h1>
          <p className="mb-6 text-muted-foreground">Add some products before checking out.</p>
          <Button onClick={() => router.push("/products")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Shop
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto py-32 text-center text-muted-foreground">Loading checkout...</div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-10 md:py-16">
        <button
          onClick={() => router.back()}
          className="mb-8 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h1 className="mb-10 font-serif text-3xl md:text-4xl">Checkout</h1>

        {!user ? (
          <div className="mb-8 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-4 text-sm text-muted-foreground">
            Continue as a guest with <span className="font-medium text-foreground">PhonePe or Cash on Delivery</span>, or{" "}
            <Link
              href="/account/auth?redirect=/checkout"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              sign in
            </Link>{" "}
            to use wallet balance and keep order history in your account.
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-5">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 lg:col-span-3">
            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="font-serif text-lg">{user ? "Account & Contact" : "Contact Details"}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-name">Full Name *</Label>
                  <Input id="checkout-name" autoComplete="name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-email">Email *</Label>
                  <Input
                    id="checkout-email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    disabled={Boolean(user)}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="checkout-phone">Phone *</Label>
                  <Input id="checkout-phone" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="font-serif text-lg">Shipping Address</h2>
              {user ? (
                <div className="mb-2">
                  <AddressPicker selectedAddressId={selectedAddressId} onSelectAddress={handleSelectAddress} />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="checkout-address">Address *</Label>
                  <Input id="checkout-address" autoComplete="address-line1" value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-city">City *</Label>
                  <Input id="checkout-city" autoComplete="address-level2" value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-state">State *</Label>
                  <Input id="checkout-state" autoComplete="address-level1" value={form.state} onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-pincode">PIN Code *</Label>
                  <Input id="checkout-pincode" inputMode="numeric" autoComplete="postal-code" value={form.pincode} onChange={(e) => setForm((prev) => ({ ...prev, pincode: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="font-serif text-lg">Payment Method</h2>
              <div className={`grid gap-3 ${user ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {user ? (
                  <button
                    onClick={() => setPaymentMethod("wallet")}
                    aria-pressed={paymentMethod === "wallet"}
                    className={`rounded-2xl border p-4 text-left ${paymentMethod === "wallet" ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <div className="flex items-center gap-3">
                      <Wallet className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Wallet balance</p>
                        <p className="text-sm text-muted-foreground">Available: {formatPrice(walletBalance)}</p>
                      </div>
                    </div>
                  </button>
                ) : null}

                <button
                  onClick={() => setPaymentMethod("phonepe")}
                  aria-pressed={paymentMethod === "phonepe"}
                  className={`rounded-2xl border p-4 text-left ${paymentMethod === "phonepe" ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">PhonePe</p>
                      <p className="text-sm text-muted-foreground">Pay securely using UPI, card, or net banking</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setPaymentMethod("cod")}
                  aria-pressed={paymentMethod === "cod"}
                  className={`rounded-2xl border p-4 text-left ${paymentMethod === "cod" ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-center gap-3">
                    <Truck className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Cash on Delivery</p>
                      <p className="text-sm text-muted-foreground">Pay when your order arrives</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2"
          >
            <div className="sticky top-24 space-y-5 rounded-2xl border border-border bg-card p-6">
              <h2 className="font-serif text-lg">Order Summary</h2>
              <div className="max-h-72 space-y-4 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground">Qty {item.quantity}</p>
                    </div>
                    <p className="font-semibold">{formatPrice(item.price * item.quantity)}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span>
                </div>
                {shipping > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Free shipping on orders above {formatPrice(FREE_SHIPPING_THRESHOLD)}
                  </p>
                ) : null}
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{formatPrice(total)}</span>
                </div>
              </div>

              {paymentMethod === "wallet" && walletBalance < total ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Wallet balance is lower than the order total. Switch to PhonePe or lower the order value for now.
                </div>
              ) : null}

              <Button
                size="lg"
                className="w-full rounded-xl font-semibold"
                disabled={processing || !isValid}
                onClick={handleCheckout}
              >
                {processing
                  ? "Processing..."
                  : paymentMethod === "wallet"
                    ? "Pay with Wallet"
                    : paymentMethod === "cod"
                      ? "Place COD Order"
                      : "Pay with PhonePe"}
              </Button>

              <p className="text-xs text-muted-foreground">
                {user
                  ? "Your order will be linked to your Pink Paisa account automatically."
                  : "Guest checkout is available for PhonePe and Cash on Delivery. Sign in anytime later for faster future checkout and wallet access."}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Checkout;
