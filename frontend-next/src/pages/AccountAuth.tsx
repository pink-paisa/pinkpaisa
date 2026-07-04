import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCustomerAuth } from "@/contexts/CustomerAuthContext";
import { API_URL } from "@/lib/api";
import { toast } from "sonner";
import { motion } from "framer-motion";

const AccountAuth = () => {
  const router = useRouter();
  const { login, register, user } = useCustomerAuth();
  const redirectTo = useMemo(() => {
    const redirect = router.query.redirect;
    return typeof redirect === "string" && redirect ? redirect : "/account";
  }, [router.query.redirect]);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [loading, setLoading] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    full_name: "",
    email: "",
    password: "",
    phone: "",
  });

  useEffect(() => {
    if (!user || !router.isReady) return;
    router.replace(redirectTo);
  }, [redirectTo, router, user]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.verified === "1") {
      toast.success("Email verified. You can continue shopping and recover your account if needed.");
    }
    if (router.query.verified === "0") {
      toast.error("That verification link is invalid or expired.");
    }
  }, [router.isReady, router.query.verified]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await login(loginForm.email, loginForm.password);
      toast.success("Welcome back");
      router.replace(redirectTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await register(signupForm);
      toast.success("Account created. Check your inbox to verify your email.");
      router.replace(redirectTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!loginForm.email.trim()) {
      toast.error("Enter your account email first");
      return;
    }
    try {
      setResetSubmitting(true);
      const response = await fetch(`${API_URL}/auth/password/forgot`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginForm.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Could not request password reset");
      }
      toast.success(data.message || "If that account exists, a reset link has been sent.");
      if (data.reset_url) {
        toast.info(`Dev preview: ${data.reset_url}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request password reset");
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto grid gap-8 py-10 md:py-16 lg:grid-cols-[0.95fr,1.05fr]">
        <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,#fff8fb,#fff2ea)] p-8 shadow-sm md:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Pink Paisa account</p>
          <h1 className="mt-4 font-serif text-4xl leading-tight">Sign in to continue checkout, save favourites, and manage orders.</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
            Your account gives you order history, profile management, wallet balance, and wishlist access across the Pink Paisa storefront.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 text-sm">
              <p className="font-medium">Order history</p>
              <p className="mt-1 text-muted-foreground">Track every order, status update, and delivery assignment.</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 text-sm">
              <p className="font-medium">Wishlist + wallet</p>
              <p className="mt-1 text-muted-foreground">Save favourite products and use wallet balance at checkout.</p>
            </div>
          </div>
        </section>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="inline-flex rounded-2xl border border-border bg-secondary/40 p-1">
            <button onClick={() => setMode("signup")} className={`rounded-xl px-4 py-2 text-sm font-medium ${mode === "signup" ? "bg-primary text-primary-foreground" : "text-foreground"}`}>Create account</button>
            <button onClick={() => setMode("login")} className={`rounded-xl px-4 py-2 text-sm font-medium ${mode === "login" ? "bg-primary text-primary-foreground" : "text-foreground"}`}>Login</button>
          </div>

          {mode === "signup" ? (
            <form onSubmit={handleSignup} className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Full name</Label><Input value={signupForm.full_name} onChange={(e) => setSignupForm((prev) => ({ ...prev, full_name: e.target.value }))} required /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={signupForm.email} onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))} required /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={signupForm.phone} onChange={(e) => setSignupForm((prev) => ({ ...prev, phone: e.target.value }))} required /></div>
              <div className="space-y-2"><Label>Password</Label><Input type="password" value={signupForm.password} onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))} required /></div>
              <div className="sm:col-span-2 rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                Use at least 10 characters with at least one letter and one number. Shipping address can be added later at checkout.
              </div>
              <div className="sm:col-span-2"><Button type="submit" disabled={loading} className="w-full rounded-2xl">{loading ? "Creating..." : "Create account"}</Button></div>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={loginForm.email} onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))} required /></div>
              <div className="space-y-2"><Label>Password</Label><Input type="password" value={loginForm.password} onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))} required /></div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button type="button" onClick={handleForgotPassword} disabled={resetSubmitting} className="font-medium text-primary">
                  {resetSubmitting ? "Sending..." : "Forgot password?"}
                </button>
                <span className="text-muted-foreground">We&apos;ll email a secure reset link.</span>
              </div>
              <Button type="submit" disabled={loading} className="w-full rounded-2xl">{loading ? "Signing in..." : "Login"}</Button>
            </form>
          )}
        </motion.section>
      </div>
      <Footer />
    </div>
  );
};

export default AccountAuth;
