/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useCart } from "@/contexts/CartContext";
import { customerFetch } from "@/contexts/CustomerAuthContext";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

type VerifyStatus = "loading" | "success" | "failed" | "error";

const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;

const PhonepeReturn = () => {
  const router = useRouter();
  const { clearCart } = useCart();
  const [status, setStatus] = useState<VerifyStatus>("loading");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(null);
  const [message, setMessage] = useState("Please wait while we confirm your PhonePe payment. Do not close this page.");
  const [errorMessage, setErrorMessage] = useState("We couldn’t confirm your payment yet. If the payment succeeds, we’ll email you as soon as the order is confirmed.");

  const confirmationPath = useMemo(() => {
    if (!orderId) return "/account";
    return receiptToken
      ? `/order-confirmation/${orderId}?t=${encodeURIComponent(receiptToken)}`
      : `/order-confirmation/${orderId}`;
  }, [orderId, receiptToken]);

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;
    let pollIntervalId: number | null = null;

    const stopPolling = () => {
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const handleVerified = (result: any) => {
      if (cancelled) return;
      setOrderId(result.order_id);
      setReceiptToken(result.receipt_token || null);
      setStatus("success");
      clearCart();
      sessionStorage.removeItem("phonepe_pending_order");
      toast.success("Payment successful!");
    };

    const handleFailure = (nextStatus: "failed" | "error", nextMessage: string, clearPending = true) => {
      if (cancelled) return;
      setErrorMessage(nextMessage);
      setStatus(nextStatus);
      if (clearPending) sessionStorage.removeItem("phonepe_pending_order");
    };

    const verify = async () => {
      try {
        let merchantOrderId =
          typeof router.query.merchantOrderId === "string" ? router.query.merchantOrderId : null;

        if (!merchantOrderId) {
          const stored = sessionStorage.getItem("phonepe_pending_order");
          if (stored) {
            const parsed = JSON.parse(stored);
            merchantOrderId = parsed.merchant_order_id;
          }
        }

        if (!merchantOrderId) {
          handleFailure("error", "We couldn’t find the payment session for this PhonePe return. Please start checkout again.");
          return;
        }

        const result = await customerFetch<any>("/phonepe/verify-payment", {
          method: "POST",
          body: JSON.stringify({ merchant_order_id: merchantOrderId }),
        });

        if (result.verified && result.order_id) {
          handleVerified(result);
          return;
        }

        if (result.status === "FAILED") {
          handleFailure("failed", "Your payment could not be processed. No order has been placed.");
          return;
        }

        if (result.status === "MISSING" || result.status === "EXPIRED") {
          handleFailure("error", "This payment session has expired. Please start checkout again to create a new payment request.");
          return;
        }

        let attempts = 0;
        pollIntervalId = window.setInterval(async () => {
          attempts += 1;

          if (attempts === 5 && !cancelled) {
            setMessage("Payment is taking longer than usual. We’ll email you the moment it’s confirmed.");
          }

          try {
            const pollResult = await customerFetch<any>("/phonepe/verify-payment", {
              method: "POST",
              body: JSON.stringify({ merchant_order_id: merchantOrderId }),
            });

            if (pollResult.verified && pollResult.order_id) {
              stopPolling();
              handleVerified(pollResult);
              return;
            }

            if (pollResult.status === "FAILED") {
              stopPolling();
              handleFailure("failed", "Your payment could not be processed. No order has been placed.");
              toast.error("Payment failed.");
              return;
            }

            if (pollResult.status === "MISSING" || pollResult.status === "EXPIRED") {
              stopPolling();
              handleFailure("error", "This payment session has expired. Please start checkout again to create a new payment request.");
              return;
            }

            if (attempts >= MAX_POLL_ATTEMPTS) {
              stopPolling();
              handleFailure(
                "error",
                "Your payment is still processing. If it succeeds, we’ll email you as soon as it’s confirmed. You can also check My Orders in a little while.",
                false,
              );
              toast.error("Payment is still processing. We’ll email you when it completes.");
            }
          } catch {
            if (attempts >= MAX_POLL_ATTEMPTS) {
              stopPolling();
              handleFailure(
                "error",
                "We couldn’t confirm this payment yet. If the payment succeeds, you’ll receive a confirmation email shortly.",
                false,
              );
            }
          }
        }, POLL_INTERVAL_MS);
      } catch (error) {
        console.error("PhonePe verify error:", error);
        handleFailure("error", "We couldn’t verify this payment yet. If money was debited, we’ll email you when the order is confirmed.");
      }
    };

    verify();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [clearCart, router.isReady, router.query.merchantOrderId]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto flex flex-col items-center justify-center py-32 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto max-w-md rounded-[32px] border border-border bg-card p-10 shadow-sm"
        >
          {status === "loading" ? (
            <>
              <Loader2 className="mx-auto mb-6 h-16 w-16 animate-spin text-primary" />
              <h1 className="mb-2 font-serif text-2xl">Verifying your payment...</h1>
              <p className="text-muted-foreground">{message}</p>
            </>
          ) : null}

          {status === "success" ? (
            <>
              <CheckCircle2 className="mx-auto mb-6 h-16 w-16 text-emerald-500" />
              <h1 className="mb-2 font-serif text-2xl">Payment Successful!</h1>
              <p className="mb-8 text-muted-foreground">Your order has been placed successfully. You’ll receive a confirmation shortly.</p>
              <Button className="rounded-xl" onClick={() => router.push(confirmationPath)}>
                View Order Details
              </Button>
            </>
          ) : null}

          {status === "failed" ? (
            <>
              <XCircle className="mx-auto mb-6 h-16 w-16 text-red-500" />
              <h1 className="mb-2 font-serif text-2xl">Payment Failed</h1>
              <p className="mb-8 text-muted-foreground">{errorMessage}</p>
              <div className="flex flex-col gap-3">
                <Button className="rounded-xl" onClick={() => router.push("/checkout")}>Try Again</Button>
                <Button variant="outline" className="rounded-xl" onClick={() => router.push("/products")}>Continue Shopping</Button>
              </div>
            </>
          ) : null}

          {status === "error" ? (
            <>
              <XCircle className="mx-auto mb-6 h-16 w-16 text-amber-500" />
              <h1 className="mb-2 font-serif text-2xl">Still Processing</h1>
              <p className="mb-8 text-muted-foreground">{errorMessage}</p>
              <div className="flex flex-col gap-3">
                <Button className="rounded-xl" onClick={() => router.push("/account?tab=orders")}>Open My Orders</Button>
                <Button variant="outline" className="rounded-xl" onClick={() => router.push("/products")}>Continue Shopping</Button>
              </div>
            </>
          ) : null}
        </motion.div>
      </div>
      <Footer />
    </div>
  );
};

export default PhonepeReturn;
