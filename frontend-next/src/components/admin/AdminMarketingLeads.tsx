import { useCallback, useEffect, useState } from "react";
import { Download, Mail, MessageCircle } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LeadStatus = "NEW" | "CONTACTED" | "NURTURING" | "CONVERTED" | "UNSUBSCRIBED";
type Lead = {
  id: string;
  result_type: string;
  first_name: string | null;
  email: string;
  phone: string | null;
  status: LeadStatus;
  email_consent: { granted: boolean };
  whatsapp_consent: { granted: boolean };
  attribution?: { first_touch?: { utm_source?: string | null; utm_campaign?: string | null } } | null;
  internal_notes: string | null;
  created_at: string;
};

const STATUSES: Array<"ALL" | LeadStatus> = ["ALL", "NEW", "CONTACTED", "NURTURING", "CONVERTED", "UNSUBSCRIBED"];

export default function AdminMarketingLeads() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("NEW");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const response = await apiFetch<{ items: Lead[]; total: number }>(`/admin/marketing-leads?${params}`);
      setItems(response.items || []);
      setTotal(Number(response.total || 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load marketing leads.");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);

  const updateLead = async (lead: Lead, updates: { status?: LeadStatus; internal_notes?: string | null }) => {
    try {
      const updated = await apiFetch<Lead>(`/admin/marketing-leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      setItems((current) => current.map((item) => item.id === lead.id ? updated : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update lead.");
    }
  };

  const exportParams = new URLSearchParams();
  if (status !== "ALL") exportParams.set("status", status);
  if (search.trim()) exportParams.set("search", search.trim());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl">Quiz lead queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">Consented roadmap leads only. Quiz answers are never stored.</p>
        </div>
        <Button variant="outline" asChild>
          <a href={`${API_URL}/admin/marketing-leads/export.csv${exportParams.toString() ? `?${exportParams}` : ""}`}>
            <Download className="h-4 w-4" /> Export CSV
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((value) => (
          <Button key={value} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>
            {value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input aria-label="Search leads" placeholder="Search email, name or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Button variant="secondary" onClick={() => void load()}>Search</Button>
      </div>

      {error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{total} matching lead{total === 1 ? "" : "s"}</p>

      {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading leads…</div> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((lead) => (
            <article key={lead.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{lead.first_name || lead.email}</h3>
                  <p className="truncate text-sm text-muted-foreground">{lead.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{lead.result_type.replace(/-/g, " ")} · {new Date(lead.created_at).toLocaleString("en-IN")}</p>
                </div>
                <select
                  aria-label={`Status for ${lead.email}`}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                  value={lead.status}
                  onChange={(event) => void updateLead(lead, { status: event.target.value as LeadStatus })}
                >
                  {STATUSES.filter((value): value is LeadStatus => value !== "ALL").map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1"><Mail className="h-3 w-3" /> Email consent</span>
                {lead.whatsapp_consent?.granted ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1"><MessageCircle className="h-3 w-3" /> WhatsApp consent</span> : null}
                {lead.attribution?.first_touch?.utm_source ? <span className="rounded-full bg-muted px-2 py-1">Source: {lead.attribution.first_touch.utm_source}</span> : null}
              </div>
              <textarea
                aria-label={`Notes for ${lead.email}`}
                className="mt-4 min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm"
                defaultValue={lead.internal_notes || ""}
                placeholder="Internal follow-up notes"
                onBlur={(event) => {
                  const next = event.target.value.trim() || null;
                  if (next !== (lead.internal_notes || null)) void updateLead(lead, { internal_notes: next });
                }}
              />
            </article>
          ))}
          {!items.length ? <p className="col-span-full py-16 text-center text-sm text-muted-foreground">No leads match this view.</p> : null}
        </div>
      )}
    </div>
  );
}
