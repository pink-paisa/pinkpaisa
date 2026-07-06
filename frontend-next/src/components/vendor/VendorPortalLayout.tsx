import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useState } from "react";
import { BadgeCheck, FileSpreadsheet, History, Landmark, LayoutDashboard, LogOut, Menu, Package2, Store, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import VendorAssignedCategories from "@/components/vendor/VendorAssignedCategories";
import ErrorBoundary from "@/components/ui/error-boundary";

const DEFAULT_VENDOR_UPLOAD_LIMIT = 25;

const links = [
  { href: "/vendor/dashboard", label: "Overview", subtitle: "ERP summary", icon: LayoutDashboard },
  { href: "/vendor/profile", label: "Profile", subtitle: "Bank, KYC, contact", icon: User },
  { href: "/vendor/uploads", label: "Uploads", subtitle: "Import center", icon: FileSpreadsheet },
  { href: "/vendor/products", label: "Products", subtitle: "Catalog control", icon: Package2 },
  { href: "/vendor/orders", label: "Orders", subtitle: "Buyer order control", icon: Package2 },
  { href: "/vendor/payouts", label: "Payouts", subtitle: "Settlement history", icon: Landmark },
  { href: "/vendor/history", label: "History", subtitle: "Audit trail", icon: History },
];

const VendorPortalLayout = ({ children }: { children?: ReactNode }) => {
  const { vendor, logout } = useVendorAuth();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const uploadUsagePercent = Math.min(
    100,
    Math.round(
      ((vendor?.current_uploaded_count ?? 0) /
        Math.max(vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT, 1)) *
        100
    )
  );

  const isActiveLink = (href: string) =>
    router.asPath === href || router.asPath.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-[#fdf6f0] text-[#4a2030]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-24 h-72 w-72 rounded-full bg-[#fde5eb]/70 blur-3xl" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-[#fff0df]/70 blur-3xl" />
        <div className="absolute bottom-10 left-1/3 h-64 w-64 rounded-full bg-[#f6ebff]/60 blur-3xl" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-[#f2e5da] bg-white/90 backdrop-blur-md">
          <div className="container mx-auto flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-[#f0c0c8] bg-[#fff0f2] text-[#c05070] hover:bg-[#ffe7ed] lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open vendor navigation"
                aria-expanded={mobileNavOpen}
              >
                <Menu className="h-4 w-4" />
                Menu
              </Button>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f9c4d0,#e8a0b0)] shadow-sm">
                <Store className="h-5 w-5 text-[#8b3a57]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#4a2030]">Pink Paisa</p>
                <p className="text-[11px] text-[#c09090]">Vendor ERP Portal</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full bg-[#edfaf4] px-4 py-2 text-sm text-[#1a6a40] md:inline-flex">
                <BadgeCheck className="h-4 w-4" /> Active
              </div>
              <div className="rounded-full bg-[#fff6f8] px-4 py-2 text-sm text-[#c09090]">
                {vendor?.current_uploaded_count ?? 0} / {vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT}
              </div>
              <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-[#fff0f2] text-[#c05070] hover:bg-[#ffe7ed]" asChild>
                <Link href="/">Public site</Link>
              </Button>
              <Button variant="outline" className="rounded-full border-[#f0c0c8] bg-[#fff0f2] text-[#c05070] hover:bg-[#ffe7ed]" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" /> Logout
              </Button>
            </div>
          </div>
        </header>

        {mobileNavOpen ? (
          <div className="lg:hidden">
            <button
              type="button"
              aria-label="Close vendor navigation"
              className="fixed inset-0 z-40 bg-[#4a2030]/35 backdrop-blur-[1px]"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-xs overflow-y-auto border-r border-[#f0e0d5] bg-white p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fff0f2]">
                    <Store className="h-4 w-4 text-[#c05070]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#4a2030]">Vendor Portal</p>
                    <p className="text-[11px] text-[#c09090]">Navigation</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-full text-[#8a5363]"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close vendor navigation"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="rounded-[1.3rem] bg-[linear-gradient(135deg,#fef0f2,#fce8ec)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[#c09090]">Logged in as</p>
                <h2 className="mt-2 font-serif text-xl text-[#4a2030]">{vendor?.shop_name}</h2>
                <p className="mt-1 text-sm text-[#a07080]">{vendor?.owner_name}</p>
                <p className="mt-2 break-words text-xs text-[#b98c97]">{vendor?.email}</p>
                <div className="mt-4 rounded-[1rem] bg-white/85 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-[#b98c97]">
                    <span>Upload usage</span>
                    <span className="font-medium text-[#c05070]">{uploadUsagePercent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#f3d9e0]">
                    <div className="h-2 rounded-full bg-[linear-gradient(90deg,#e07090,#c05070)]" style={{ width: `${uploadUsagePercent}%` }} />
                  </div>
                </div>
              </div>
              <nav className="mt-4 space-y-2">
                {links.map((link) => {
                  const isActive = isActiveLink(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={`flex items-center gap-3 rounded-[1rem] px-4 py-3 transition-all ${
                        isActive
                          ? "bg-[linear-gradient(135deg,#c05070,#a03050)] text-white shadow-[0_14px_30px_rgba(160,48,80,0.22)]"
                          : "text-[#6a4050] hover:bg-[#fff6f7]"
                      }`}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isActive ? "bg-white/18" : "bg-[#fff2f4]"}`}>
                        <link.icon className={`h-4 w-4 ${isActive ? "text-white" : "text-[#c05070]"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-sm font-medium ${isActive ? "text-white" : "text-[#6a4050]"}`}>{link.label}</div>
                        <div className={`text-[11px] ${isActive ? "text-white/70" : "text-[#c09090]"}`}>{link.subtitle}</div>
                      </div>
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-4 rounded-[1.2rem] border border-[#f5ede5] bg-[#fffaf7] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[#6a4050]">
                  <Store className="h-4 w-4 text-[#c05070]" /> Assigned categories
                </div>
                <div className="mt-3">
                  <VendorAssignedCategories vendor={vendor} compact />
                </div>
              </div>
            </aside>
          </div>
        ) : null}

        <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-4 py-4 sm:px-6 lg:p-8">
          <aside className="hidden w-[240px] shrink-0 rounded-[1.6rem] border border-[#f0e0d5] bg-white/95 p-4 shadow-[0_22px_54px_rgba(186,131,149,0.10)] lg:block">
            <div className="rounded-[1.3rem] bg-[linear-gradient(135deg,#fef0f2,#fce8ec)] p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[#c09090]">Logged in as</p>
              <h2 className="mt-2 font-serif text-xl text-[#4a2030]">{vendor?.shop_name}</h2>
              <p className="mt-1 text-sm text-[#a07080]">{vendor?.owner_name}</p>
              <p className="mt-2 text-xs text-[#b98c97]">{vendor?.email}</p>
              <div className="mt-4 rounded-[1rem] bg-white/85 p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] text-[#b98c97]">
                  <span>Upload usage</span>
                  <span className="font-medium text-[#c05070]">{uploadUsagePercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#f3d9e0]">
                  <div
                    className="h-2 rounded-full bg-[linear-gradient(90deg,#e07090,#c05070)]"
                    style={{ width: `${uploadUsagePercent}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-[0.9rem] bg-[#fff8fa] px-2 py-3">
                    <div className="font-serif text-lg text-[#4a2030]">
                      {vendor?.current_uploaded_count ?? 0}
                      <span className="text-xs text-[#c09090]">/{vendor?.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT}</span>
                    </div>
                    <div className="text-[10px] text-[#c09090]">uploaded</div>
                  </div>
                  <div className="rounded-[0.9rem] bg-[#fff8fa] px-2 py-3">
                    <div className="font-serif text-lg text-[#4a2030]">{vendor?.remaining_slots ?? 0}</div>
                    <div className="text-[10px] text-[#c09090]">remaining</div>
                  </div>
                </div>
              </div>
            </div>

            <nav className="mt-4 space-y-2">
              {links.map((link) => {
                const isActive = isActiveLink(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-3 rounded-[1rem] px-4 py-3 transition-all ${
                      isActive
                        ? "bg-[linear-gradient(135deg,#c05070,#a03050)] text-white shadow-[0_14px_30px_rgba(160,48,80,0.22)]"
                        : "text-[#6a4050] hover:bg-[#fff6f7]"
                    }`}
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isActive ? "bg-white/18" : "bg-[#fff2f4]"}`}>
                      <link.icon className={`h-4 w-4 ${isActive ? "text-white" : "text-[#c05070]"}`} />
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${isActive ? "text-white" : "text-[#6a4050]"}`}>{link.label}</div>
                      <div className={`text-[11px] ${isActive ? "text-white/70" : "text-[#c09090]"}`}>{link.subtitle}</div>
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 rounded-[1.2rem] border border-[#f5ede5] bg-[#fffaf7] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#6a4050]">
                <Store className="h-4 w-4 text-[#c05070]" /> Assigned categories
              </div>
              <div className="mt-3">
                <VendorAssignedCategories vendor={vendor} compact />
              </div>
            </div>
          </aside>

          <main className="min-w-0 w-full space-y-6">
            <ErrorBoundary
              resetKey={router.asPath}
              title="Vendor page could not load"
              description="This vendor page failed while rendering. Reload the page and try again."
              actionLabel="Reload this page"
              onReset={() => router.reload()}
            >
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
};

export default VendorPortalLayout;
