/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { usePinkPagesCategories, usePinkPagesCategoryMutations, type PinkPagesCategory } from "@/hooks/usePinkPages";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";

const empty: Partial<PinkPagesCategory> = { name: "", slug: "", icon: "", sort_order: 0, status: "active" };

export const PinkPagesCategories = () => {
  const { data: categories = [], isLoading } = usePinkPagesCategories();
  const { upsert, remove } = usePinkPagesCategoryMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<PinkPagesCategory>>(empty);
  const [categoryToDelete, setCategoryToDelete] = useState<PinkPagesCategory | null>(null);

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (c: PinkPagesCategory) => { setForm(c); setOpen(true); };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error("Name is required"); return; }
    const slug = form.slug?.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try {
      await upsert.mutateAsync({ ...form, name: form.name, slug } as any);
      toast.success(form.id ? "Category updated" : "Category created");
      setOpen(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    if (!categoryToDelete) return;
    try {
      await remove.mutateAsync(categoryToDelete.id);
      toast.success("Deleted");
      setCategoryToDelete(null);
    } catch (e: any) { toast.error(e.message); }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{categories.length} categories</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add Category</Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{c.slug}</TableCell>
                <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                <TableCell>{c.sort_order}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setCategoryToDelete(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form.id ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Slug</Label><Input value={form.slug ?? ""} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated" /></div>
            <div><Label>Icon (optional)</Label><Input value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></div>
            <div><Label>Sort Order</Label><Input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status ?? "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave} disabled={upsert.isPending}>{form.id ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(categoryToDelete)}
        onOpenChange={(open) => { if (!open) setCategoryToDelete(null); }}
        title="Delete this category?"
        description={categoryToDelete ? `Listings in "${categoryToDelete.name}" will lose their category assignment.` : undefined}
        confirmLabel="Delete category"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
};
