import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, ShieldAlert, Store } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import { Vendor } from "@/lib/vendor";
import { VendorApiError, vendorFetch } from "@/lib/vendor-api";
import { toast } from "sonner";

const VendorLogin = () => {
  const { vendor, login } = useVendorAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [applicationVendor, setApplicationVendor] = useState<Vendor | null>(null);
  const redirectTo = typeof router.query.redirect === "string" ? router.query.redirect : "/vendor/dashboard";

  useEffect(() => {
    if (vendor) {
      void router.replace(redirectTo);
    }
  }, [redirectTo, router, vendor]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.verified === "1") {
      toast.success("Vendor email verified. You can continue with login.");
    }
    if (router.query.verified === "0") {
      toast.error("That vendor verification link is invalid or expired.");
    }
  }, [router.isReady, router.query.verified]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setApplicationVendor(null);
      await login(email, password);
      toast.success("Vendor login successful");
      await router.replace(redirectTo);
    } catch (error) {
      if (error instanceof VendorApiError && error.data?.vendor) {
        setApplicationVendor(error.data.vendor as Vendor);
      }
      toast.error(error instanceof Error ? error.message : "Vendor login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      toast.error("Enter your vendor email first");
      return;
    }
    try {
      setResetSubmitting(true);
      const response = await vendorFetch<{ message: string; reset_url?: string }>("/vendors/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      toast.success(response.message || "If that account exists, a reset link has been sent.");
      if (response.reset_url) {
        toast.info(`Dev preview: ${response.reset_url}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start password reset");
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(255,245,248,1),rgba(255,251,246,1))]">
      <Navbar />
      <section className="container mx-auto py-12 md:py-16">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.95fr,1.05fr]">
          <div className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(248,215,223,0.92),rgba(253,233,213,0.92))] p-8 shadow-[0_24px_70px_rgba(188,118,144,0.16)]">
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
            <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-3xl bg-white/85 text-primary shadow-sm">
              <Store className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor portal</p>
            <h1 className="mt-3 font-serif text-4xl leading-tight">Access your verified seller dashboard.</h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Only admin-verified vendors can sign in. Pending applications remain blocked until approval.
            </p>
          </div>

          <div className="rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-[0_20px_70px_rgba(188,118,144,0.12)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor login</p>
            <h2 className="mt-2 font-serif text-3xl">Sign in</h2>
            <p className="mt-2 text-sm text-muted-foreground">Pending or rejected vendors will see the correct access message.</p>

            <form onSubmit={handleLogin} className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium">Email address</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-2xl bg-white/90" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-2xl bg-white/90" />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button type="button" onClick={() => setShowReset((current) => !current)} className="font-medium text-primary">
                  {showReset ? "Hide reset help" : "Forgot password?"}
                </button>
                <button type="button" onClick={handlePasswordReset} disabled={resetSubmitting} className="text-muted-foreground hover:text-foreground">
                  {resetSubmitting ? "Sending..." : "Email reset link"}
                </button>
              </div>
              {showReset ? (
                <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4 text-sm text-muted-foreground">
                  Use the vendor email linked to your application. We&apos;ll send a password reset link there if the account exists.
                </div>
              ) : null}
              <Button type="submit" className="h-12 w-full rounded-2xl" disabled={submitting}>
                {submitting ? "Signing in..." : "Access vendor dashboard"}
              </Button>
            </form>

            <div className="mt-6 rounded-3xl border border-border/70 bg-secondary/30 p-5 text-sm text-muted-foreground">
              New seller? <Link href="/vendor/signup" className="font-medium text-primary">Submit your application</Link>
            </div>
            {applicationVendor ? (
              <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4" />
                  <div>
                    <p className="font-medium capitalize">Application status: {applicationVendor.status}</p>
                    <p className="mt-2">KYC: {applicationVendor.kyc_verified ? "verified" : "pending"} | Bank: {applicationVendor.bank_verified ? "verified" : "pending"}</p>
                    {applicationVendor.admin_notes ? <p className="mt-2">{applicationVendor.admin_notes}</p> : null}
                    <div className="mt-4">
                      <Link href={`/vendor/application?email=${encodeURIComponent(email)}`} className="font-medium text-primary">Track or update application</Link>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default VendorLogin;
