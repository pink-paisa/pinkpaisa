import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Building2, CircleCheckBig, Landmark, Store } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { API_URL } from "@/lib/api";
import { validateVendorSignup } from "@/lib/vendor";

const businessTypes = ["Wellness Brand", "Beauty", "Nutrition", "Personal Care", "Lifestyle", "Home Wellness", "Other"];

const initialState = {
  owner_name: "",
  mobile: "",
  email: "",
  password: "",
  confirm_password: "",
  business_name: "",
  shop_name: "",
  business_type: "",
  gstin: "",
  pan: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  website: "",
  account_holder_name: "",
  account_number: "",
  ifsc_code: "",
  bank_name: "",
  branch_name: "",
  upi_id: "",
  agree_terms: false,
  confirm_gst: false,
};

const VendorSignup = () => {
  const [form, setForm] = useState(initialState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof typeof initialState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors = validateVendorSignup(form as any);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_URL}/vendors/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.errors) setErrors(data.errors);
        throw new Error(data.message || "Could not submit application");
      }
      setSubmitted(true);
      toast.success("Application submitted successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit application");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = "rounded-2xl border-border/80 bg-white/90 h-12";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(255,246,248,1),rgba(255,251,246,1))]">
      <Navbar />
      <section className="container mx-auto py-10 md:py-14">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-[0.92fr,1.08fr] xl:gap-10">
          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(248,215,223,0.92),rgba(253,233,213,0.92))] p-8 shadow-[0_20px_70px_rgba(188,118,144,0.15)]">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/80 text-primary shadow-sm"><Store className="h-6 w-6" /></div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">Vendor onboarding</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight md:text-5xl">Become a verified Pink Paisa partner.</h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">Submit business, KYC, and bank payout details in one flow. You&apos;ll also verify your email while admin reviews your application.</p>
              <div className="mt-8 space-y-3">
                {[
                  "Step 1 | Submit business + KYC details",
                  "Step 2 | Submit bank payout details",
                  "Step 3 | Admin verifies KYC and bank details",
                  "Step 4 | Vendor is ready to onboard",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-3">
                    <BadgeCheck className="mt-0.5 h-5 w-5 text-primary" />
                    <span className="text-sm text-foreground/90">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-soft text-primary"><Building2 className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-serif text-2xl">What happens next?</h2>
                  <p className="text-sm text-muted-foreground">Only two verification steps are needed for onboarding.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {[
                  ["KYC Verified", "GST, PAN and business identity are validated by admin."],
                  ["Bank Details Verified", "Payout account is verified before any release to vendor."],
                ].map(([step, desc], index) => (
                  <div key={step} className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step {index + 1}</p>
                    <p className="mt-2 font-semibold">{step}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-[0_20px_70px_rgba(188,118,144,0.12)] md:p-8">
            {submitted ? (
              <div className="flex min-h-[600px] flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CircleCheckBig className="h-10 w-10" /></div>
                <h2 className="mt-6 font-serif text-4xl">Application submitted</h2>
                <p className="mt-4 max-w-md text-muted-foreground">Your vendor profile and bank payout details were created with pending status. Check your inbox to verify the email address while admin reviews KYC and bank details.</p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Button className="rounded-2xl" asChild><Link href="/vendor/login">Go to vendor login</Link></Button>
                  <Button variant="outline" className="rounded-2xl" asChild><Link href={`/vendor/application?email=${encodeURIComponent(form.email)}`}>Track application</Link></Button>
                  <Button variant="outline" className="rounded-2xl" asChild><Link href="/">Back to homepage</Link></Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor sign up</p>
                  <h2 className="mt-2 font-serif text-3xl">Business, KYC and bank payout setup</h2>
                  <p className="mt-2 text-sm text-muted-foreground">All mandatory fields are validated before submission. This form is optimized for desktop, tablet, and mobile.</p>
                </div>

                <section className="space-y-4">
                  <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-soft text-sm font-semibold text-primary">1</div><h3 className="font-semibold">Account details</h3></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {([["Owner Full Name", "owner_name"], ["Mobile Number", "mobile"], ["Email Address", "email"], ["Password", "password"], ["Confirm Password", "confirm_password"]] as Array<[string, keyof typeof initialState]>).map(([label, key]) => (
                      <div key={key} className={key === "owner_name" ? "md:col-span-2" : ""}>
                        <label className="mb-2 block text-sm font-medium">{label}</label>
                        <Input type={key.toLowerCase().includes("password") ? "password" : "text"} value={String(form[key])} onChange={(e) => update(key, e.target.value)} className={fieldClass} />
                        {errors[key] && <p className="mt-1 text-xs text-destructive">{errors[key]}</p>}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-soft text-sm font-semibold text-primary">2</div><h3 className="font-semibold">Business + KYC details</h3></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><label className="mb-2 block text-sm font-medium">Legal Business Name</label><Input value={form.business_name} onChange={(e) => update("business_name", e.target.value)} className={fieldClass} />{errors.business_name && <p className="mt-1 text-xs text-destructive">{errors.business_name}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Shop / Display Name</label><Input value={form.shop_name} onChange={(e) => update("shop_name", e.target.value)} className={fieldClass} />{errors.shop_name && <p className="mt-1 text-xs text-destructive">{errors.shop_name}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Business Type</label><select value={form.business_type} onChange={(e) => update("business_type", e.target.value)} className={`${fieldClass} w-full px-3 text-sm`}><option value="">Select</option>{businessTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>{errors.business_type && <p className="mt-1 text-xs text-destructive">{errors.business_type}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Website / Instagram</label><Input value={form.website} onChange={(e) => update("website", e.target.value)} className={fieldClass} /></div>
                    <div><label className="mb-2 block text-sm font-medium">GSTIN</label><Input value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())} className={fieldClass} />{errors.gstin && <p className="mt-1 text-xs text-destructive">{errors.gstin}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">PAN</label><Input value={form.pan} onChange={(e) => update("pan", e.target.value.toUpperCase())} className={fieldClass} />{errors.pan && <p className="mt-1 text-xs text-destructive">{errors.pan}</p>}</div>
                    <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Registered Address</label><Textarea value={form.address} onChange={(e) => update("address", e.target.value)} className="min-h-[110px] rounded-2xl border-border/80 bg-white/90" />{errors.address && <p className="mt-1 text-xs text-destructive">{errors.address}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">City</label><Input value={form.city} onChange={(e) => update("city", e.target.value)} className={fieldClass} />{errors.city && <p className="mt-1 text-xs text-destructive">{errors.city}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">State</label><Input value={form.state} onChange={(e) => update("state", e.target.value)} className={fieldClass} />{errors.state && <p className="mt-1 text-xs text-destructive">{errors.state}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Pincode</label><Input value={form.pincode} onChange={(e) => update("pincode", e.target.value)} className={fieldClass} />{errors.pincode && <p className="mt-1 text-xs text-destructive">{errors.pincode}</p>}</div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-soft text-sm font-semibold text-primary">3</div><h3 className="font-semibold">Bank payout details</h3></div>
                  <div className="rounded-3xl border border-border/70 bg-secondary/25 p-4 text-sm text-muted-foreground"><div className="flex items-center gap-2 font-medium text-foreground"><Landmark className="h-4 w-4 text-primary" /> Bank payout setup</div><p className="mt-2">Pink Paisa receives buyer payment first. Payout to the vendor happens only after successful delivery and the return window is over. Pink Paisa deducts the commission agreed for your account and releases the remaining amount to the bank account entered below.</p></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><label className="mb-2 block text-sm font-medium">Account Holder Name</label><Input value={form.account_holder_name} onChange={(e) => update("account_holder_name", e.target.value)} className={fieldClass} />{errors.account_holder_name && <p className="mt-1 text-xs text-destructive">{errors.account_holder_name}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Account Number</label><Input value={form.account_number} onChange={(e) => update("account_number", e.target.value)} className={fieldClass} />{errors.account_number && <p className="mt-1 text-xs text-destructive">{errors.account_number}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">IFSC Code</label><Input value={form.ifsc_code} onChange={(e) => update("ifsc_code", e.target.value.toUpperCase())} className={fieldClass} />{errors.ifsc_code && <p className="mt-1 text-xs text-destructive">{errors.ifsc_code}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Bank Name</label><Input value={form.bank_name} onChange={(e) => update("bank_name", e.target.value)} className={fieldClass} />{errors.bank_name && <p className="mt-1 text-xs text-destructive">{errors.bank_name}</p>}</div>
                    <div><label className="mb-2 block text-sm font-medium">Branch Name</label><Input value={form.branch_name} onChange={(e) => update("branch_name", e.target.value)} className={fieldClass} /></div>
                    <div><label className="mb-2 block text-sm font-medium">UPI ID (optional)</label><Input value={form.upi_id} onChange={(e) => update("upi_id", e.target.value)} className={fieldClass} /></div>
                  </div>
                </section>

                <section className="space-y-4 rounded-3xl border border-border/70 bg-secondary/20 p-5">
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.confirm_gst} onChange={(e) => update("confirm_gst", e.target.checked)} className="mt-1" /><span>I confirm that GST and PAN details submitted above are correct and belong to my business.</span></label>
                  {errors.confirm_gst && <p className="text-xs text-destructive">{errors.confirm_gst}</p>}
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.agree_terms} onChange={(e) => update("agree_terms", e.target.checked)} className="mt-1" /><span>I agree that Pink Paisa will hold buyer money until delivery is completed and the return period is over, and then release vendor payout after deducting the commission agreed for my account.</span></label>
                  {errors.agree_terms && <p className="text-xs text-destructive">{errors.agree_terms}</p>}
                </section>

                <div className="flex flex-wrap items-center gap-3"><Button type="submit" className="h-12 rounded-2xl px-8" disabled={submitting}>{submitting ? "Submitting..." : "Submit vendor application"}</Button><Button variant="outline" type="button" className="h-12 rounded-2xl" asChild><Link href="/vendor/login">Already verified? Login</Link></Button></div>
              </form>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default VendorSignup;
