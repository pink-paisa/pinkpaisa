/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Star, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import {
  usePinkPagesListings,
  usePinkPagesListingMutations,
  usePinkPagesCategories,
  type PinkPagesListing,
} from "@/hooks/usePinkPages";

const emptyListing: Partial<PinkPagesListing> = {
  business_name: "",
  slug: "",
  category_id: null,
  short_description: "",
  full_description: "",
  contact_person: "",
  phone: "",
  email: "",
  whatsapp: "",
  website: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  logo: "",
  featured: false,
  verified: false,
  status: "active",
  sort_order: 0,
  meta_title: "",
  meta_description: "",
};

export const PinkPagesListings = () => {
  const { data: listings = [], isLoading } = usePinkPagesListings();
  const { data: categories = [] } = usePinkPagesCategories();
  const { upsert, remove, toggleField } = usePinkPagesListingMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<PinkPagesListing>>(emptyListing);
  const [listingToDelete, setListingToDelete] = useState<PinkPagesListing | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "active" | "inactive">("all");

  const openNew = () => {
    setForm(emptyListing);
    setOpen(true);
  };
  const openEdit = (listing: PinkPagesListing) => {
    setForm(listing);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.business_name?.trim() || !form.phone?.trim() || !form.email?.trim()) {
      toast.error("Business name, phone, and email are required");
      return;
    }
    const slug = form.slug?.trim() || form.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try {
      await upsert.mutateAsync({
        ...form,
        business_name: form.business_name,
        slug,
        phone: form.phone,
        email: form.email,
      } as any);
      toast.success(form.id ? "Listing updated" : "Listing created");
      setOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDelete = async () => {
    if (!listingToDelete) return;
    try {
      await remove.mutateAsync(listingToDelete.id);
      toast.success("Deleted");
      setListingToDelete(null);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggle = (id: string, field: string, current: boolean) =>
    toggleField.mutateAsync({ id, field, value: !current });

  const filteredListings = listings.filter((listing) => statusFilter === "all" || listing.status === statusFilter);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{filteredListings.length} listings</p>
          <Select value={statusFilter} onValueChange={(value: "all" | "pending" | "active" | "inactive") => setStatusFilter(value)}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> Add Listing
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredListings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="max-w-[200px] truncate font-medium">{listing.business_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{listing.category_name ?? "-"}</TableCell>
                <TableCell className="text-xs">{listing.phone}</TableCell>
                <TableCell className="max-w-[150px] truncate text-xs">{listing.email}</TableCell>
                <TableCell>
                  <button onClick={() => toggle(listing.id, "featured", listing.featured)} className="p-1">
                    <Star className={`h-4 w-4 ${listing.featured ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`} />
                  </button>
                </TableCell>
                <TableCell>
                  <button onClick={() => toggle(listing.id, "verified", listing.verified)} className="p-1">
                    <BadgeCheck className={`h-4 w-4 ${listing.verified ? "text-primary" : "text-muted-foreground"}`} />
                  </button>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => toggleField.mutateAsync({
                      id: listing.id,
                      field: "status",
                      value: listing.status === "active" ? "inactive" : "active",
                    })}
                    className="p-1"
                  >
                    <Badge variant={listing.status === "active" ? "default" : "secondary"}>{listing.status}</Badge>
                  </button>
                </TableCell>
                <TableCell>{listing.sort_order}</TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(listing)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setListingToDelete(listing)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Edit Listing" : "Add Listing"}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Business Name *</Label><Input value={form.business_name ?? ""} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></div>
              <div><Label>Slug</Label><Input value={form.slug ?? ""} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated" /></div>
              <div>
                <Label>Category</Label>
                <Select value={form.category_id ?? "none"} onValueChange={(value) => setForm({ ...form, category_id: value === "none" ? null : value })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2"><Label>Short Description</Label><Textarea rows={2} value={form.short_description ?? ""} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
              <div><Label>Contact Person</Label><Input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
              <div><Label>Phone *</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email *</Label><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>WhatsApp</Label><Input value={form.whatsapp ?? ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></div>
              <div><Label>Website</Label><Input value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
              <div><Label>Logo URL</Label><Input value={form.logo ?? ""} onChange={(e) => setForm({ ...form, logo: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>City</Label><Input value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div><Label>State</Label><Input value={form.state ?? ""} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
              <div><Label>Pincode</Label><Input value={form.pincode ?? ""} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
              <div><Label>Sort Order</Label><Input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
              <div>
                <Label>Status</Label>
                <Select value={form.status ?? "active"} onValueChange={(value) => setForm({ ...form, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4 md:col-span-2">
                <div className="flex items-center gap-2"><Switch checked={form.featured ?? false} onCheckedChange={(value) => setForm({ ...form, featured: value })} /><Label>Featured</Label></div>
                <div className="flex items-center gap-2"><Switch checked={form.verified ?? false} onCheckedChange={(value) => setForm({ ...form, verified: value })} /><Label>Verified</Label></div>
              </div>
              <div><Label>Meta Title</Label><Input value={form.meta_title ?? ""} onChange={(e) => setForm({ ...form, meta_title: e.target.value })} /></div>
              <div><Label>Meta Description</Label><Input value={form.meta_description ?? ""} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} /></div>
            </div>
          </ScrollArea>
          <DialogFooter><Button onClick={handleSave} disabled={upsert.isPending}>{form.id ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(listingToDelete)}
        onOpenChange={(open) => {
          if (!open) setListingToDelete(null);
        }}
        title="Delete this listing?"
        description={listingToDelete ? `This will permanently remove "${listingToDelete.business_name}".` : undefined}
        confirmLabel="Delete listing"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
};
