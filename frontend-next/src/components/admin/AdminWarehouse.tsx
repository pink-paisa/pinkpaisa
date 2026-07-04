/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Warehouse, MapPin, Phone, Mail, Building2, Save, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Field } from "./AdminShared";

type WarehouseData = {
  warehouse_name: string;
  warehouse_address: string;
  warehouse_city: string;
  warehouse_state: string;
  warehouse_pincode: string;
  warehouse_phone: string;
  warehouse_email: string;
};

const EMPTY: WarehouseData = { warehouse_name: "", warehouse_address: "", warehouse_city: "", warehouse_state: "", warehouse_pincode: "", warehouse_phone: "", warehouse_email: "" };

export const AdminWarehouse = () => {
  const [form, setForm] = useState<WarehouseData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<WarehouseData>("/admin/settings/warehouse");
        if (data) setForm(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load warehouse settings");
      } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const data = await apiFetch<WarehouseData & { message: string }>("/admin/settings/warehouse", { method: "PUT", body: JSON.stringify(form) });
      if (data) {
        setForm({ warehouse_name: data.warehouse_name, warehouse_address: data.warehouse_address, warehouse_city: data.warehouse_city, warehouse_state: data.warehouse_state, warehouse_pincode: data.warehouse_pincode, warehouse_phone: data.warehouse_phone, warehouse_email: data.warehouse_email });
        setSaved(true);
        toast.success("Warehouse settings saved");
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save warehouse settings");
    } finally { setSaving(false); }
  };

  const update = (key: keyof WarehouseData, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const isComplete = form.warehouse_address && form.warehouse_city && form.warehouse_state && form.warehouse_pincode;

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-serif text-2xl">Warehouse & Pickup</h2>
        <p className="text-sm text-muted-foreground">Configure your admin warehouse address. This address is used as the pickup location for all PinkPaisa-owned (non-vendor) products when buyers place orders.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl space-y-6">

        {/* Status indicator */}
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${isComplete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {isComplete ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <MapPin className="h-4 w-4 shrink-0" />}
          {isComplete ? "Warehouse address is configured. Admin product orders will use this pickup location." : "Warehouse address is incomplete. Admin product orders will not have a pickup address until this is configured."}
        </div>

        {/* Warehouse Details Card */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-lg">Warehouse Details</h3>
              <p className="text-xs text-muted-foreground">Address where delivery partners will pick up admin products</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Warehouse Name">
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="e.g. PinkPaisa Main Warehouse" value={form.warehouse_name} onChange={(e) => update("warehouse_name", e.target.value)} className="pl-9" />
                </div>
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Pickup Address *">
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Street address, building, floor" value={form.warehouse_address} onChange={(e) => update("warehouse_address", e.target.value)} className="pl-9" />
                </div>
              </Field>
            </div>

            <Field label="City *">
              <Input placeholder="e.g. Mumbai" value={form.warehouse_city} onChange={(e) => update("warehouse_city", e.target.value)} />
            </Field>

            <Field label="State *">
              <Input placeholder="e.g. Maharashtra" value={form.warehouse_state} onChange={(e) => update("warehouse_state", e.target.value)} />
            </Field>

            <Field label="Pincode *">
              <Input placeholder="e.g. 400001" value={form.warehouse_pincode} onChange={(e) => update("warehouse_pincode", e.target.value)} maxLength={6} />
            </Field>

            <Field label="Contact Phone">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Warehouse phone" value={form.warehouse_phone} onChange={(e) => update("warehouse_phone", e.target.value)} className="pl-9" />
              </div>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Contact Email">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="warehouse@pinkpaisa.in" value={form.warehouse_email} onChange={(e) => update("warehouse_email", e.target.value)} className="pl-9" />
                </div>
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Fields marked with * are required for order fulfillment</p>
            <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2 min-w-[140px]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </div>

        {/* How it works note */}
        <div className="rounded-xl border border-dashed border-border bg-accent/30 px-5 py-4 text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground flex items-center gap-2"><Warehouse className="h-4 w-4" /> How it works</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>When a buyer orders a <strong>PinkPaisa-owned product</strong> (not a vendor product), this warehouse address is automatically set as the pickup location.</li>
            <li>For <strong>vendor products</strong>, the pickup address comes from the vendor&apos;s registered address instead.</li>
            <li>The assigned delivery partner will see this address for pickup scheduling.</li>
          </ul>
        </div>

      </motion.div>
    </div>
  );
};
