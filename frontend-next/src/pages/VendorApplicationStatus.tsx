import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, CircleCheckBig, ShieldAlert } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Vendor, formatDate, validateVendorSignup } from "@/lib/vendor";
import { VendorApiError, vendorFetch } from "@/lib/vendor-api";
import { toast } from "sonner";

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
  agree_terms: true,
  confirm_gst: true,
};

const businessTypes = ["Wellness Brand", "Beauty", "Nutrition", "Personal Care", "Lifestyle", "Home Wellness", "Other"];

function formFromVendor(vendor: Vendor, password = "") {
  return {
    owner_name: vendor.owner_name || "",
    mobile: vendor.mobile || "",
    email: vendor.email || "",
    password,
    confirm_password: password,
    business_name: vendor.business_name || "",
    shop_name: vendor.shop_name || "",
    business_type: vendor.business_type || "",
    gstin: vendor.gstin || "",
    pan: vendor.pan || "",
    address: vendor.address || "",
    city: vendor.city || "",
    state: vendor.state || "",
    pincode: vendor.pincode || "",
    website: vendor.website || "",
    account_holder_name: vendor.bank_details?.account_holder_name || "",
    account_number: vendor.bank_details?.account_number || "",
    ifsc_code: vendor.bank_details?.ifsc_code || "",
    bank_name: vendor.bank_details?.bank_name || "",
    branch_name: vendor.bank_details?.branch_name || "",
    upi_id: vendor.bank_details?.upi_id || "",
    agree_terms: true,
    confirm_gst: true,
  };
}

const VendorApplicationStatus = () => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(initialState);

  useEffect(() => {
    if (!router.isReady) return;
    const nextEmail = typeof router.query.email === "string" ? router.query.email : "";
    if (nextEmail) {
      setEmail(nextEmail);
    }
  }, [router.isReady, router.query.email]);

  const statusTone = useMemo(() => {
    if (!vendor) return "";
    if (vendor.status === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (vendor.status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
    return "border-amber-200 bg-amber-50 text-amber-700";
  }, [vendor]);

  const update = (field: keyof typeof initialState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const checkStatus = async (e?: FormEvent) => {
    e?.preventDefault();
    try {
      setSubmitting(true);
      const data = await vendorFetch<{ vendor: Vendor }>("/vendors/application-status", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setVendor(data.vendor);
      setForm(formFromVendor(data.vendor, password));
      setEditing(false);
      toast.success("Application status loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load application status");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors = validateVendorSignup(form as unknown as Record<string, unknown>);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      setResubmitting(true);
      const data = await vendorFetch<{ vendor: Vendor; message: string }>("/vendors/application-status", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setVendor(data.vendor);
      setForm(formFromVendor(data.vendor, form.password));
      setEditing(false);
      toast.success(data.message || "Application updated");
    } catch (error) {
      if (error instanceof VendorApiError && error.data?.field_errors && typeof error.data.field_errors === "object" && !Array.isArray(error.data.field_errors)) {
        setErrors(error.data.field_errors as Record<string, string>);
      }
      toast.error(error instanceof Error ? error.message : "Could not resubmit application");
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(255,246,248,1),rgba(255,251,246,1))]">
      <Navbar />
      <section className="container mx-auto py-10 md:py-14">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-[0.9fr,1.1fr]">
          <div className="space-y-6">
            <div className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(248,215,223,0.92),rgba(253,233,213,0.92))] p-8 shadow-[0_20px_70px_rgba(188,118,144,0.15)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">Application tracker</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight">Track or update your vendor onboarding.</h1>
              <p className="mt-4 text-base leading-7 text-muted-foreground">Use your application email and password to check the current status, see admin notes, and resubmit details if something needs correction.</p>
            </div>

            <form onSubmit={checkStatus} className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-sm">
              <h2 className="font-serif text-2xl">Check application status</h2>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Application email</label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-2xl" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">Password</label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-2xl" />
                </div>
                <Button type="submit" className="h-12 rounded-2xl" disabled={submitting}>{submitting ? "Checking..." : "Load status"}</Button>
              </div>
            </form>

            {vendor ? (
              <div className={`rounded-[28px] border p-6 shadow-sm ${statusTone}`}>
                <div className="flex items-start gap-3">
                  {vendor.status === "verified" ? <CircleCheckBig className="mt-1 h-5 w-5" /> : <ShieldAlert className="mt-1 h-5 w-5" />}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em]">Current status</p>
                    <h2 className="mt-2 font-serif text-3xl capitalize">{vendor.status}</h2>
                    <p className="mt-3 text-sm">Created {formatDate(vendor.created_at)}{vendor.verified_at ? ` | Verified ${formatDate(vendor.verified_at)}` : ""}</p>
                    {vendor.admin_notes ? <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-sm">{vendor.admin_notes}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                      <span className={`rounded-full px-3 py-1 ${vendor.kyc_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>KYC {vendor.kyc_verified ? "verified" : "pending"}</span>
                      <span className={`rounded-full px-3 py-1 ${vendor.bank_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>Bank {vendor.bank_verified ? "verified" : "pending"}</span>
                    </div>
                    {vendor.status !== "verified" ? (
                      <Button type="button" variant="outline" className="mt-5 rounded-2xl" onClick={() => setEditing((prev) => !prev)}>
                        {editing ? "Hide resubmission form" : vendor.status === "rejected" ? "Edit and resubmit" : "Update application"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-[0_20px_70px_rgba(188,118,144,0.12)] md:p-8">
            {!vendor || !editing ? (
              <div className="flex min-h-[520px] items-center justify-center rounded-[28px] border border-dashed border-border bg-secondary/20 p-8 text-center text-muted-foreground">
                Load your application status to see onboarding details and, if needed, resubmit corrected business or bank information.
              </div>
            ) : (
              <form onSubmit={handleResubmit} className="space-y-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Resubmission</p>
                  <h2 className="mt-2 font-serif text-3xl">Update onboarding details</h2>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {([["Owner Full Name", "owner_name"], ["Mobile Number", "mobile"], ["Email Address", "email"], ["Password", "password"], ["Confirm Password", "confirm_password"]] as Array<[string, keyof typeof initialState]>).map(([label, key]) => (
                    <div key={key} className={key === "owner_name" ? "md:col-span-2" : ""}>
                      <label className="mb-2 block text-sm font-medium">{label}</label>
                      <Input type={key.toLowerCase().includes("password") ? "password" : "text"} value={String(form[key])} onChange={(e) => update(key, e.target.value)} className="h-12 rounded-2xl" readOnly={key === "email"} />
                      {errors[key] ? <p className="mt-1 text-xs text-destructive">{errors[key]}</p> : null}
                    </div>
                  ))}
                  <div><label className="mb-2 block text-sm font-medium">Business Name</label><Input value={form.business_name} onChange={(e) => update("business_name", e.target.value)} className="h-12 rounded-2xl" />{errors.business_name ? <p className="mt-1 text-xs text-destructive">{errors.business_name}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Shop Name</label><Input value={form.shop_name} onChange={(e) => update("shop_name", e.target.value)} className="h-12 rounded-2xl" />{errors.shop_name ? <p className="mt-1 text-xs text-destructive">{errors.shop_name}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Business Type</label><select value={form.business_type} onChange={(e) => update("business_type", e.target.value)} className="h-12 w-full rounded-2xl border border-border bg-white px-3 text-sm"><option value="">Select</option>{businessTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>{errors.business_type ? <p className="mt-1 text-xs text-destructive">{errors.business_type}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Website / Instagram</label><Input value={form.website} onChange={(e) => update("website", e.target.value)} className="h-12 rounded-2xl" /></div>
                  <div><label className="mb-2 block text-sm font-medium">GSTIN</label><Input value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())} className="h-12 rounded-2xl" />{errors.gstin ? <p className="mt-1 text-xs text-destructive">{errors.gstin}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">PAN</label><Input value={form.pan} onChange={(e) => update("pan", e.target.value.toUpperCase())} className="h-12 rounded-2xl" />{errors.pan ? <p className="mt-1 text-xs text-destructive">{errors.pan}</p> : null}</div>
                  <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Registered Address</label><Textarea value={form.address} onChange={(e) => update("address", e.target.value)} className="min-h-[110px] rounded-2xl" />{errors.address ? <p className="mt-1 text-xs text-destructive">{errors.address}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">City</label><Input value={form.city} onChange={(e) => update("city", e.target.value)} className="h-12 rounded-2xl" />{errors.city ? <p className="mt-1 text-xs text-destructive">{errors.city}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">State</label><Input value={form.state} onChange={(e) => update("state", e.target.value)} className="h-12 rounded-2xl" />{errors.state ? <p className="mt-1 text-xs text-destructive">{errors.state}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Pincode</label><Input value={form.pincode} onChange={(e) => update("pincode", e.target.value)} className="h-12 rounded-2xl" />{errors.pincode ? <p className="mt-1 text-xs text-destructive">{errors.pincode}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Account Holder Name</label><Input value={form.account_holder_name} onChange={(e) => update("account_holder_name", e.target.value)} className="h-12 rounded-2xl" />{errors.account_holder_name ? <p className="mt-1 text-xs text-destructive">{errors.account_holder_name}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Account Number</label><Input value={form.account_number} onChange={(e) => update("account_number", e.target.value)} className="h-12 rounded-2xl" />{errors.account_number ? <p className="mt-1 text-xs text-destructive">{errors.account_number}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">IFSC Code</label><Input value={form.ifsc_code} onChange={(e) => update("ifsc_code", e.target.value.toUpperCase())} className="h-12 rounded-2xl" />{errors.ifsc_code ? <p className="mt-1 text-xs text-destructive">{errors.ifsc_code}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Bank Name</label><Input value={form.bank_name} onChange={(e) => update("bank_name", e.target.value)} className="h-12 rounded-2xl" />{errors.bank_name ? <p className="mt-1 text-xs text-destructive">{errors.bank_name}</p> : null}</div>
                  <div><label className="mb-2 block text-sm font-medium">Branch Name</label><Input value={form.branch_name} onChange={(e) => update("branch_name", e.target.value)} className="h-12 rounded-2xl" /></div>
                  <div><label className="mb-2 block text-sm font-medium">UPI ID</label><Input value={form.upi_id} onChange={(e) => update("upi_id", e.target.value)} className="h-12 rounded-2xl" /></div>
                </div>

                <div className="space-y-3 rounded-3xl border border-border/70 bg-secondary/20 p-5">
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.confirm_gst} onChange={(e) => update("confirm_gst", e.target.checked)} className="mt-1" /><span>I confirm that GST and PAN details submitted above are correct and belong to my business.</span></label>
                  {errors.confirm_gst ? <p className="text-xs text-destructive">{errors.confirm_gst}</p> : null}
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.agree_terms} onChange={(e) => update("agree_terms", e.target.checked)} className="mt-1" /><span>I agree that Pink Paisa will hold buyer money until delivery is completed and the return period is over, and then release vendor payout after deducting the commission agreed for my account.</span></label>
                  {errors.agree_terms ? <p className="text-xs text-destructive">{errors.agree_terms}</p> : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" className="rounded-2xl" disabled={resubmitting}>{resubmitting ? "Submitting..." : "Resubmit application"}</Button>
                  <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default VendorApplicationStatus;
