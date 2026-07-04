import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

const AdminResetPassword = () => {
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
      await apiFetch("/auth/admin/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      toast.success("Admin password reset successful");
      void router.replace("/admin");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset admin password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Admin password reset</p>
        <h1 className="mt-2 text-center font-serif text-3xl">Choose a new password</h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">Use at least 10 characters with at least one letter and one number.</p>
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
            {submitting ? "Resetting..." : "Reset admin password"}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/admin" className="font-medium text-primary">Back to admin login</Link>
        </div>
      </div>
    </div>
  );
};

export default AdminResetPassword;
