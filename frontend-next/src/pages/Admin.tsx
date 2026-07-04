/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Lock,
  Package,
  Home,
  BarChart3,
  Store,
  CalendarDays,
  BookOpen,
  TrendingUp,
  LayoutDashboard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BookOpenCheck,
  UserRoundSearch,
  Users,
  Truck,
  Landmark,
  ReceiptIndianRupee,
  Tags,
  Warehouse,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminOrders } from "@/components/admin/AdminOrders";
import { AdminProducts } from "@/components/admin/AdminProducts";
import { AdminWorkshops } from "@/components/admin/AdminWorkshops";
import { AdminContent } from "@/components/admin/AdminContent";
import { AdminEngagement } from "@/components/admin/AdminEngagement";
import { AdminAnalytics } from "@/components/admin/AdminAnalytics";
import { AdminPinkPages } from "@/components/admin/AdminPinkPages";
import AdminVendors from "@/components/admin/AdminVendors";
import AdminCampaigns from "@/components/admin/AdminCampaigns";
import { AdminCustomers } from "@/components/admin/AdminCustomers";
import { AdminDeliveryPartners } from "@/components/admin/AdminDeliveryPartners";
import AdminVendorOutstanding from "@/components/admin/AdminVendorOutstanding";
import AdminAffiliateProducts from "@/components/admin/AdminAffiliateProducts";
import { AdminWarehouse } from "@/components/admin/AdminWarehouse";
import AdminSettlements from "@/components/admin/AdminSettlements";
import { API_URL, apiFetch } from "@/lib/api";

type Section =
  | "dashboard"
  | "orders"
  | "products"
  | "affiliate_products"
  | "vendors"
  | "campaigns"
  | "vendor_outstanding"
  | "settlements"
  | "customers"
  | "delivery"
  | "warehouse"
  | "workshops"
  | "pinkpages"
  | "content"
  | "engagement"
  | "analytics";

type NavGroupKey =
  | "dashboard"
  | "commerce"
  | "catalog"
  | "sellers"
  | "finance"
  | "operations"
  | "workshops"
  | "content_community"
  | "growth_reporting";

const sectionItems: { key: Section; label: string; sublabel: string; icon: any }[] = [
  { key: "dashboard", label: "Dashboard", sublabel: "Overview", icon: LayoutDashboard },
  { key: "orders", label: "Orders", sublabel: "Buyer Orders", icon: Package },
  { key: "products", label: "Products", sublabel: "Upload Products", icon: Store },
  { key: "affiliate_products", label: "Affiliate Products", sublabel: "Upload & Assign", icon: Tags },
  { key: "vendors", label: "Vendors", sublabel: "Verify Sellers", icon: UserRoundSearch },
  { key: "campaigns", label: "Campaigns", sublabel: "Instagram Pipeline", icon: TrendingUp },
  { key: "vendor_outstanding", label: "Vendor Outstanding", sublabel: "Release Payouts", icon: Landmark },
  { key: "settlements", label: "Settlements", sublabel: "Payout Audit", icon: ReceiptIndianRupee },
  { key: "customers", label: "Customers", sublabel: "Buyer Accounts", icon: Users },
  { key: "delivery", label: "Delivery", sublabel: "Assign Partners", icon: Truck },
  { key: "warehouse", label: "Warehouse", sublabel: "Pickup Address", icon: Warehouse },
  { key: "workshops", label: "Workshops", sublabel: "Manage Workshops", icon: CalendarDays },
  { key: "pinkpages", label: "Pink Pages", sublabel: "Directory Listings", icon: BookOpenCheck },
  { key: "content", label: "Content", sublabel: "Publish Content", icon: BookOpen },
  { key: "engagement", label: "Engagement", sublabel: "Polls & Interaction", icon: TrendingUp },
  { key: "analytics", label: "Analytics", sublabel: "Business Metrics", icon: BarChart3 },
];

const navGroups: { key: NavGroupKey; label: string; sublabel: string; icon: any; sections: Section[] }[] = [
  { key: "dashboard", label: "Dashboard", sublabel: "Overview", icon: LayoutDashboard, sections: ["dashboard"] },
  { key: "commerce", label: "Commerce", sublabel: "Orders & buyers", icon: Package, sections: ["orders", "customers"] },
  { key: "catalog", label: "Catalog", sublabel: "Products & affiliate", icon: Store, sections: ["products", "affiliate_products"] },
  { key: "sellers", label: "Sellers", sublabel: "Vendor operations", icon: UserRoundSearch, sections: ["vendors"] },
  { key: "finance", label: "Finance", sublabel: "Payouts & settlements", icon: Landmark, sections: ["vendor_outstanding", "settlements"] },
  { key: "operations", label: "Operations", sublabel: "Delivery & warehouse", icon: Truck, sections: ["delivery", "warehouse"] },
  { key: "workshops", label: "Workshops", sublabel: "Events & bookings", icon: CalendarDays, sections: ["workshops"] },
  { key: "content_community", label: "Content & Community", sublabel: "Directory, blogs, polls", icon: BookOpenCheck, sections: ["pinkpages", "content", "engagement"] },
  { key: "growth_reporting", label: "Growth & Reporting", sublabel: "Campaigns & analytics", icon: BarChart3, sections: ["campaigns", "analytics"] },
];

const sectionMeta = Object.fromEntries(sectionItems.map((item) => [item.key, item])) as Record<
  Section,
  { key: Section; label: string; sublabel: string; icon: any }
>;

const getGroupForSection = (section: Section) =>
  navGroups.find((group) => group.sections.includes(section)) ?? navGroups[0];

const AUTH_API_BASE = `${API_URL}/auth`;

const Admin = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<NavGroupKey[]>(["dashboard", "commerce", "catalog"]);
  const activeGroup = getGroupForSection(activeSection);
  const activeSectionMeta = sectionMeta[activeSection];

  useEffect(() => {
    let active = true;

    const verifyAdminSession = async () => {
      try {
        const res = await fetch(`${AUTH_API_BASE}/admin-session`, {
          credentials: "include",
        });

        if (!active) return;
        setAuthenticated(res.ok);
      } catch {
        if (!active) return;
        setAuthenticated(false);
      } finally {
        if (active) {
          setCheckingAuth(false);
        }
      }
    };

    void verifyAdminSession();

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    const trimmedEmail = adminEmail.trim().toLowerCase();
    const trimmedPassword = password.trim();
    if (!trimmedEmail) {
      toast.error("Enter your admin email");
      return;
    }
    if (!trimmedPassword) {
      toast.error("Enter your admin password");
      return;
    }

    try {
      await apiFetch("/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({
          email: trimmedEmail,
          password: trimmedPassword,
        }),
      });

      setAuthenticated(true);
      setPassword("");
      toast.success("Welcome, Admin!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed. Check your server configuration.");
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = adminEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      toast.error("Enter your admin email first");
      return;
    }

    try {
      setResetSubmitting(true);
      const response = await apiFetch<{ message: string; reset_url?: string }>("/auth/admin/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email: trimmedEmail }),
      });
      toast.success(response.message || "If that admin account exists, a reset link has been sent.");
      if (response.reset_url) {
        toast.info(`Dev preview: ${response.reset_url}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request admin password reset");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleSelectSection = (section: Section) => {
    setActiveSection(section);
    const groupKey = getGroupForSection(section).key;
    setOpenGroups((current) => (current.includes(groupKey) ? current : [...current, groupKey]));
    setMobileNavOpen(false);
  };

  const toggleGroup = (groupKey: NavGroupKey) => {
    const group = navGroups.find((item) => item.key === groupKey);
    if (!group) return;
    if (group.sections.length === 1) {
      handleSelectSection(group.sections[0]);
      return;
    }
    setOpenGroups((current) =>
      current.includes(groupKey) ? current.filter((item) => item !== groupKey) : [...current, groupKey]
    );
  };

  const isGroupOpen = (groupKey: NavGroupKey) => openGroups.includes(groupKey);

  const handleLogout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout transport errors and clear the local view state anyway.
    } finally {
      sessionStorage.removeItem("admin_auth");
      sessionStorage.removeItem("admin_token");
      setAuthenticated(false);
      setMobileNavOpen(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          </div>
          <h1 className="mb-2 text-center font-serif text-2xl">Loading Admin</h1>
          <p className="text-center text-sm text-muted-foreground">Checking your admin session...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg"
        >
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Lock className="h-7 w-7 text-primary" />
            </div>
          </div>
          <h1 className="mb-2 text-center font-serif text-2xl">Admin Access</h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">Sign in with your admin account</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleLogin();
            }}
            className="space-y-4"
          >
            <Input
              type="email"
              placeholder="Admin email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="flex items-center justify-between gap-3 text-sm">
              <button type="button" onClick={handleForgotPassword} disabled={resetSubmitting} className="font-medium text-primary">
                {resetSubmitting ? "Sending..." : "Forgot password?"}
              </button>
              <span className="text-muted-foreground">We&apos;ll email a secure reset link.</span>
            </div>
            <Button type="submit" className="w-full rounded-xl" size="lg">
              Access Dashboard
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {"<-"} Back to Home
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <AnimatePresence>
        {mobileNavOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close admin navigation"
              onClick={() => setMobileNavOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-foreground/35 backdrop-blur-[1px] lg:hidden"
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-xs flex-col border-r border-border bg-card shadow-2xl lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-serif text-base font-semibold">Admin</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
                {navGroups.map((group) => {
                  const groupOpen = isGroupOpen(group.key);
                  const groupActive = activeGroup.key === group.key;
                  const hasChildren = group.sections.length > 1;
                  return (
                    <div key={group.key} className="space-y-1">
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all",
                          groupActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <group.icon className="h-4.5 w-4.5 shrink-0" />
                        <div className="min-w-0 flex-1 text-left">
                          <p className="leading-tight">{group.label}</p>
                          <p className="text-[10px] font-normal opacity-60">{group.sublabel}</p>
                        </div>
                        {hasChildren ? (
                          groupOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />
                        ) : null}
                      </button>
                      {hasChildren && groupOpen ? (
                        <div className="ml-5 space-y-1 border-l border-border pl-3">
                          {group.sections.map((sectionKey) => {
                            const item = sectionMeta[sectionKey];
                            return (
                              <button
                                key={sectionKey}
                                onClick={() => handleSelectSection(sectionKey)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                                  activeSection === sectionKey
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                )}
                              >
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </nav>

              <div className="space-y-1 border-t border-border p-2">
                <Link
                  href="/"
                  onClick={() => setMobileNavOpen(false)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Home className="h-4.5 w-4.5 shrink-0" />
                  <span>Back to Home</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4.5 w-4.5 shrink-0" />
                  <span>Logout</span>
                </button>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <aside
        className={cn(
          "hidden border-r border-border bg-card transition-all duration-300 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:flex-col",
          sidebarCollapsed ? "lg:w-16" : "lg:w-60"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Package className="h-4 w-4 text-primary" />
              </div>
              <span className="font-serif text-base font-semibold">Admin</span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => {
            const groupOpen = isGroupOpen(group.key);
            const groupActive = activeGroup.key === group.key;
            const hasChildren = group.sections.length > 1;

            if (sidebarCollapsed) {
              return (
                <button
                  key={group.key}
                  onClick={() => {
                    if (hasChildren) {
                      setSidebarCollapsed(false);
                      setOpenGroups((current) => (current.includes(group.key) ? current : [...current, group.key]));
                      return;
                    }
                    handleSelectSection(group.sections[0]);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    groupActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  title={group.label}
                >
                  <group.icon className="h-4.5 w-4.5 shrink-0" />
                </button>
              );
            }

            return (
              <div key={group.key} className="space-y-1">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    groupActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <group.icon className="h-4.5 w-4.5 shrink-0" />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="leading-tight">{group.label}</p>
                    <p className="text-[10px] font-normal opacity-60">{group.sublabel}</p>
                  </div>
                  {hasChildren ? (
                    groupOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />
                  ) : null}
                </button>
                {hasChildren && groupOpen ? (
                  <div className="ml-5 space-y-1 border-l border-border pl-3">
                    {group.sections.map((sectionKey) => {
                      const item = sectionMeta[sectionKey];
                      return (
                        <button
                          key={sectionKey}
                          onClick={() => handleSelectSection(sectionKey)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                            activeSection === sectionKey
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-border p-2">
          <Link
            href="/"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Home className="h-4.5 w-4.5 shrink-0" />
            {!sidebarCollapsed && <span>Back to Home</span>}
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4.5 w-4.5 shrink-0" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <main className={cn("min-w-0 flex-1 transition-all duration-300", sidebarCollapsed ? "lg:ml-16" : "lg:ml-60")}>
        <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen((open) => !open)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              >
                {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{activeGroup.label}</p>
                <h1 className="font-serif text-base sm:text-lg">{activeSectionMeta.label}</h1>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
          {activeSection === "dashboard" && <AdminDashboard onNavigate={handleSelectSection} />}
          {activeSection === "orders" && <AdminOrders />}
          {activeSection === "products" && <AdminProducts />}
          {activeSection === "affiliate_products" && <AdminAffiliateProducts />}
          {activeSection === "vendors" && <AdminVendors />}
          {activeSection === "campaigns" && <AdminCampaigns />}
          {activeSection === "vendor_outstanding" && <AdminVendorOutstanding />}
          {activeSection === "settlements" && <AdminSettlements />}
          {activeSection === "customers" && <AdminCustomers />}
          {activeSection === "delivery" && <AdminDeliveryPartners />}
          {activeSection === "warehouse" && <AdminWarehouse />}
          {activeSection === "workshops" && <AdminWorkshops />}
          {activeSection === "pinkpages" && <AdminPinkPages />}
          {activeSection === "content" && <AdminContent />}
          {activeSection === "engagement" && <AdminEngagement />}
          {activeSection === "analytics" && <AdminAnalytics />}
        </div>
      </main>
    </div>
  );
};

export default Admin;
