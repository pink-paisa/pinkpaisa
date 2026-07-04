/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Pencil, Trash2, CalendarDays, FileText, Users, MessageSquareQuote, ChevronDown, ChevronUp, Upload, Loader2, ExternalLink, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useWorkshops, type Workshop } from "@/hooks/useWorkshops";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { StatCard, StatusBadge, LoadingSpinner, EmptyState, Field, FormCard, IconBtn, CheckboxField, formatPrice, WORKSHOP_STATUSES, BOOKING_STATUSES, PAYMENT_STATUSES, SESSION_STATUSES, QUOTE_STATUSES, ICON_OPTIONS } from "./AdminShared";

type WorkshopForm = { title: string; slug: string; workshop_type: string; short_description: string; full_description: string; duration: string; min_people: string; price: string; original_price: string; discount_text: string; icon: string; popular: boolean; featured: boolean; category: string; certificate_included: boolean; recording_addon_available: boolean; recording_addon_price: string; certification_addon_available: boolean; certification_addon_price: string; status: string; custom_quote_enabled: boolean; sort_order: string; benefits: string; };
const emptyWorkshopForm: WorkshopForm = { title: "", slug: "", workshop_type: "Corporate", short_description: "", full_description: "", duration: "2 Hours", min_people: "25", price: "1499", original_price: "", discount_text: "", icon: "Sparkles", popular: false, featured: false, category: "Corporate", certificate_included: false, recording_addon_available: true, recording_addon_price: "2999", certification_addon_available: true, certification_addon_price: "999", status: "active", custom_quote_enabled: false, sort_order: "0", benefits: "" };

type SessionForm = { title: string; workshop_id: string; session_date: string; session_time: string; duration: string; trainer: string; delivery_mode: string; venue_or_link: string; max_participants: string; status: string; internal_notes: string; };
const emptySessionForm: SessionForm = { title: "", workshop_id: "", session_date: "", session_time: "", duration: "", trainer: "", delivery_mode: "Online", venue_or_link: "", max_participants: "50", status: "planned", internal_notes: "" };

type BookingRow = { id: string; workshop_title: string; full_name: string; company_name: string | null; email: string; phone: string; team_size: number; preferred_date: string | null; preferred_time: string | null; city: string | null; delivery_mode: string; recording_addon: boolean; certification_addon: boolean; subtotal: number; addons_total: number; total: number; payment_status: string; booking_status: string; notes: string | null; created_at: string; organization_type: string | null; contact_person: string | null; venue_address: string | null; internal_notes: string | null; certificate_url: string | null; workshop_id: string | null; };
type SessionRow = { id: string; title: string; workshop_id: string | null; session_date: string | null; session_time: string | null; duration: string | null; trainer: string | null; delivery_mode: string; venue_or_link: string | null; max_participants: number; total_participants: number; status: string; internal_notes: string | null; booking_ids: string[]; created_at: string; };
type QuoteRow = { id: string; company_name: string; contact_name: string; email: string; phone: string; team_size: number | null; goals: string | null; preferred_format: string | null; budget: string | null; status: string; internal_notes: string | null; created_at: string; };

type SubTab = "workshops" | "bookings" | "sessions" | "quotes";

export const AdminWorkshops = () => {
  const [subTab, setSubTab] = useState<SubTab>("workshops");
  const queryClient = useQueryClient();
  const { data: allWorkshops, isLoading: workshopsLoading } = useWorkshops(true);

  // Workshops
  const [showWorkshopForm, setShowWorkshopForm] = useState(false);
  const [editingWorkshopId, setEditingWorkshopId] = useState<string | null>(null);
  const [workshopForm, setWorkshopForm] = useState<WorkshopForm>(emptyWorkshopForm);
  const [savingWorkshop, setSavingWorkshop] = useState(false);
  const [workshopSearch, setWorkshopSearch] = useState("");
  const [workshopToDelete, setWorkshopToDelete] = useState<Workshop | null>(null);

  // Bookings
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionForm>(emptySessionForm);
  const [savingSession, setSavingSession] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<SessionRow | null>(null);

  // Quotes
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteStatusFilter, setQuoteStatusFilter] = useState("all");
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);

  const fetchBookings = async () => { setBookingsLoading(true); const { data } = await (supabase as any).from("workshop_bookings").select("*").order("created_at", { ascending: false }); setBookings(data ?? []); setBookingsLoading(false); };
  const fetchSessions = async () => { setSessionsLoading(true); const { data } = await (supabase as any).from("workshop_sessions").select("*").order("session_date", { ascending: true }); setSessions(data ?? []); setSessionsLoading(false); };
  const fetchQuotes = async () => { setQuotesLoading(true); const { data } = await (supabase as any).from("workshop_quote_requests").select("*").order("created_at", { ascending: false }); setQuotes(data ?? []); setQuotesLoading(false); };

  useEffect(() => {
    if (subTab === "bookings") { fetchBookings(); fetchSessions(); }
    if (subTab === "sessions") fetchSessions();
    if (subTab === "quotes") fetchQuotes();
  }, [subTab]);

  // Workshop helpers
  const saveWorkshop = async () => {
    if (!workshopForm.title || !workshopForm.slug || !workshopForm.price) { toast.error("Title, slug, price required"); return; }
    setSavingWorkshop(true);
    const payload = { title: workshopForm.title, slug: workshopForm.slug, workshop_type: workshopForm.workshop_type, short_description: workshopForm.short_description || null, full_description: workshopForm.full_description || null, duration: workshopForm.duration || null, min_people: Number(workshopForm.min_people) || 25, price: Number(workshopForm.price), original_price: workshopForm.original_price ? Number(workshopForm.original_price) : null, discount_text: workshopForm.discount_text || null, icon: workshopForm.icon, popular: workshopForm.popular, featured: workshopForm.featured, category: workshopForm.category, certificate_included: workshopForm.certificate_included, recording_addon_available: workshopForm.recording_addon_available, recording_addon_price: Number(workshopForm.recording_addon_price) || 2999, certification_addon_available: workshopForm.certification_addon_available, certification_addon_price: Number(workshopForm.certification_addon_price) || 999, status: workshopForm.status, custom_quote_enabled: workshopForm.custom_quote_enabled, sort_order: Number(workshopForm.sort_order) || 0, benefits: workshopForm.benefits ? workshopForm.benefits.split("\n").filter(Boolean) : [] };
    const { error } = editingWorkshopId ? await (supabase as any).from("workshops").update(payload).eq("id", editingWorkshopId) : await (supabase as any).from("workshops").insert(payload);
    if (error) { toast.error("Failed"); console.error(error); } else { toast.success(editingWorkshopId ? "Updated" : "Added"); setShowWorkshopForm(false); queryClient.invalidateQueries({ queryKey: ["workshops"] }); }
    setSavingWorkshop(false);
  };
  const deleteWorkshop = async () => {
    if (!workshopToDelete) return;
    await (supabase as any).from("workshops").delete().eq("id", workshopToDelete.id);
    toast.success("Deleted");
    setWorkshopToDelete(null);
    queryClient.invalidateQueries({ queryKey: ["workshops"] });
  };
  const openEditWorkshop = (w: Workshop) => { setEditingWorkshopId(w.id); setWorkshopForm({ title: w.title, slug: w.slug, workshop_type: w.workshop_type, short_description: w.short_description ?? "", full_description: w.full_description ?? "", duration: w.duration ?? "", min_people: String(w.min_people), price: String(w.price), original_price: w.original_price ? String(w.original_price) : "", discount_text: w.discount_text ?? "", icon: w.icon, popular: w.popular, featured: w.featured, category: w.category, certificate_included: w.certificate_included, recording_addon_available: w.recording_addon_available, recording_addon_price: String(w.recording_addon_price), certification_addon_available: w.certification_addon_available, certification_addon_price: String(w.certification_addon_price), status: w.status, custom_quote_enabled: w.custom_quote_enabled, sort_order: String(w.sort_order), benefits: Array.isArray(w.benefits) ? w.benefits.join("\n") : "" }); setShowWorkshopForm(true); };
  const filteredWorkshops = (allWorkshops ?? []).filter((w) => !workshopSearch || w.title.toLowerCase().includes(workshopSearch.toLowerCase()));

  // Certificate upload
  const [uploadingCert, setUploadingCert] = useState<string | null>(null);

  const uploadCertificate = async (bookingId: string, file: File) => {
    setUploadingCert(bookingId);
    const ext = file.name.split(".").pop();
    const path = `certificates/${bookingId}-${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("product-images").upload(path, file, { cacheControl: "3600", upsert: false });
    if (uploadErr) { toast.error("Upload failed: " + uploadErr.message); setUploadingCert(null); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    const certUrl = urlData.publicUrl;
    const { error } = await (supabase as any).from("workshop_bookings").update({ certificate_url: certUrl }).eq("id", bookingId);
    if (error) { toast.error("Failed to save"); } else { setBookings((p) => p.map((b) => b.id === bookingId ? { ...b, certificate_url: certUrl } : b)); toast.success("Certificate uploaded"); }
    setUploadingCert(null);
  };

  const removeCertificate = async (bookingId: string) => {
    const { error } = await (supabase as any).from("workshop_bookings").update({ certificate_url: null }).eq("id", bookingId);
    if (error) toast.error("Failed"); else { setBookings((p) => p.map((b) => b.id === bookingId ? { ...b, certificate_url: null } : b)); toast.success("Certificate removed"); }
  };

  // Find linked sessions for a booking
  const getLinkedSessions = (bookingId: string) => sessions.filter((s) => s.booking_ids?.includes(bookingId));

  // Booking helpers
  const updateBookingStatus = async (id: string, field: "booking_status" | "payment_status", val: string) => {
    const { error } = await (supabase as any).from("workshop_bookings").update({ [field]: val }).eq("id", id);
    if (error) toast.error("Failed"); else { setBookings((p) => p.map((b) => b.id === id ? { ...b, [field]: val } : b)); toast.success(`Updated`); }
  };
  const filteredBookings = bookings.filter((b) => { const s = !bookingSearch || b.full_name.toLowerCase().includes(bookingSearch.toLowerCase()) || b.email.toLowerCase().includes(bookingSearch.toLowerCase()) || b.workshop_title.toLowerCase().includes(bookingSearch.toLowerCase()); return s && (bookingStatusFilter === "all" || b.booking_status === bookingStatusFilter); });

  // Session helpers
  const saveSession = async () => {
    if (!sessionForm.title) { toast.error("Title required"); return; }
    setSavingSession(true);
    const payload = { title: sessionForm.title, workshop_id: sessionForm.workshop_id || null, session_date: sessionForm.session_date || null, session_time: sessionForm.session_time || null, duration: sessionForm.duration || null, trainer: sessionForm.trainer || null, delivery_mode: sessionForm.delivery_mode, venue_or_link: sessionForm.venue_or_link || null, max_participants: Number(sessionForm.max_participants) || 50, status: sessionForm.status, internal_notes: sessionForm.internal_notes || null };
    const { error } = editingSessionId ? await (supabase as any).from("workshop_sessions").update(payload).eq("id", editingSessionId) : await (supabase as any).from("workshop_sessions").insert(payload);
    if (error) { toast.error("Failed"); console.error(error); } else { toast.success(editingSessionId ? "Updated" : "Created"); setShowSessionForm(false); fetchSessions(); }
    setSavingSession(false);
  };
  const deleteSession = async () => {
    if (!sessionToDelete) return;
    await (supabase as any).from("workshop_sessions").delete().eq("id", sessionToDelete.id);
    toast.success("Deleted");
    setSessionToDelete(null);
    fetchSessions();
  };

  // Quote helpers
  const updateQuoteStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any).from("workshop_quote_requests").update({ status }).eq("id", id);
    if (error) toast.error("Failed"); else { setQuotes((p) => p.map((q) => q.id === id ? { ...q, status } : q)); toast.success(`Quote → ${status}`); }
  };
  const filteredQuotes = quotes.filter((q) => quoteStatusFilter === "all" || q.status === quoteStatusFilter);

  const subTabs: { key: SubTab; label: string; icon: any }[] = [
    { key: "workshops", label: "Workshops", icon: CalendarDays },
    { key: "bookings", label: "Bookings", icon: FileText },
    { key: "sessions", label: "Sessions", icon: Users },
    { key: "quotes", label: "Quotes", icon: MessageSquareQuote },
  ];
  const pendingPaymentCount = bookings.filter((b) => ["pending", "pending_payment"].includes(b.payment_status)).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl mb-1">Manage Workshops</h2>
        <p className="text-sm text-muted-foreground">Create workshops, manage bookings, schedule sessions, and handle quote requests.</p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {subTabs.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${subTab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* WORKSHOPS TAB */}
      {subTab === "workshops" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total" value={(allWorkshops ?? []).length} />
            <StatCard label="Active" value={(allWorkshops ?? []).filter((w) => w.status === "active").length} color="text-emerald-600" />
            <StatCard label="Draft" value={(allWorkshops ?? []).filter((w) => w.status === "draft").length} color="text-amber-600" />
            <StatCard label="Closed" value={(allWorkshops ?? []).filter((w) => w.status === "closed").length} color="text-red-600" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search workshops..." value={workshopSearch} onChange={(e) => setWorkshopSearch(e.target.value)} className="pl-9" /></div>
            <Button onClick={() => { setEditingWorkshopId(null); setWorkshopForm(emptyWorkshopForm); setShowWorkshopForm(true); }} className="rounded-xl"><Plus className="h-4 w-4" /> Add Workshop</Button>
          </div>
          {showWorkshopForm && <FormCard title={editingWorkshopId ? "Edit Workshop" : "Add Workshop"} onClose={() => setShowWorkshopForm(false)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title *"><Input value={workshopForm.title} onChange={(e) => setWorkshopForm({ ...workshopForm, title: e.target.value })} /></Field>
              <Field label="Slug *"><Input value={workshopForm.slug} onChange={(e) => setWorkshopForm({ ...workshopForm, slug: e.target.value })} /></Field>
              <Field label="Type"><Select value={workshopForm.workshop_type} onValueChange={(v) => setWorkshopForm({ ...workshopForm, workshop_type: v, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Corporate">Corporate</SelectItem><SelectItem value="Group">Group</SelectItem><SelectItem value="Bundle">Bundle</SelectItem></SelectContent></Select></Field>
              <Field label="Duration"><Input value={workshopForm.duration} onChange={(e) => setWorkshopForm({ ...workshopForm, duration: e.target.value })} placeholder="2 Hours" /></Field>
              <Field label="Min People"><Input type="number" value={workshopForm.min_people} onChange={(e) => setWorkshopForm({ ...workshopForm, min_people: e.target.value })} /></Field>
              <Field label="Price *"><Input type="number" value={workshopForm.price} onChange={(e) => setWorkshopForm({ ...workshopForm, price: e.target.value })} /></Field>
              <Field label="Original Price"><Input type="number" value={workshopForm.original_price} onChange={(e) => setWorkshopForm({ ...workshopForm, original_price: e.target.value })} /></Field>
              <Field label="Discount Text"><Input value={workshopForm.discount_text} onChange={(e) => setWorkshopForm({ ...workshopForm, discount_text: e.target.value })} /></Field>
              <Field label="Icon"><Select value={workshopForm.icon} onValueChange={(v) => setWorkshopForm({ ...workshopForm, icon: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ICON_OPTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Status"><Select value={workshopForm.status} onValueChange={(v) => setWorkshopForm({ ...workshopForm, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WORKSHOP_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Sort Order"><Input type="number" value={workshopForm.sort_order} onChange={(e) => setWorkshopForm({ ...workshopForm, sort_order: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <CheckboxField label="Popular" checked={workshopForm.popular} onChange={(v) => setWorkshopForm({ ...workshopForm, popular: v })} />
              <CheckboxField label="Featured" checked={workshopForm.featured} onChange={(v) => setWorkshopForm({ ...workshopForm, featured: v })} />
              <CheckboxField label="Certificate" checked={workshopForm.certificate_included} onChange={(v) => setWorkshopForm({ ...workshopForm, certificate_included: v })} />
              <CheckboxField label="Recording Add-on" checked={workshopForm.recording_addon_available} onChange={(v) => setWorkshopForm({ ...workshopForm, recording_addon_available: v })} />
              <CheckboxField label="Certification Add-on" checked={workshopForm.certification_addon_available} onChange={(v) => setWorkshopForm({ ...workshopForm, certification_addon_available: v })} />
              <CheckboxField label="Custom Quote" checked={workshopForm.custom_quote_enabled} onChange={(v) => setWorkshopForm({ ...workshopForm, custom_quote_enabled: v })} />
            </div>
            <Field label="Short Description"><Textarea value={workshopForm.short_description} onChange={(e) => setWorkshopForm({ ...workshopForm, short_description: e.target.value })} rows={2} /></Field>
            <Field label="Full Description"><Textarea value={workshopForm.full_description} onChange={(e) => setWorkshopForm({ ...workshopForm, full_description: e.target.value })} rows={4} /></Field>
            <Field label="Benefits (one per line)"><Textarea value={workshopForm.benefits} onChange={(e) => setWorkshopForm({ ...workshopForm, benefits: e.target.value })} rows={3} /></Field>
            <div className="flex gap-3 justify-end"><Button variant="outline" onClick={() => setShowWorkshopForm(false)}>Cancel</Button><Button onClick={saveWorkshop} disabled={savingWorkshop}>{savingWorkshop ? "Saving…" : "Save"}</Button></div>
          </FormCard>}
          <div className="space-y-3">
            {workshopsLoading ? <LoadingSpinner /> : filteredWorkshops.length === 0 ? <EmptyState icon={CalendarDays} text="No workshops" /> : filteredWorkshops.map((w) => (
              <div key={w.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-sm truncate">{w.title}</h4><StatusBadge status={w.status} />{w.popular && <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">Popular</span>}</div>
                  <p className="text-xs text-muted-foreground truncate">{w.category} · {w.duration} · {formatPrice(w.price)}/person</p>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => openEditWorkshop(w)} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => setWorkshopToDelete(w)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BOOKINGS TAB */}
      {subTab === "bookings" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Bookings" value={bookings.length} />
            <StatCard label="Paid" value={bookings.filter((b) => b.payment_status === "paid").length} color="text-emerald-600" />
            <StatCard label="Pending" value={pendingPaymentCount} color="text-amber-600" />
            <StatCard label="Revenue" value={formatPrice(bookings.filter((b) => b.payment_status === "paid").reduce((s, b) => s + Number(b.total), 0))} color="text-primary" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search bookings..." value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} className="pl-9" /></div>
            <Select value={bookingStatusFilter} onValueChange={setBookingStatusFilter}><SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Filter" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{BOOKING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-3">
            {bookingsLoading ? <LoadingSpinner /> : filteredBookings.length === 0 ? <EmptyState icon={FileText} text="No bookings" /> : filteredBookings.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button onClick={() => setExpandedBooking(expandedBooking === b.id ? null : b.id)} className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors">
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div><p className="text-xs text-muted-foreground">ID</p><p className="font-mono text-sm font-medium truncate">{b.id.slice(0, 8).toUpperCase()}</p></div>
                    <div><p className="text-xs text-muted-foreground">Workshop</p><p className="text-sm truncate">{b.workshop_title}</p></div>
                    <div><p className="text-xs text-muted-foreground">Customer</p><p className="text-sm truncate">{b.full_name}</p></div>
                    <div><p className="text-xs text-muted-foreground">Team</p><p className="text-sm">{b.team_size}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="text-sm font-semibold">{formatPrice(b.total)}</p></div>
                  </div>
                  <StatusBadge status={b.booking_status} />
                  {expandedBooking === b.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expandedBooking === b.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-border p-5 grid gap-6 md:grid-cols-2">
                    <div className="space-y-3 text-sm">
                      <p><strong>Email:</strong> {b.email}</p>
                      <p><strong>Phone:</strong> {b.phone}</p>
                      {b.organization_type && <p><strong>Org Type:</strong> {b.organization_type}</p>}
                      {b.preferred_date && <p><strong>Preferred Date:</strong> {new Date(b.preferred_date).toLocaleDateString("en-IN")}</p>}
                      {b.preferred_time && <p><strong>Time:</strong> {b.preferred_time}</p>}
                      <p><strong>Mode:</strong> {b.delivery_mode}</p>
                      {b.city && <p><strong>City:</strong> {b.city}</p>}
                      {b.recording_addon && <p className="text-primary font-medium">+ Recording Add-on</p>}
                      {b.certification_addon && <p className="text-primary font-medium">+ Certification Add-on</p>}
                      {b.notes && <p><strong>Notes:</strong> {b.notes}</p>}

                      {/* Linked Session Schedule */}
                      {(() => {
                        const linked = getLinkedSessions(b.id);
                        if (linked.length === 0) return null;
                        return (
                          <div className="mt-2 rounded-lg bg-accent/40 p-3 space-y-1">
                            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Scheduled Session</p>
                            {linked.map((s) => (
                              <div key={s.id} className="text-sm">
                                <p className="font-medium">{s.title}</p>
                                <p>{s.session_date ? new Date(s.session_date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date"} {s.session_time ? `at ${s.session_time}` : ""}</p>
                                {s.trainer && <p>Trainer: {s.trainer}</p>}
                                <p>{s.delivery_mode}{s.venue_or_link ? ` — ${s.venue_or_link}` : ""}</p>
                                <StatusBadge status={s.status} />
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="space-y-3">
                      <div className="text-sm space-y-1"><p>Subtotal: {formatPrice(b.subtotal)}</p><p>Add-ons: {formatPrice(b.addons_total)}</p><p className="font-semibold text-lg">Total: {formatPrice(b.total)}</p></div>
                      <Field label="Payment Status"><Select value={b.payment_status} onValueChange={(v) => updateBookingStatus(b.id, "payment_status", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select></Field>
                      <Field label="Booking Status"><Select value={b.booking_status} onValueChange={(v) => updateBookingStatus(b.id, "booking_status", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BOOKING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select></Field>

                      {/* Schedule Workshop - Date & Time */}
                      <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-2">
                        <p className="text-sm font-semibold flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" /> Schedule Workshop</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Date"><Input type="date" value={b.preferred_date ?? ""} onChange={async (e) => { const val = e.target.value || null; const { error } = await (supabase as any).from("workshop_bookings").update({ preferred_date: val }).eq("id", b.id); if (error) toast.error("Failed"); else { setBookings((p) => p.map((x) => x.id === b.id ? { ...x, preferred_date: val } : x)); toast.success("Date updated"); } }} /></Field>
                          <Field label="Time"><Input value={b.preferred_time ?? ""} placeholder="e.g. 10:00 AM" onChange={async (e) => { const val = e.target.value || null; const { error } = await (supabase as any).from("workshop_bookings").update({ preferred_time: val }).eq("id", b.id); if (error) toast.error("Failed"); else { setBookings((p) => p.map((x) => x.id === b.id ? { ...x, preferred_time: val } : x)); toast.success("Time updated"); } }} /></Field>
                        </div>
                      </div>

                      {/* Certificate Upload - Only when user requested Certification Add-on */}
                      {b.certification_addon && (
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Certification Add-on — Upload Certificate</p>
                          {b.certificate_url ? (
                            <div className="flex items-center gap-2">
                              <a href={b.certificate_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                                <ExternalLink className="h-3.5 w-3.5" /> View Certificate
                              </a>
                              <button onClick={() => removeCertificate(b.id)} className="rounded-full bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"><X className="h-3 w-3" /></button>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" disabled={uploadingCert === b.id} onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,.jpg,.jpeg,.png,.webp"; input.onchange = (e: any) => { const file = e.target.files?.[0]; if (file) uploadCertificate(b.id, file); }; input.click(); }}>
                              {uploadingCert === b.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Uploading…</> : <><Upload className="h-3.5 w-3.5 mr-1" /> Upload Certificate</>}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SESSIONS TAB */}
      {subTab === "sessions" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total" value={sessions.length} />
            <StatCard label="Upcoming" value={sessions.filter((s) => s.status === "planned" || s.status === "confirmed").length} color="text-blue-600" />
            <StatCard label="In Progress" value={sessions.filter((s) => s.status === "in_progress").length} color="text-purple-600" />
            <StatCard label="Completed" value={sessions.filter((s) => s.status === "completed").length} color="text-emerald-600" />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => { setEditingSessionId(null); setSessionForm(emptySessionForm); setShowSessionForm(true); }} className="rounded-xl"><Plus className="h-4 w-4" /> Plan Session</Button>
          </div>
          {showSessionForm && <FormCard title={editingSessionId ? "Edit Session" : "Plan New Session"} onClose={() => setShowSessionForm(false)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Session Title *"><Input value={sessionForm.title} onChange={(e) => setSessionForm({ ...sessionForm, title: e.target.value })} /></Field>
              <Field label="Workshop"><Select value={sessionForm.workshop_id} onValueChange={(v) => setSessionForm({ ...sessionForm, workshop_id: v })}><SelectTrigger><SelectValue placeholder="Link workshop" /></SelectTrigger><SelectContent>{(allWorkshops ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Date"><Input type="date" value={sessionForm.session_date} onChange={(e) => setSessionForm({ ...sessionForm, session_date: e.target.value })} /></Field>
              <Field label="Time"><Input value={sessionForm.session_time} onChange={(e) => setSessionForm({ ...sessionForm, session_time: e.target.value })} placeholder="10:00 AM" /></Field>
              <Field label="Duration"><Input value={sessionForm.duration} onChange={(e) => setSessionForm({ ...sessionForm, duration: e.target.value })} placeholder="2 Hours" /></Field>
              <Field label="Trainer"><Input value={sessionForm.trainer} onChange={(e) => setSessionForm({ ...sessionForm, trainer: e.target.value })} /></Field>
              <Field label="Mode"><Select value={sessionForm.delivery_mode} onValueChange={(v) => setSessionForm({ ...sessionForm, delivery_mode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Online">Online</SelectItem><SelectItem value="Offline">Offline</SelectItem></SelectContent></Select></Field>
              <Field label="Venue / Link"><Input value={sessionForm.venue_or_link} onChange={(e) => setSessionForm({ ...sessionForm, venue_or_link: e.target.value })} /></Field>
              <Field label="Max Participants"><Input type="number" value={sessionForm.max_participants} onChange={(e) => setSessionForm({ ...sessionForm, max_participants: e.target.value })} /></Field>
              <Field label="Status"><Select value={sessionForm.status} onValueChange={(v) => setSessionForm({ ...sessionForm, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SESSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select></Field>
            </div>
            <Field label="Internal Notes"><Textarea value={sessionForm.internal_notes} onChange={(e) => setSessionForm({ ...sessionForm, internal_notes: e.target.value })} rows={3} /></Field>
            <div className="flex gap-3 justify-end"><Button variant="outline" onClick={() => setShowSessionForm(false)}>Cancel</Button><Button onClick={saveSession} disabled={savingSession}>{savingSession ? "Saving…" : "Save"}</Button></div>
          </FormCard>}
          <div className="space-y-3">
            {sessionsLoading ? <LoadingSpinner /> : sessions.length === 0 ? <EmptyState icon={Users} text="No sessions planned" /> : sessions.map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-sm truncate">{s.title}</h4><StatusBadge status={s.status} /></div>
                  <p className="text-xs text-muted-foreground truncate">{s.session_date ? new Date(s.session_date).toLocaleDateString("en-IN") : "No date"} · {s.session_time ?? ""} · {s.delivery_mode}{s.trainer ? ` · ${s.trainer}` : ""} · {s.total_participants}/{s.max_participants} participants</p>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => { setEditingSessionId(s.id); setSessionForm({ title: s.title, workshop_id: s.workshop_id ?? "", session_date: s.session_date ?? "", session_time: s.session_time ?? "", duration: s.duration ?? "", trainer: s.trainer ?? "", delivery_mode: s.delivery_mode, venue_or_link: s.venue_or_link ?? "", max_participants: String(s.max_participants), status: s.status, internal_notes: s.internal_notes ?? "" }); setShowSessionForm(true); }} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => setSessionToDelete(s)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QUOTES TAB */}
      {subTab === "quotes" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Requests" value={quotes.length} />
            <StatCard label="New" value={quotes.filter((q) => q.status === "new").length} color="text-blue-600" />
            <StatCard label="Proposal Sent" value={quotes.filter((q) => q.status === "proposal_sent").length} color="text-purple-600" />
            <StatCard label="Converted" value={quotes.filter((q) => q.status === "converted").length} color="text-emerald-600" />
          </div>
          <Select value={quoteStatusFilter} onValueChange={setQuoteStatusFilter}><SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Filter" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{QUOTE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
          <div className="space-y-3">
            {quotesLoading ? <LoadingSpinner /> : filteredQuotes.length === 0 ? <EmptyState icon={MessageSquareQuote} text="No quote requests" /> : filteredQuotes.map((q) => (
              <div key={q.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button onClick={() => setExpandedQuote(expandedQuote === q.id ? null : q.id)} className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors">
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div><p className="text-xs text-muted-foreground">Company</p><p className="text-sm font-medium truncate">{q.company_name}</p></div>
                    <div><p className="text-xs text-muted-foreground">Contact</p><p className="text-sm truncate">{q.contact_name}</p></div>
                    <div><p className="text-xs text-muted-foreground">Team Size</p><p className="text-sm">{q.team_size ?? "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Date</p><p className="text-sm">{new Date(q.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p></div>
                  </div>
                  <StatusBadge status={q.status} />
                  {expandedQuote === q.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expandedQuote === q.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-border p-5 grid gap-6 md:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <p><strong>Email:</strong> {q.email}</p><p><strong>Phone:</strong> {q.phone}</p>
                      {q.goals && <p><strong>Goals:</strong> {q.goals}</p>}
                      {q.preferred_format && <p><strong>Format:</strong> {q.preferred_format}</p>}
                      {q.budget && <p><strong>Budget:</strong> {q.budget}</p>}
                    </div>
                    <Field label="Update Status"><Select value={q.status} onValueChange={(v) => updateQuoteStatus(q.id, v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{QUOTE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select></Field>
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <ConfirmActionDialog
        open={Boolean(workshopToDelete)}
        onOpenChange={(open) => { if (!open) setWorkshopToDelete(null); }}
        title="Delete this workshop?"
        description={workshopToDelete ? `This will permanently remove "${workshopToDelete.title}".` : undefined}
        confirmLabel="Delete workshop"
        destructive
        onConfirm={deleteWorkshop}
      />
      <ConfirmActionDialog
        open={Boolean(sessionToDelete)}
        onOpenChange={(open) => { if (!open) setSessionToDelete(null); }}
        title="Delete this session?"
        description={sessionToDelete ? `This will permanently remove "${sessionToDelete.title}".` : undefined}
        confirmLabel="Delete session"
        destructive
        onConfirm={deleteSession}
      />
    </div>
  );
};
