/* eslint-disable @typescript-eslint/no-explicit-any */
import { motion } from "framer-motion";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

export const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", confirmed: "bg-blue-100 text-blue-800", processing: "bg-purple-100 text-purple-800", pickup_assigned: "bg-indigo-100 text-indigo-800", picked_up: "bg-fuchsia-100 text-fuchsia-800", shipped: "bg-cyan-100 text-cyan-800", delivered: "bg-emerald-100 text-emerald-800", return_requested: "bg-orange-100 text-orange-800", return_in_transit: "bg-orange-100 text-orange-800", returned: "bg-rose-100 text-rose-800", refunded: "bg-red-100 text-red-800", cancelled: "bg-red-100 text-red-800",
  pending_payment: "bg-amber-100 text-amber-800", paid: "bg-emerald-100 text-emerald-800", scheduled: "bg-blue-100 text-blue-800", completed: "bg-emerald-100 text-emerald-800",
  planned: "bg-blue-100 text-blue-800", in_progress: "bg-purple-100 text-purple-800", rescheduled: "bg-orange-100 text-orange-800",
  new: "bg-blue-100 text-blue-800", contacted: "bg-cyan-100 text-cyan-800", proposal_sent: "bg-purple-100 text-purple-800", converted: "bg-emerald-100 text-emerald-800", closed: "bg-muted text-muted-foreground",
  active: "bg-emerald-100 text-emerald-800", draft: "bg-amber-100 text-amber-800", out_of_stock: "bg-red-100 text-red-800",
  published: "bg-emerald-100 text-emerald-800", archived: "bg-muted text-muted-foreground",
  verified: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-800",
  queued: "bg-amber-100 text-amber-800", running: "bg-blue-100 text-blue-800", batch_running: "bg-sky-100 text-sky-800", waiting_review: "bg-orange-100 text-orange-800", approved_for_publish: "bg-emerald-100 text-emerald-800", publishing: "bg-fuchsia-100 text-fuchsia-800", failed: "bg-red-100 text-red-800",
  done: "bg-emerald-100 text-emerald-800", approved: "bg-emerald-100 text-emerald-800", approved_with_warnings: "bg-amber-100 text-amber-800", needs_review: "bg-orange-100 text-orange-800", disconnected: "bg-muted text-muted-foreground", connected: "bg-emerald-100 text-emerald-800", error: "bg-red-100 text-red-800", ready: "bg-emerald-100 text-emerald-800", not_ready: "bg-muted text-muted-foreground",
};

export const formatPrice = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
export const LoadingSpinner = () => <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
export const EmptyState = ({ icon: Icon, text }: { icon: any; text: string }) => <div className="py-16 text-center text-muted-foreground"><Icon className="mx-auto mb-3 h-12 w-12 opacity-30" /><p>{text}</p></div>;
export const StatusBadge = ({ status }: { status: string }) => <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize whitespace-nowrap ${statusColors[status] ?? "bg-muted text-muted-foreground"}`}>{status.replace(/_/g, " ")}</span>;
export const Field = ({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
}) => <div className="space-y-1.5"><Label className={error ? "text-destructive" : undefined}>{label}</Label>{children}{error ? <p className="text-xs text-destructive">{error}</p> : null}{!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>;
export const FormCard = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between gap-3"><h3 className="font-serif text-lg">{title}</h3><button type="button" onClick={onClose} aria-label="Close form" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-5 w-5" /></button></div>{children}</motion.div>;
export const IconBtn = ({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) => <button type="button" onClick={onClick} title={title} aria-label={title} className={`flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${danger ? "hover:text-destructive" : "hover:text-foreground"}`}>{children}</button>;
export const CheckboxField = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-input text-primary" />{label}</label>;
export const StatCard = ({ label, value, color }: { label: string; value: string | number; color?: string }) => <div className="rounded-xl border border-border bg-card p-4"><p className="mb-1 text-xs text-muted-foreground">{label}</p><p className={`text-xl font-bold tabular-nums ${color ?? "text-foreground"}`}>{value}</p></div>;

export const ORDER_STATUSES = ["pending", "confirmed", "processing", "pickup_assigned", "picked_up", "shipped", "delivered", "return_requested", "return_in_transit", "returned", "refunded", "cancelled"] as const;
export const DELIVERY_STATUSES = ["pending", "pickup_assigned", "picked_up", "shipped", "delivered", "return_requested", "return_in_transit", "returned"] as const;
export const PRODUCT_STATUSES = ["active", "draft", "out_of_stock"] as const;
export const ICON_OPTIONS = ["Sparkles", "Calendar", "Target", "HelpCircle", "BookOpen", "Award", "Dumbbell", "Heart", "Zap", "Brain", "Shield", "Users", "MessageCircle", "Compass", "Briefcase", "Flame"];
export const WORKSHOP_STATUSES = ["active", "draft", "closed"] as const;
export const BOOKING_STATUSES = ["draft", "confirmed", "scheduled", "completed", "cancelled", "no_show", "refunded", "failed", "pending_payment"] as const;
export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "cancelled", "pending_payment"] as const;
export const SESSION_STATUSES = ["planned", "confirmed", "in_progress", "completed", "cancelled", "rescheduled"] as const;
export const QUOTE_STATUSES = ["new", "contacted", "proposal_sent", "converted", "closed"] as const;
export const POLL_CATEGORIES = ["trending", "politics", "finance", "business", "workplace", "sports", "policy", "tech", "economy", "education", "lifestyle", "environment"] as const;
export const PHYSICAL_CATEGORIES = ["Wellness", "Finance", "Self Growth", "Merchandise", "Kits / Bundles"] as const;
export const BLOG_STATUSES = ["published", "draft", "archived"] as const;
export const BLOG_CATEGORIES = ["Wellness", "Finance", "Self Growth", "Lifestyle", "Career", "Health", "Personal Growth"] as const;
