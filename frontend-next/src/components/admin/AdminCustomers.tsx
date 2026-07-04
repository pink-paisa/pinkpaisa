import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { formatPrice } from "./AdminShared";

type CustomerListItem = {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  wallet_balance?: number;
  email_verified?: boolean;
  locked_until?: string | null;
  meta?: {
    order_count?: number;
    total_spent?: number;
  };
};

type CustomerListResponse = {
  items: CustomerListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
};

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  source: string;
  note?: string | null;
  balance_after: number;
  createdAt?: string;
  created_at?: string;
};

type CustomerDetailResponse = {
  user: CustomerListItem;
  orders: Array<{
    id: string;
    total: number;
    status: string;
    order_number?: string | null;
    createdAt?: string;
    created_at?: string;
    items?: Array<{ product_title: string; quantity: number }>;
  }>;
  wallet_transactions: WalletTransaction[];
};

const statusPillClass = (user: CustomerListItem) => {
  if (user.locked_until) return "bg-rose-100 text-rose-700 border-rose-200";
  if (user.email_verified) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
};

export const AdminCustomers = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<CustomerListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, total_pages: 1 });
  const [selected, setSelected] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPagination((current) => ({ ...current, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadUsers = async (page = pagination.page) => {
    try {
      setLoading(true);
      const data = await apiFetch<CustomerListResponse>(`/users?search=${encodeURIComponent(debouncedSearch)}&page=${page}&limit=${pagination.limit}`);
      setUsers(data.items || []);
      setPagination(data.pagination || { page: 1, limit: 12, total: 0, total_pages: 1 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [debouncedSearch, pagination.limit, pagination.page]);

  const openUser = async (id: string) => {
    try {
      const data = await apiFetch<CustomerDetailResponse>(`/users/${id}`);
      setSelected(data);
      setCreditAmount("");
      setCreditNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load customer details");
    }
  };

  const refreshSelected = async () => {
    if (!selected?.user.id) return;
    const data = await apiFetch<CustomerDetailResponse>(`/users/${selected.user.id}`);
    setSelected(data);
  };

  const creditWallet = async () => {
    if (!selected?.user.id) return;
    const amount = Number(creditAmount || 0);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid wallet credit amount");
      return;
    }
    if (!creditNote.trim()) {
      toast.error("A reason is required");
      return;
    }

    try {
      setWorking(true);
      await apiFetch(`/users/${selected.user.id}/wallet-credit`, {
        method: "POST",
        body: JSON.stringify({ amount, note: creditNote.trim() }),
      });
      toast.success("Wallet credited");
      setCreditAmount("");
      setCreditNote("");
      await Promise.all([loadUsers(pagination.page), refreshSelected()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not credit wallet");
    } finally {
      setWorking(false);
    }
  };

  const lockAccount = async () => {
    if (!selected?.user.id) return;
    try {
      setWorking(true);
      await apiFetch(`/users/${selected.user.id}/lock`, {
        method: "POST",
        body: JSON.stringify({ hours: 24 }),
      });
      toast.success("Customer account locked for 24 hours");
      await Promise.all([loadUsers(pagination.page), refreshSelected()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not lock customer");
    } finally {
      setWorking(false);
    }
  };

  const unlockAccount = async () => {
    if (!selected?.user.id) return;
    try {
      setWorking(true);
      await apiFetch(`/users/${selected.user.id}/unlock`, { method: "POST" });
      toast.success("Customer account unlocked");
      await Promise.all([loadUsers(pagination.page), refreshSelected()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unlock customer");
    } finally {
      setWorking(false);
    }
  };

  const resendVerification = async () => {
    if (!selected?.user.id) return;
    try {
      setWorking(true);
      await apiFetch(`/users/${selected.user.id}/resend-verification`, { method: "POST" });
      toast.success("Verification email sent");
      await refreshSelected();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resend verification");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl">Registered buyers</h2>
        <p className="text-sm text-muted-foreground">View buyer profiles, credit wallets, resend verification, and temporarily lock accounts.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search customer name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">{pagination.total} buyer account(s)</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-4">Name</th>
                <th className="px-4 py-4">Email</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Orders</th>
                <th className="px-4 py-4">Spent</th>
                <th className="px-4 py-4">Wallet</th>
                <th className="px-4 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={7}>Loading customers...</td></tr>
              ) : users.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={7}>No users found.</td></tr>
              ) : users.map((user) => (
                <tr key={user.id} className="border-t border-border/60">
                  <td className="px-4 py-4">{user.full_name || "—"}</td>
                  <td className="px-4 py-4">
                    <p>{user.email}</p>
                    <p className="text-xs text-muted-foreground">{user.phone || "No phone"}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusPillClass(user)}`}>
                      {user.locked_until ? "Locked" : user.email_verified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                  <td className="px-4 py-4">{user.meta?.order_count || 0}</td>
                  <td className="px-4 py-4">{formatPrice(user.meta?.total_spent || 0)}</td>
                  <td className="px-4 py-4">{formatPrice(user.wallet_balance || 0)}</td>
                  <td className="px-4 py-4">
                    <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium" onClick={() => void openUser(user.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <p className="text-muted-foreground">Page {pagination.page} of {pagination.total_pages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.total_pages} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}>
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Customer details</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</p>
                  <p className="mt-2 font-medium">{selected.user.full_name || "—"}</p>
                </div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wallet</p>
                  <p className="mt-2 font-medium">{formatPrice(selected.user.wallet_balance || 0)}</p>
                </div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Email status</p>
                  <p className="mt-2 font-medium">{selected.user.email_verified ? "Verified" : "Unverified"}</p>
                </div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Account</p>
                  <p className="mt-2 font-medium">{selected.user.locked_until ? `Locked until ${new Date(selected.user.locked_until).toLocaleString("en-IN")}` : "Active"}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-border p-4">
                <p className="font-medium">Customer actions</p>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr,1fr,auto]">
                  <Input type="number" min="1" placeholder="Wallet credit amount" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
                  <Input placeholder="Reason for adjustment" value={creditNote} onChange={(e) => setCreditNote(e.target.value)} />
                  <Button onClick={() => void creditWallet()} disabled={working}>Credit wallet</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!selected.user.email_verified && <Button variant="outline" onClick={() => void resendVerification()} disabled={working}>Resend verification</Button>}
                  {selected.user.locked_until ? (
                    <Button variant="outline" onClick={() => void unlockAccount()} disabled={working}>Unlock account</Button>
                  ) : (
                    <Button variant="outline" onClick={() => void lockAccount()} disabled={working}>Lock for 24h</Button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border p-4">
                <p className="font-medium">Recent wallet activity</p>
                <div className="mt-3 space-y-2">
                  {selected.wallet_transactions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No wallet transactions yet.</p>
                  ) : selected.wallet_transactions.map((txn) => {
                    const createdAt = txn.created_at || txn.createdAt;
                    return (
                      <div key={txn.id} className="rounded-2xl bg-secondary/20 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium capitalize">{txn.source.replace(/_/g, " ")}</p>
                          <p className={txn.type === "credit" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                            {txn.type === "credit" ? "+" : "-"}{formatPrice(txn.amount)}
                          </p>
                        </div>
                        <p className="mt-1 text-muted-foreground">{txn.note || "No note"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Balance after {formatPrice(txn.balance_after)}{createdAt ? ` · ${new Date(createdAt).toLocaleString("en-IN")}` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-border p-4">
                <p className="font-medium">Order history</p>
                <div className="mt-3 space-y-3">
                  {selected.orders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No orders.</p>
                  ) : selected.orders.map((order) => {
                    const createdAt = order.created_at || order.createdAt;
                    return (
                      <div key={order.id} className="rounded-2xl bg-secondary/20 p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`}</p>
                            <p className="text-xs text-muted-foreground">{createdAt ? new Date(createdAt).toLocaleString("en-IN") : "Recently"}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatPrice(order.total)}</p>
                            <p className="capitalize text-muted-foreground">{order.status}</p>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          {(order.items || []).map((item, index) => (
                            <p key={`${order.id}-${index}`}>{item.product_title} × {item.quantity}</p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
