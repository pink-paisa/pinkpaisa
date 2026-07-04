import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customerFetch } from "@/contexts/CustomerAuthContext";
import { toast } from "sonner";

const AccountResetPassword = () => {
  const router = useRouter();
  const token = useMemo(() => (typeof router.query.token === "string" ? router.query.token : ""), [router.query.token]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      toast.error("Missing reset token");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      setSubmitting(true);
      await customerFetch("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      toast.success("Password reset successful");
      void router.replace("/account");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto max-w-lg py-16">
        <div className="rounded-[32px] border border-border bg-card p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Password reset</p>
          <h1 className="mt-2 font-serif text-3xl">Choose a new password</h1>
          <p className="mt-3 text-sm text-muted-foreground">Use at least 10 characters with at least one letter and one number.</p>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label>New password</Label>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Confirm password</Label>
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </div>
            <Button type="submit" disabled={submitting} className="w-full rounded-2xl">
              {submitting ? "Resetting..." : "Reset password"}
            </Button>
          </form>
          <div className="mt-4 text-sm text-muted-foreground">
            <Link href="/account/auth" className="font-medium text-primary">Back to account login</Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default AccountResetPassword;
