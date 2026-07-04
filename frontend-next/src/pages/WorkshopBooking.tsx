/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useWorkshops, type Workshop } from "@/hooks/useWorkshops";
import { apiFetch } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

const formatPrice = (n: number) => `${String.fromCharCode(8377)}${Number(n).toLocaleString("en-IN")}`;

const WorkshopBooking = () => {
  const router = useRouter();
  const workshopSlug = typeof router.query.workshop === "string" ? router.query.workshop : "";
  const { data: workshops } = useWorkshops();
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    company_name: "",
    contact_person: "",
    email: "",
    phone: "",
    organization_type: "",
    team_size: "1",
    preferred_date: "",
    preferred_time: "",
    city: "",
    delivery_mode: "Online",
    venue_address: "",
    notes: "",
    recording_addon: false,
    certification_addon: false,
  });

  useEffect(() => {
    if (!workshops || !workshopSlug) return;
    const workshop = workshops.find((item) => item.slug === workshopSlug);
    if (workshop) setSelectedWorkshop(workshop);
  }, [workshops, workshopSlug]);

  const handleChange = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleWorkshopChange = (slug: string) => {
    const workshop = workshops?.find((item) => item.slug === slug);
    if (workshop) {
      setSelectedWorkshop(workshop);
      router.replace({ pathname: router.pathname, query: { ...router.query, workshop: slug } }, undefined, { shallow: true });
    }
  };

  const teamSize = Math.max(1, parseInt(form.team_size, 10) || 1);
  const subtotal = selectedWorkshop ? selectedWorkshop.price * teamSize : 0;
  const recordingCost = form.recording_addon && selectedWorkshop?.recording_addon_available
    ? selectedWorkshop.recording_addon_price
    : 0;
  const certificationCost = form.certification_addon && selectedWorkshop?.certification_addon_available
    ? selectedWorkshop.certification_addon_price * teamSize
    : 0;
  const addonsTotal = recordingCost + certificationCost;
  const total = subtotal + addonsTotal;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedWorkshop) {
      toast.error("Please select a workshop");
      return;
    }
    if (selectedWorkshop.custom_quote_enabled) {
      toast.error("This workshop needs a custom quote. Please use the quote request flow instead.");
      return;
    }
    if (!form.full_name || !form.email || !form.phone) {
      toast.error("Name, email and phone are required");
      return;
    }

    setSubmitting(true);
    try {
      const booking = await apiFetch<any>("/workshop-bookings", {
        method: "POST",
        body: JSON.stringify({
          workshop_id: selectedWorkshop.id,
          full_name: form.full_name,
          company_name: form.company_name || null,
          contact_person: form.contact_person || null,
          email: form.email,
          phone: form.phone,
          organization_type: form.organization_type || null,
          team_size: teamSize,
          preferred_date: form.preferred_date || null,
          preferred_time: form.preferred_time || null,
          city: form.city || null,
          delivery_mode: form.delivery_mode,
          venue_address: form.venue_address || null,
          notes: form.notes || null,
          recording_addon: form.recording_addon,
          certification_addon: form.certification_addon,
        }),
      });
      if (!booking.checkout_url || !booking.merchant_order_id) {
        throw new Error("Workshop payment session could not be created");
      }
      sessionStorage.setItem("phonepe_pending_workshop_booking", JSON.stringify({
        booking_id: booking.id,
        merchant_order_id: booking.merchant_order_id,
      }));
      window.location.assign(booking.checkout_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to place booking");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <section className="bg-rose-soft py-10 md:py-16">
        <div className="container mx-auto max-w-3xl">
          <Link href="/workshops" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Workshops
          </Link>
          <h1 className="mb-2 font-serif text-2xl md:text-3xl">Book a Workshop</h1>
          <p className="mb-8 text-muted-foreground">Fill in the details below and our team will confirm your booking.</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Workshop Details</h2>
              <div className="space-y-1.5">
                <Label>Select Workshop *</Label>
                <Select value={selectedWorkshop?.slug ?? ""} onValueChange={handleWorkshopChange}>
                  <SelectTrigger><SelectValue placeholder="Choose a workshop" /></SelectTrigger>
                  <SelectContent>
                    {(workshops ?? []).map((workshop) => (
                      <SelectItem key={workshop.slug} value={workshop.slug}>
                        {workshop.title} - {formatPrice(workshop.price)}/person
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedWorkshop ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-1 rounded-xl bg-accent/50 p-4 text-sm"
                >
                  <p className="font-medium">{selectedWorkshop.title}</p>
                  <p className="text-muted-foreground">{selectedWorkshop.short_description}</p>
                  <p>Duration: {selectedWorkshop.duration} | Min. {selectedWorkshop.min_people} people</p>
                  <p className="text-lg font-semibold text-primary">{formatPrice(selectedWorkshop.price)}/person</p>
                </motion.div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Team / Group Size *</Label>
                  <Input type="number" min="1" value={form.team_size} onChange={(e) => handleChange("team_size", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Delivery Mode</Label>
                  <Select value={form.delivery_mode} onValueChange={(value) => handleChange("delivery_mode", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Online">Online</SelectItem>
                      <SelectItem value="Offline">Offline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Contact Information</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Full Name *</Label><Input value={form.full_name} onChange={(e) => handleChange("full_name", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Company Name</Label><Input value={form.company_name} onChange={(e) => handleChange("company_name", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => handleChange("contact_person", e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Organization Type</Label>
                  <Select value={form.organization_type} onValueChange={(value) => handleChange("organization_type", value)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Corporate">Corporate</SelectItem>
                      <SelectItem value="Startup">Startup</SelectItem>
                      <SelectItem value="Educational">Educational</SelectItem>
                      <SelectItem value="Non-Profit">Non-Profit</SelectItem>
                      <SelectItem value="Government">Government</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Phone *</Label><Input type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Scheduling & Venue</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Preferred Date</Label><Input type="date" value={form.preferred_date} onChange={(e) => handleChange("preferred_date", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Preferred Time</Label><Input value={form.preferred_time} onChange={(e) => handleChange("preferred_time", e.target.value)} placeholder="e.g. 10:00 AM" /></div>
                <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => handleChange("city", e.target.value)} /></div>
                {form.delivery_mode === "Offline" ? (
                  <div className="space-y-1.5"><Label>Venue Address</Label><Input value={form.venue_address} onChange={(e) => handleChange("venue_address", e.target.value)} /></div>
                ) : null}
              </div>
              <div className="space-y-1.5"><Label>Notes / Custom Requirements</Label><Textarea value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} rows={3} /></div>
            </div>

            {selectedWorkshop && (selectedWorkshop.recording_addon_available || selectedWorkshop.certification_addon_available) ? (
              <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
                <h2 className="text-lg font-semibold">Add-ons</h2>
                {selectedWorkshop.recording_addon_available ? (
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={form.recording_addon}
                      onChange={(e) => handleChange("recording_addon", e.target.checked)}
                      className="h-4 w-4 rounded border-input text-primary"
                    />
                    <div>
                      <p className="text-sm font-medium">Recording Add-on</p>
                      <p className="text-xs text-muted-foreground">Get a replay - {formatPrice(selectedWorkshop.recording_addon_price)}/session</p>
                    </div>
                  </label>
                ) : null}
                {selectedWorkshop.certification_addon_available ? (
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={form.certification_addon}
                      onChange={(e) => handleChange("certification_addon", e.target.checked)}
                      className="h-4 w-4 rounded border-input text-primary"
                    />
                    <div>
                      <p className="text-sm font-medium">Certification Add-on</p>
                      <p className="text-xs text-muted-foreground">Branded wellness certificates - {formatPrice(selectedWorkshop.certification_addon_price)}/attendee</p>
                    </div>
                  </label>
                ) : null}
              </div>
            ) : null}

            {selectedWorkshop ? (
              <div className="space-y-3 rounded-2xl border border-primary/20 bg-card p-6">
                <h2 className="text-lg font-semibold">Order Summary</h2>
                <div className="flex justify-between text-sm"><span>{selectedWorkshop.title} × {teamSize}</span><span>{formatPrice(subtotal)}</span></div>
                {recordingCost > 0 ? <div className="flex justify-between text-sm"><span>Recording Add-on</span><span>{formatPrice(recordingCost)}</span></div> : null}
                {certificationCost > 0 ? <div className="flex justify-between text-sm"><span>Certification × {teamSize}</span><span>{formatPrice(certificationCost)}</span></div> : null}
                <div className="flex justify-between border-t border-border pt-3 text-lg font-semibold">
                  <span>Total</span>
                  <span className="text-primary">{formatPrice(total)}</span>
                </div>
              </div>
            ) : null}

            <Button type="submit" variant="hero" size="xl" className="w-full" disabled={submitting || !selectedWorkshop}>
              {submitting ? "Redirecting to Payment..." : `Pay & Book - ${formatPrice(total)}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You&apos;ll be redirected to PhonePe to complete payment securely.
            </p>
          </form>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default WorkshopBooking;
