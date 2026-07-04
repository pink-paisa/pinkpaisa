import { useEffect, useMemo, useState } from "react";
import { MapPin, Pencil, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import {
  EMPTY_ADDRESS_DRAFT,
  formatAddressLines,
  mapAddressToDraft,
  type AddressDraft,
  type UserAddress,
  useAccountAddresses,
} from "@/hooks/useAccountAddresses";

type AddressBookManagerProps = {
  selectable?: boolean;
  selectedAddressId?: string | null;
  onSelectAddress?: (address: UserAddress | null) => void;
  title?: string;
  description?: string;
  compact?: boolean;
};

const AddressBookManager = ({
  selectable = false,
  selectedAddressId = null,
  onSelectAddress,
  title = "Saved addresses",
  description = "Choose where your order should be delivered, or keep multiple addresses ready for future checkouts.",
  compact = false,
}: AddressBookManagerProps) => {
  const { addresses, loading, createAddress, updateAddress, deleteAddress, setDefaultAddress } = useAccountAddresses();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS_DRAFT);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingAddress, setDeletingAddress] = useState<UserAddress | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [defaultingId, setDefaultingId] = useState<string | null>(null);

  const selectedAddress = useMemo(
    () => addresses.find((address) => address.id === selectedAddressId) || null,
    [addresses, selectedAddressId],
  );

  useEffect(() => {
    if (!selectable || !onSelectAddress) return;
    if (selectedAddress) return;
    const fallback = addresses.find((address) => address.is_default_shipping) || addresses[0] || null;
    onSelectAddress(fallback);
  }, [addresses, onSelectAddress, selectable, selectedAddress]);

  const resetDialog = () => {
    setDraft(EMPTY_ADDRESS_DRAFT);
    setEditingAddressId(null);
    setDialogOpen(false);
  };

  const openCreateDialog = () => {
    setEditingAddressId(null);
    setDraft({
      ...EMPTY_ADDRESS_DRAFT,
      is_default_shipping: addresses.length === 0,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (address: UserAddress) => {
    setEditingAddressId(address.id);
    setDraft(mapAddressToDraft(address));
    setDialogOpen(true);
  };

  const validateDraft = () => {
    if (!draft.full_name.trim()) return "Full name is required";
    if (!draft.phone.trim()) return "Phone is required";
    if (!draft.line1.trim()) return "Address line 1 is required";
    if (!draft.city.trim()) return "City is required";
    if (!draft.state.trim()) return "State is required";
    if (!/^\d{6}$/.test(draft.pincode.trim())) return "Enter a valid 6-digit pincode";
    return null;
  };

  const handleSave = async () => {
    const validationError = validateDraft();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...draft,
        label: draft.label.trim() || (draft.address_type === "work" ? "Work" : draft.address_type === "other" ? "Other" : "Home"),
      };

      const saved = editingAddressId
        ? await updateAddress(editingAddressId, payload)
        : await createAddress(payload);

      toast.success(editingAddressId ? "Address updated" : "Address added");
      if (selectable && onSelectAddress) {
        onSelectAddress(saved);
      }
      resetDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save address");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingAddress) return;
    setDeleting(true);
    try {
      await deleteAddress(deletingAddress.id);
      if (selectable && onSelectAddress && selectedAddressId === deletingAddress.id) {
        const nextAddress = addresses.find((address) => address.id !== deletingAddress.id) || null;
        onSelectAddress(nextAddress);
      }
      toast.success("Address deleted");
      setDeletingAddress(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete address");
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async (address: UserAddress) => {
    setDefaultingId(address.id);
    try {
      const updated = await setDefaultAddress(address.id);
      toast.success("Default shipping address updated");
      if (selectable && onSelectAddress) {
        onSelectAddress(updated);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update default address");
    } finally {
      setDefaultingId(null);
    }
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className={compact ? "font-serif text-xl" : "font-serif text-2xl"}>{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" className="rounded-2xl" onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" /> Add new address
        </Button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          Loading your saved addresses...
        </div>
      ) : addresses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No saved addresses yet. Add one now so checkout no longer rewrites your profile address every time.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {addresses.map((address) => {
            const isSelected = selectable && selectedAddressId === address.id;
            const lines = formatAddressLines(address);
            return (
              <div
                key={address.id}
                className={`rounded-3xl border p-5 shadow-sm transition ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{address.label}</p>
                      {address.is_default_shipping ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                          Default shipping
                        </span>
                      ) : null}
                      <span className="inline-flex items-center rounded-full bg-secondary/60 px-3 py-1 text-xs capitalize text-muted-foreground">
                        {address.address_type}
                      </span>
                    </div>
                    <p className="mt-3 font-medium">{address.full_name}</p>
                    <p className="text-sm text-muted-foreground">{address.phone}</p>
                  </div>
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Selected
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {lines.map((line) => (
                    <p key={line} className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                      <span>{line}</span>
                    </p>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {selectable ? (
                    <Button
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => onSelectAddress?.(address)}
                    >
                      {isSelected ? "Delivering here" : "Deliver here"}
                    </Button>
                  ) : null}
                  {!address.is_default_shipping ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => handleSetDefault(address)}
                      disabled={defaultingId === address.id}
                    >
                      Set default
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => openEditDialog(address)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                  <Button type="button" variant="ghost" className="rounded-full text-rose-600" onClick={() => setDeletingAddress(address)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open ? resetDialog() : setDialogOpen(true)}>
        <DialogContent className="max-w-2xl rounded-[28px]">
          <DialogHeader>
            <DialogTitle>{editingAddressId ? "Edit address" : "Add a new address"}</DialogTitle>
            <DialogDescription>
              Save delivery details once, then choose them at checkout in a single tap.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Home, Office, Mom's place" />
            </div>
            <div className="space-y-2">
              <Label>Address type</Label>
              <Select value={draft.address_type} onValueChange={(value) => setDraft((current) => ({ ...current, address_type: value as AddressDraft["address_type"] }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={draft.full_name} onChange={(event) => setDraft((current) => ({ ...current, full_name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address line 1</Label>
              <Input value={draft.line1} onChange={(event) => setDraft((current) => ({ ...current, line1: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address line 2</Label>
              <Input value={draft.line2} onChange={(event) => setDraft((current) => ({ ...current, line2: event.target.value }))} placeholder="Apartment, suite, floor" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Landmark</Label>
              <Input value={draft.landmark} onChange={(event) => setDraft((current) => ({ ...current, landmark: event.target.value }))} placeholder="Near metro station, opposite park..." />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input value={draft.pincode} onChange={(event) => setDraft((current) => ({ ...current, pincode: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Input value={draft.country} onChange={(event) => setDraft((current) => ({ ...current, country: event.target.value }))} />
            </div>
            <label className="flex items-center gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.is_default_shipping}
                onChange={(event) => setDraft((current) => ({ ...current, is_default_shipping: event.target.checked }))}
                className="h-4 w-4 rounded border-input text-primary"
              />
              <span className="text-sm text-muted-foreground">Use as my default shipping address</span>
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-2xl" onClick={resetDialog} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" className="rounded-2xl" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingAddressId ? "Update address" : "Save address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(deletingAddress)}
        onOpenChange={(open) => {
          if (!open) setDeletingAddress(null);
        }}
        title="Delete this address?"
        description="You can always add it back later. If this was your default address, we’ll promote another saved address automatically."
        confirmLabel="Delete address"
        onConfirm={handleDelete}
        pending={deleting}
        destructive
      />
    </div>
  );
};

export default AddressBookManager;
