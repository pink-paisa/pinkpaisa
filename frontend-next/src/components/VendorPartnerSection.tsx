import Link from "next/link";
import { ArrowRight, BadgeCheck, FileSpreadsheet, Store } from "lucide-react";

const points = [
  { icon: Store, title: "Curated seller onboarding", text: "Join Pink Paisa with a polished application flow designed for premium wellness and lifestyle partners." },
  { icon: BadgeCheck, title: "Verification-first access", text: "Applications stay under review until approved, keeping the marketplace quality-led and brand-safe." },
  { icon: FileSpreadsheet, title: "Structured product uploads", text: "Verified vendors get a clean Excel workflow with validation, upload history, and product control." },
];

const VendorPartnerSection = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto">
        <div className="overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,240,244,0.94),rgba(255,248,240,0.96))] shadow-[0_24px_80px_rgba(190,120,145,0.18)]">
          <div className="grid gap-10 px-6 py-8 md:px-10 lg:grid-cols-[1.2fr,0.9fr] lg:px-14 lg:py-14">
            <div>
              <div className="inline-flex items-center rounded-full border border-white/70 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
                Sell with Pink Paisa
              </div>
              <h2 className="mt-5 max-w-xl font-serif text-4xl leading-tight text-foreground md:text-5xl">
                Grow your brand inside a polished, premium, feminine marketplace.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                Apply as a vendor, get verified by admin, and manage your catalog with a beautiful upload dashboard tailored for business-friendly operations.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href="/vendor/signup" className="inline-flex items-center rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:brightness-110">
                  Vendor Sign Up <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link href="/vendor/login" className="inline-flex items-center rounded-2xl border border-border bg-white/70 px-6 py-3 text-sm font-semibold text-foreground transition-all hover:bg-white">
                  Vendor Login
                </Link>
              </div>
            </div>
            <div className="grid gap-4">
              {points.map((point) => (
                <div key={point.title} className="rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-sm backdrop-blur-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f8d7df,#fde9d5)] text-primary shadow-sm">
                    <point.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{point.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{point.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default VendorPartnerSection;
