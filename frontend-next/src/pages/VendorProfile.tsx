import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Landmark, Mail, MapPin, ShieldCheck, Store, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import { Vendor, VendorKycDocuments } from "@/lib/vendor";
import { uploadVendorImage, vendorFetch } from "@/lib/vendor-api";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import VendorPayoutPauseBanner from "@/components/vendor/VendorPayoutPauseBanner";

type BusinessForm = {
  business_name: string;
  shop_name: string;
  business_type: string;
  gstin: string;
  pan: string;
  website: string;
};

type ContactForm = {
  owner_name: string;
  mobile: string;
  email: string;
};

type AddressForm = {
  address: string;
  city: string;
  state: string;
  pincode: string;
};

type BankForm = {
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  bank_name: string;
  branch_name: string;
  upi_id: string;
};

const businessTypes = ["Wellness Brand", "Beauty", "Nutrition", "Personal Care", "Lifestyle", "Home Wellness", "Other"];

const toBusinessForm = (vendor: Vendor | null): BusinessForm => ({
  business_name: vendor?.business_name || "",
  shop_name: vendor?.shop_name || "",
  business_type: vendor?.business_type || "",
  gstin: vendor?.gstin || "",
  pan: vendor?.pan || "",
  website: vendor?.website || "",
});

const toContactForm = (vendor: Vendor | null): ContactForm => ({
  owner_name: vendor?.owner_name || "",
  mobile: vendor?.mobile || "",
  email: vendor?.email || "",
});

const toAddressForm = (vendor: Vendor | null): AddressForm => ({
  address: vendor?.address || "",
  city: vendor?.city || "",
  state: vendor?.state || "",
  pincode: vendor?.pincode || "",
});

const toBankForm = (vendor: Vendor | null): BankForm => ({
  account_holder_name: vendor?.bank_details?.account_holder_name || "",
  account_number: vendor?.bank_details?.account_number || "",
  ifsc_code: vendor?.bank_details?.ifsc_code || "",
  bank_name: vendor?.bank_details?.bank_name || "",
  branch_name: vendor?.bank_details?.branch_name || "",
  upi_id: vendor?.bank_details?.upi_id || "",
});

const KYC_ROWS: Array<{ kind: "pan" | "gst" | "aadhaar" | "cheque"; label: string; field: keyof VendorKycDocuments }> = [
  { kind: "pan", label: "PAN card", field: "pan_url" },
  { kind: "gst", label: "GST certificate", field: "gst_certificate_url" },
  { kind: "aadhaar", label: "Aadhaar document", field: "aadhaar_url" },
  { kind: "cheque", label: "Cancelled cheque", field: "cancelled_cheque_url" },
];

const VendorProfile = () => {
  const { vendor, refreshVendor } = useVendorAuth();
  const [businessForm, setBusinessForm] = useState<BusinessForm>(() => toBusinessForm(vendor));
  const [contactForm, setContactForm] = useState<ContactForm>(() => toContactForm(vendor));
  const [addressForm, setAddressForm] = useState<AddressForm>(() => toAddressForm(vendor));
  const [bankForm, setBankForm] = useState<BankForm>(() => toBankForm(vendor));
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  useEffect(() => {
    setBusinessForm(toBusinessForm(vendor));
    setContactForm(toContactForm(vendor));
    setAddressForm(toAddressForm(vendor));
    setBankForm(toBankForm(vendor));
  }, [vendor]);

  const verificationChips = useMemo(
    () => [
      { label: vendor?.email_verified ? "Email verified" : "Email verification pending", tone: vendor?.email_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700" },
      { label: vendor?.kyc_verified ? "KYC verified" : "KYC review pending", tone: vendor?.kyc_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700" },
      { label: vendor?.bank_verified ? "Bank verified" : "Bank verification pending", tone: vendor?.bank_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700" },
    ],
    [vendor?.bank_verified, vendor?.email_verified, vendor?.kyc_verified],
  );

  const saveSection = async <T,>(sectionKey: string, path: string, payload: T, successMessage?: string) => {
    try {
      setSavingSection(sectionKey);
      const response = await vendorFetch<{ vendor: Vendor; message?: string }>(path, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await refreshVendor();
      toast.success(response.message || successMessage || "Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this section");
    } finally {
      setSavingSection(null);
    }
  };

  const handleKycFileUpload = async (kind: "pan" | "gst" | "aadhaar" | "cheque", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadingKind(kind);
      const upload = await uploadVendorImage(file);
      const response = await vendorFetch<{ vendor: Vendor; message?: string }>("/vendors/me/kyc-documents", {
        method: "POST",
        body: JSON.stringify({ kind, url: upload.url }),
      });
      await refreshVendor();
      toast.success(response.message || "KYC document uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload KYC document");
    } finally {
      setUploadingKind(null);
      event.target.value = "";
    }
  };

  const removeKycDocument = async (kind: "pan" | "gst" | "aadhaar" | "cheque") => {
    try {
      setUploadingKind(kind);
      const response = await vendorFetch<{ vendor: Vendor; message?: string }>(`/vendors/me/kyc-documents/${kind}`, {
        method: "DELETE",
      });
      await refreshVendor();
      toast.success(response.message || "KYC document removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove KYC document");
    } finally {
      setUploadingKind(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-[#f5dde5] bg-[linear-gradient(135deg,#fff0f2_0%,#fde8ec_55%,#fdf0e8_100%)] p-6 shadow-[0_24px_60px_rgba(186,131,149,0.10)] md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor self-service</p>
            <h2 className="mt-2 font-serif text-3xl">Business profile, bank, and KYC</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Keep your shop details accurate, rotate payout bank details without emailing admin, and upload compliance documents in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <VendorStatusBadge status={vendor?.status || "verified"} />
            {verificationChips.map((chip) => (
              <span key={chip.label} className={`rounded-full px-3 py-1 text-xs font-medium ${chip.tone}`}>{chip.label}</span>
            ))}
          </div>
        </div>
      </section>

      <VendorPayoutPauseBanner vendor={vendor} />

      <Tabs defaultValue="business" className="space-y-6">
        <TabsList className="h-auto flex-wrap rounded-2xl bg-white/80 p-1">
          <TabsTrigger value="business" className="rounded-xl px-4 py-2">Business</TabsTrigger>
          <TabsTrigger value="contact" className="rounded-xl px-4 py-2">Contact</TabsTrigger>
          <TabsTrigger value="address" className="rounded-xl px-4 py-2">Address</TabsTrigger>
          <TabsTrigger value="bank" className="rounded-xl px-4 py-2">Bank</TabsTrigger>
          <TabsTrigger value="kyc" className="rounded-xl px-4 py-2">KYC Docs</TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
            <div className="flex items-center gap-3">
              <Store className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-serif text-2xl">Business details</h3>
                <p className="text-sm text-muted-foreground">Your customer-facing store identity and seller-of-record business details.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Business name</Label>
                <Input value={businessForm.business_name} onChange={(event) => setBusinessForm((current) => ({ ...current, business_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Shop name</Label>
                <Input value={businessForm.shop_name} onChange={(event) => setBusinessForm((current) => ({ ...current, shop_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Business type</Label>
                <select value={businessForm.business_type} onChange={(event) => setBusinessForm((current) => ({ ...current, business_type: event.target.value }))} className="mt-2 h-12 w-full rounded-2xl border border-border bg-white px-3 text-sm">
                  <option value="">Select</option>
                  {businessTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Website / Instagram</Label>
                <Input value={businessForm.website} onChange={(event) => setBusinessForm((current) => ({ ...current, website: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>GSTIN</Label>
                <Input value={businessForm.gstin} disabled className="mt-2 h-12 rounded-2xl" />
                <p className="mt-1 text-xs text-muted-foreground">GSTIN stays locked here once onboarding is approved.</p>
              </div>
              <div>
                <Label>PAN</Label>
                <Input value={businessForm.pan} disabled className="mt-2 h-12 rounded-2xl" />
                <p className="mt-1 text-xs text-muted-foreground">PAN stays locked here once onboarding is approved.</p>
              </div>
            </div>
            <div className="mt-6">
              <Button className="rounded-2xl" disabled={savingSection === "business"} onClick={() => saveSection("business", "/vendors/me/business", businessForm, "Business profile updated")}>
                {savingSection === "business" ? "Saving..." : "Save business details"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="contact">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-serif text-2xl">Contact details</h3>
                <p className="text-sm text-muted-foreground">Keep owner and communication details current. Changing email triggers re-verification.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Owner name</Label>
                <Input value={contactForm.owner_name} onChange={(event) => setContactForm((current) => ({ ...current, owner_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={contactForm.mobile} onChange={(event) => setContactForm((current) => ({ ...current, mobile: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
            </div>
            <div className="mt-6">
              <Button className="rounded-2xl" disabled={savingSection === "contact"} onClick={() => saveSection("contact", "/vendors/me/contact", contactForm, "Contact details updated")}>
                {savingSection === "contact" ? "Saving..." : "Save contact details"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="address">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-serif text-2xl">Registered and pickup address</h3>
                <p className="text-sm text-muted-foreground">Pink Paisa currently uses one seller address for both compliance and pickup scheduling.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Address</Label>
                <Textarea value={addressForm.address} onChange={(event) => setAddressForm((current) => ({ ...current, address: event.target.value }))} className="mt-2 min-h-[110px] rounded-2xl" />
              </div>
              <div>
                <Label>City</Label>
                <Input value={addressForm.city} onChange={(event) => setAddressForm((current) => ({ ...current, city: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>State</Label>
                <Input value={addressForm.state} onChange={(event) => setAddressForm((current) => ({ ...current, state: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Pincode</Label>
                <Input value={addressForm.pincode} onChange={(event) => setAddressForm((current) => ({ ...current, pincode: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
            </div>
            <div className="mt-6">
              <Button className="rounded-2xl" disabled={savingSection === "address"} onClick={() => saveSection("address", "/vendors/me/address", addressForm, "Address updated")}>
                {savingSection === "address" ? "Saving..." : "Save address"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bank">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-serif text-2xl">Payout bank details</h3>
                <p className="text-sm text-muted-foreground">Editing any bank field pauses payouts until Pink Paisa re-verifies the destination account.</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Bank updates trigger `bank_verified = false` and a 24-hour payout cooldown by design.
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Account holder name</Label>
                <Input value={bankForm.account_holder_name} onChange={(event) => setBankForm((current) => ({ ...current, account_holder_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Account number</Label>
                <Input value={bankForm.account_number} onChange={(event) => setBankForm((current) => ({ ...current, account_number: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>IFSC code</Label>
                <Input value={bankForm.ifsc_code} onChange={(event) => setBankForm((current) => ({ ...current, ifsc_code: event.target.value.toUpperCase() }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Bank name</Label>
                <Input value={bankForm.bank_name} onChange={(event) => setBankForm((current) => ({ ...current, bank_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>Branch name</Label>
                <Input value={bankForm.branch_name} onChange={(event) => setBankForm((current) => ({ ...current, branch_name: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
              <div>
                <Label>UPI ID</Label>
                <Input value={bankForm.upi_id} onChange={(event) => setBankForm((current) => ({ ...current, upi_id: event.target.value }))} className="mt-2 h-12 rounded-2xl" />
              </div>
            </div>
            <div className="mt-6">
              <Button className="rounded-2xl" disabled={savingSection === "bank"} onClick={() => saveSection("bank", "/vendors/me/bank", bankForm, "Bank details updated")}>
                {savingSection === "bank" ? "Saving..." : "Save bank details"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="kyc">
          <div className="rounded-[1.8rem] border border-[#f0e0d5] bg-white/95 p-6 shadow-[0_20px_46px_rgba(186,131,149,0.08)] md:p-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-serif text-2xl">KYC documents</h3>
                <p className="text-sm text-muted-foreground">Upload clean images of your compliance documents. Any replacement moves KYC back into admin review.</p>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              {KYC_ROWS.map((row) => {
                const currentUrl = vendor?.kyc_documents?.[row.field] || null;
                const busy = uploadingKind === row.kind;
                return (
                  <div key={row.kind} className="rounded-2xl border border-border p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">{row.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {currentUrl ? "Document uploaded and saved for review." : "No document uploaded yet."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentUrl ? (
                          <Button variant="outline" className="rounded-full" asChild>
                            <Link href={currentUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> View
                            </Link>
                          </Button>
                        ) : null}
                        <label className="inline-flex cursor-pointer items-center rounded-full border border-[#f0c0c8] bg-white px-4 py-2 text-sm font-medium text-[#c05070] hover:bg-[#fff4f7]">
                          <UploadCloud className="mr-2 h-4 w-4" />
                          {busy ? "Uploading..." : currentUrl ? "Replace" : "Upload"}
                          <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleKycFileUpload(row.kind, event)} disabled={busy} />
                        </label>
                        {currentUrl ? (
                          <Button variant="ghost" className="rounded-full text-rose-600" disabled={busy} onClick={() => void removeKycDocument(row.kind)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VendorProfile;
