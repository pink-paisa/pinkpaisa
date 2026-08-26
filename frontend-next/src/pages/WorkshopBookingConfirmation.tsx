/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { apiFetch } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { trackAnalyticsEvent } from "@/lib/analytics";

const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;
const receiptSessionKey = (bookingId: string) => `pinkpaisa_workshop_receipt:${bookingId}`;

type BookingStatus = "loading" | "processing" | "success" | "failed" | "error";

const formatPrice = (n: number) => `${String.fromCharCode(8377)}${Number(n).toLocaleString("en-IN")}`;

const WorkshopBookingConfirmation = () => {
  const router = useRouter();
  const bookingId = typeof router.query.bookingId === "string" ? router.query.bookingId : "";
  const queryReceiptToken = typeof router.query.t === "string" ? router.query.t.trim() : "";
  const queryMerchantOrderId = typeof router.query.merchantOrderId === "string"
    ? router.query.merchantOrderId.trim()
    : "";
  const [receiptToken, setReceiptToken] = useState("");
  const [merchantOrderId, setMerchantOrderId] = useState<string | null>(null);
  const [verificationSecret, setVerificationSecret] = useState("");
  const [sensitiveQueryReady, setSensitiveQueryReady] = useState(false);
  const consumedBookingIdRef = useRef("");
  const [booking, setBooking] = useState<any>(null);
  const [status, setStatus] = useState<BookingStatus>("loading");
  const [message, setMessage] = useState("Please wait while we confirm your workshop payment.");
  const [errorMessage, setErrorMessage] = useState("We couldn't confirm this workshop payment yet. If the payment succeeds, we'll email you shortly.");

  useEffect(() => {
    if (!router.isReady || !bookingId) return;
    if (consumedBookingIdRef.current === bookingId) return;
    consumedBookingIdRef.current = bookingId;
    let storedReceiptToken = "";
    let storedMerchantOrderId = "";
    let storedVerificationSecret = "";
    try {
      const storedReceipt = JSON.parse(sessionStorage.getItem(receiptSessionKey(bookingId)) || "null");
      const pending = JSON.parse(sessionStorage.getItem("phonepe_pending_workshop_booking") || "null");
      storedReceiptToken = String(
        storedReceipt?.receipt_token
          || (pending?.booking_id === bookingId ? pending.receipt_token : "")
          || "",
      ).trim();
      storedMerchantOrderId = String(
        storedReceipt?.merchant_order_id
          || (pending?.booking_id === bookingId ? pending.merchant_order_id : "")
          || "",
      ).trim();
      storedVerificationSecret = String(
        storedReceipt?.verification_secret
          || (pending?.booking_id === bookingId ? pending.verification_secret : "")
          || "",
      ).trim();
    } catch {
      storedReceiptToken = "";
      storedMerchantOrderId = "";
      storedVerificationSecret = "";
    }
    const nextReceiptToken = queryReceiptToken || storedReceiptToken;
    const nextMerchantOrderId = queryMerchantOrderId || storedMerchantOrderId;
    if (queryReceiptToken || queryMerchantOrderId) {
      try {
        sessionStorage.setItem(receiptSessionKey(bookingId), JSON.stringify({
          receipt_token: nextReceiptToken || null,
          merchant_order_id: nextMerchantOrderId || null,
          verification_secret: storedVerificationSecret || null,
        }));
      } catch {
        // Component state still keeps the one-time credentials for this visit.
      }
      void router.replace(`/workshop-booking-confirmation/${encodeURIComponent(bookingId)}`, undefined, { shallow: true });
    }
    setReceiptToken(nextReceiptToken);
    setMerchantOrderId(nextMerchantOrderId || null);
    setVerificationSecret(storedVerificationSecret);
    setSensitiveQueryReady(true);
  }, [bookingId, queryMerchantOrderId, queryReceiptToken, router]);

  useEffect(() => {
    if (!router.isReady || !bookingId || !sensitiveQueryReady) return;
    let cancelled = false;
    let pollIntervalId: number | null = null;

    const stopPolling = () => {
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const clearPendingSession = () => {
      try {
        const stored = JSON.parse(sessionStorage.getItem("phonepe_pending_workshop_booking") || "null");
        if (!stored || stored.booking_id === bookingId) {
          sessionStorage.removeItem("phonepe_pending_workshop_booking");
        }
        sessionStorage.removeItem(receiptSessionKey(bookingId));
      } catch {
        try {
          sessionStorage.removeItem("phonepe_pending_workshop_booking");
          sessionStorage.removeItem(receiptSessionKey(bookingId));
        } catch {
          // Storage cleanup must not change a verified payment result.
        }
      }
    };

    const trackPaidBooking = (value: any) => {
      if (!value || value.payment_status !== "paid") return;
      const analyticsKey = `pinkpaisa_purchase_tracked:workshop:${bookingId}`;
      if (localStorage.getItem(analyticsKey)) return;
      const tracked = trackAnalyticsEvent("purchase", {
        transaction_id: `workshop:${bookingId}`,
        value: Number(value.total || 0),
        currency: "INR",
        item_category: "workshop",
      });
      if (tracked) localStorage.setItem(analyticsKey, "true");
    };

    const fetchBooking = async () => {
      try {
        const data = await apiFetch<any>(`/workshop-bookings/${bookingId}`, receiptToken ? {
          headers: { "X-Workshop-Receipt-Token": receiptToken },
        } : {});
        if (!cancelled) setBooking(data);
        return data;
      } catch {
        if (!cancelled) {
          setBooking(null);
          setStatus("error");
          setErrorMessage("Booking not found");
        }
        return null;
      }
    };

    const handleVerified = async () => {
      const fresh = await fetchBooking();
      if (cancelled) return;
      clearPendingSession();
      setBooking(fresh);
      setStatus("success");
      trackPaidBooking(fresh);
    };

    const handleFailure = (nextStatus: "failed" | "error", nextMessage: string, clearSession = true) => {
      if (cancelled) return;
      if (clearSession) clearPendingSession();
      setStatus(nextStatus);
      setErrorMessage(nextMessage);
    };

    const verifyPayment = async () => {
      const freshBooking = await fetchBooking();
      if (!freshBooking || cancelled) return;

      if (freshBooking.payment_status === "paid") {
        clearPendingSession();
        setStatus("success");
        trackPaidBooking(freshBooking);
        return;
      }
      if (["failed", "cancelled"].includes(String(freshBooking.payment_status || ""))) {
        handleFailure("failed", "This workshop payment did not complete, so the booking was not confirmed.");
        return;
      }
      if (!merchantOrderId) {
        setStatus("processing");
        setMessage("Your workshop payment is still processing. We'll email you once it's confirmed.");
        return;
      }

      try {
        const result = await apiFetch<any>("/phonepe/verify-payment", {
          method: "POST",
          headers: verificationSecret
            ? { "X-Payment-Verification-Secret": verificationSecret }
            : {},
          body: JSON.stringify({ merchant_order_id: merchantOrderId }),
        });

        if (result.verified && result.booking_id === bookingId) {
          await handleVerified();
          return;
        }

        if (result.status === "FAILED") {
          handleFailure("failed", "Your workshop payment failed. No confirmed booking was created.");
          return;
        }

        if (["MISSING", "EXPIRED", "UNAVAILABLE"].includes(result.status)) {
          handleFailure("error", "This workshop payment session expired. Please start the booking again.");
          return;
        }

        setStatus("processing");
        let attempts = 0;
        pollIntervalId = window.setInterval(async () => {
          attempts += 1;
          if (attempts === 5 && !cancelled) {
            setMessage("This is taking a little longer than usual. We'll email you as soon as the workshop is confirmed.");
          }

          try {
            const pollResult = await apiFetch<any>("/phonepe/verify-payment", {
              method: "POST",
              headers: verificationSecret
                ? { "X-Payment-Verification-Secret": verificationSecret }
                : {},
              body: JSON.stringify({ merchant_order_id: merchantOrderId }),
            });

            if (pollResult.verified && pollResult.booking_id === bookingId) {
              stopPolling();
              await handleVerified();
              return;
            }

            if (pollResult.status === "FAILED") {
              stopPolling();
              handleFailure("failed", "Your workshop payment failed. No confirmed booking was created.");
              return;
            }

            if (["MISSING", "EXPIRED", "UNAVAILABLE"].includes(pollResult.status)) {
              stopPolling();
              handleFailure("error", "This workshop payment session expired. Please start the booking again.");
              return;
            }

            if (attempts >= MAX_POLL_ATTEMPTS) {
              stopPolling();
              handleFailure(
                "error",
                "Your workshop payment is still processing. If it succeeds, we'll email you shortly with the confirmed booking.",
                false,
              );
            }
          } catch {
            if (attempts >= MAX_POLL_ATTEMPTS) {
              stopPolling();
              handleFailure(
                "error",
                "We couldn't confirm this workshop payment yet. If it succeeds, we'll email you shortly.",
                false,
              );
            }
          }
        }, POLL_INTERVAL_MS);
      } catch {
        handleFailure("error", "We couldn't verify this workshop payment yet. Please check back shortly.");
      }
    };

    void verifyPayment();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bookingId, merchantOrderId, receiptToken, router.isReady, sensitiveQueryReady, verificationSecret]);

  if (!booking && status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!booking && status !== "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{errorMessage}</p>
        <Button asChild>
          <Link href="/workshops">Back to Workshops</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <section className="bg-rose-soft py-16 md:py-24">
        <div className="container mx-auto max-w-xl text-center">
          {status === "loading" || status === "processing" ? (
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <Loader2 className="mx-auto mb-6 h-20 w-20 animate-spin text-primary" />
              <h1 className="mb-3 font-serif text-2xl md:text-3xl">Confirming Your Workshop Booking</h1>
              <p className="mb-8 text-muted-foreground">{message}</p>
            </motion.div>
          ) : null}

          {status === "success" ? (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", duration: 0.5 }}>
              <CheckCircle2 className="mx-auto mb-6 h-20 w-20 text-emerald-500" />
              <h1 className="mb-3 font-serif text-2xl md:text-3xl">Workshop Booking Confirmed!</h1>
              <p className="mb-8 text-muted-foreground">
                Your payment was received successfully. We&apos;ll share scheduling details separately.
              </p>
            </motion.div>
          ) : null}

          {(status === "failed" || status === "error") ? (
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <XCircle className={`mx-auto mb-6 h-20 w-20 ${status === "failed" ? "text-red-500" : "text-amber-500"}`} />
              <h1 className="mb-3 font-serif text-2xl md:text-3xl">
                {status === "failed" ? "Workshop Payment Failed" : "Workshop Payment Still Processing"}
              </h1>
              <p className="mb-8 text-muted-foreground">{errorMessage}</p>
            </motion.div>
          ) : null}

          <div className="mb-8 space-y-4 rounded-2xl border border-border bg-card p-6 text-left">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Booking ID</p>
                <p className="font-mono font-medium">{booking.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Workshop</p>
                <p className="font-medium">{booking.workshop_title}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
                <p>{booking.full_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Team Size</p>
                <p>{booking.team_size}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment Status</p>
                <p className="capitalize">{String(booking.payment_status || "").replace(/_/g, " ")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Booking Status</p>
                <p className="capitalize">{String(booking.booking_status || "").replace(/_/g, " ")}</p>
              </div>
              {booking.preferred_date ? (
                <div>
                  <p className="text-xs text-muted-foreground">Preferred Date</p>
                  <p>{new Date(booking.preferred_date).toLocaleDateString("en-IN")}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-muted-foreground">Mode</p>
                <p>{booking.delivery_mode}</p>
              </div>
            </div>
            <div className="flex justify-between border-t border-border pt-3 font-semibold">
              <span>Total Amount</span>
              <span className="text-primary">{formatPrice(booking.total)}</span>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="hero" asChild>
              <Link href="/workshops">Explore More Workshops</Link>
            </Button>
            <Button variant="hero-outline" asChild>
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default WorkshopBookingConfirmation;
