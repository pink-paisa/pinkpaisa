import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const emptyForm = { name: "", email: "", phone: "", company_name: "", status: "active", notes: "" };

export const AdminDeliveryPartners = () => {
  const [partners, setPartners] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);

  const loadPartners = async () => setPartners(await apiFetch<any[]>("/delivery-partners"));
  useEffect(() => { loadPartners().catch(() => undefined); }, []);

  const savePartner = async () => {
    try {
      await apiFetch("/delivery-partners", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm);
      toast.success("Delivery partner added");
      await loadPartners();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save delivery partner");
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await apiFetch(`/delivery-partners/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    await loadPartners();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl">Delivery partners</h2>
        <p className="text-sm text-muted-foreground">Create and manage delivery partners for order assignment.</p>
      </div>
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-2 xl:grid-cols-3">
        <Input placeholder="Partner name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <Input placeholder="Company" value={form.company_name} onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))} />
        <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        <Input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
        <Input placeholder="Notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        <Button className="rounded-2xl" onClick={savePartner}>Add partner</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {partners.map((partner) => (
          <div key={partner.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{partner.name}</p><p className="text-sm text-muted-foreground">{partner.company_name || "Independent partner"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${partner.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{partner.status}</span></div>
            <div className="mt-3 space-y-1 text-sm text-muted-foreground"><p>{partner.phone || "—"}</p><p>{partner.email || "—"}</p></div>
            <div className="mt-4 flex gap-2"><Button variant="outline" className="rounded-2xl" onClick={() => updateStatus(partner.id, partner.status === "active" ? "inactive" : "active")}>{partner.status === "active" ? "Deactivate" : "Activate"}</Button></div>
          </div>
        ))}
      </div>
    </div>
  );
};
