import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePinkPagesCategories } from "@/hooks/usePinkPages";
import { toast } from "sonner";

const PinkPagesSubmit = () => {
  const router = useRouter();
  const plan = typeof router.query.plan === "string" ? router.query.plan : "free";
  const { data: categories = [] } = usePinkPagesCategories(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    business_name: "",
    category_id: "",
    contact_person: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    short_description: "",
    website: "",
  });

  const heading = useMemo(
    () => (plan === "premium" ? "Apply for a Premium Pink Pages Listing" : "Submit Your Business to Pink Pages"),
    [plan],
  );

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.business_name || !form.phone || !form.email) {
      toast.error("Business name, phone, and email are required");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/pink-pages/listings/submit", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          category_id: form.category_id || null,
          short_description: form.short_description || null,
          website: form.website || null,
          city: form.city || null,
          state: form.state || null,
        }),
      });
      setSubmitted(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit your listing");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="bg-rose-soft py-14 md:py-20">
        <div className="container mx-auto max-w-2xl">
          <Link
            href="/pink-pages"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Pink Pages
          </Link>

          <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm md:p-8">
            {submitted ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-500" />
                <h1 className="mb-2 font-serif text-3xl">Submission received</h1>
                <p className="mb-6 text-muted-foreground">
                  Thanks for submitting your business. Our team will review it before it goes live.
                </p>
                <Button asChild>
                  <Link href="/pink-pages">Browse Pink Pages</Link>
                </Button>
              </div>
            ) : (
              <>
                <h1 className="mb-2 font-serif text-3xl">{heading}</h1>
                <p className="mb-8 text-muted-foreground">
                  Share your business details below. Every submission is reviewed before it appears publicly.
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Business name *</Label>
                      <Input value={form.business_name} onChange={(e) => handleChange("business_name", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Contact person</Label>
                      <Input value={form.contact_person} onChange={(e) => handleChange("contact_person", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Select value={form.category_id || "none"} onValueChange={(value) => handleChange("category_id", value === "none" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No category</SelectItem>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email *</Label>
                      <Input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone *</Label>
                      <Input value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <Input value={form.city} onChange={(e) => handleChange("city", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>State</Label>
                      <Input value={form.state} onChange={(e) => handleChange("state", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Website</Label>
                      <Input value={form.website} onChange={(e) => handleChange("website", e.target.value)} placeholder="https://example.com" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Short description</Label>
                      <Textarea
                        rows={4}
                        value={form.short_description}
                        onChange={(e) => handleChange("short_description", e.target.value)}
                        placeholder="Tell people what your business offers."
                      />
                    </div>
                  </div>

                  <Button type="submit" size="xl" className="w-full" disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit for Review"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Your listing will stay private until the Pink Paisa team reviews it.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default PinkPagesSubmit;
