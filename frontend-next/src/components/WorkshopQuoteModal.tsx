/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { X, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  open: boolean;
  onClose: () => void;
}

const WorkshopQuoteModal = ({ open, onClose }: Props) => {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    company_name: "", contact_name: "", email: "", phone: "",
    team_size: "", goals: "", preferred_format: "", budget: "",
  });

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name || !form.contact_name || !form.email || !form.phone) {
      toast.error("Please fill in required fields"); return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).from("workshop_quote_requests").insert({
      company_name: form.company_name,
      contact_name: form.contact_name,
      email: form.email,
      phone: form.phone,
      team_size: form.team_size ? parseInt(form.team_size) : null,
      goals: form.goals || null,
      preferred_format: form.preferred_format || null,
      budget: form.budget || null,
    });
    if (error) { toast.error("Failed to submit"); console.error(error); }
    else setSubmitted(true);
    setSubmitting(false);
  };

  const handleClose = () => {
    setSubmitted(false);
    setForm({ company_name: "", contact_name: "", email: "", phone: "", team_size: "", goals: "", preferred_format: "", budget: "" });
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-xl">{submitted ? "Quote Request Sent!" : "Request a Custom Quote"}</h2>
            <button onClick={handleClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5 text-muted-foreground" /></button>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-500 mb-4" />
              <p className="text-muted-foreground mb-6">We&apos;ve received your request and will get back to you within 24 hours with a custom proposal.</p>
              <Button onClick={handleClose}>Close</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Company Name *</Label><Input value={form.company_name} onChange={(e) => handleChange("company_name", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Contact Name *</Label><Input value={form.contact_name} onChange={(e) => handleChange("contact_name", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Phone *</Label><Input type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Team Size</Label><Input type="number" value={form.team_size} onChange={(e) => handleChange("team_size", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Preferred Format</Label>
                  <Select value={form.preferred_format} onValueChange={(v) => handleChange("preferred_format", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Online">Online</SelectItem>
                      <SelectItem value="Offline">Offline</SelectItem>
                      <SelectItem value="Hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Goals / Objectives</Label><Textarea value={form.goals} onChange={(e) => handleChange("goals", e.target.value)} rows={3} placeholder="What do you hope to achieve?" /></div>
              <div className="space-y-1.5"><Label>Budget Range</Label><Input value={form.budget} onChange={(e) => handleChange("budget", e.target.value)} placeholder="e.g. ₹50,000 – ₹1,00,000" /></div>
              <Button type="submit" className="w-full rounded-xl" size="lg" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Quote Request"}
              </Button>
            </form>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default WorkshopQuoteModal;
