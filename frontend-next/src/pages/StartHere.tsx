import Link from "next/link";
import { ArrowRight, Calculator, MessageSquareQuote, Sparkles, Target } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import { Button } from "@/components/ui/button";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { getAffiliateProductDisplayTitle } from "@/lib/affiliateProductDisplay";

type StartHereProps = {
  products: CatalogProduct[];
};

const steps = [
  {
    number: "01",
    eyebrow: "Understand your starting point",
    title: "Take the Wealthness Quiz",
    description: "Get your result immediately, with strengths, blind spots, and practical next steps. No sign-up is required to see it.",
    href: "/quiz",
    action: "Take the free quiz",
    icon: Target,
  },
  {
    number: "02",
    eyebrow: "Make the numbers clearer",
    title: "Use practical calculators",
    description: "Explore SIP, loan, return, and savings calculators designed for everyday money decisions.",
    href: "/financial-calculator",
    action: "Open calculators",
    icon: Calculator,
  },
] as const;

export default function StartHere({ products }: StartHereProps) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="bg-rose-soft py-16 md:py-24">
          <div className="container mx-auto max-w-4xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Pink Paisa · Start Here</p>
            <h1 className="font-serif text-4xl leading-tight md:text-6xl">One clear path from insight to action</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Begin with your money habits, make the numbers clearer, explore carefully selected finds, or request a workshop quote.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-20">
          <div className="container mx-auto grid gap-6 md:grid-cols-2">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <article key={step.number} className="rounded-3xl border border-border bg-card p-7 shadow-sm md:p-9">
                  <div className="mb-7 flex items-center justify-between">
                    <span className="font-serif text-4xl text-primary/25">{step.number}</span>
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary"><Icon className="h-6 w-6" /></span>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{step.eyebrow}</p>
                  <h2 className="mt-3 font-serif text-3xl leading-tight">{step.title}</h2>
                  <p className="mt-4 leading-7 text-muted-foreground">{step.description}</p>
                  <Button asChild size="lg" className="mt-7 rounded-xl">
                    <Link href={step.href}>{step.action}<ArrowRight className="h-4 w-4" /></Link>
                  </Button>
                </article>
              );
            })}
          </div>
        </section>

        {products.length ? (
          <section className="bg-secondary/50 py-16 md:py-20">
            <div className="container mx-auto">
              <div className="mb-10 max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">03 · Curated picks</p>
                <h2 className="mt-3 font-serif text-3xl leading-tight md:text-4xl">Selected by Pink Paisa, link-checked before display</h2>
                <p className="mt-4 text-muted-foreground">These are Amazon affiliate links. Confirm current price and availability with the retailer.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {products.slice(0, 6).map((product) => {
                  const displayTitle = getAffiliateProductDisplayTitle(product);
                  return (
                    <article key={product.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                      <Link href={`/product/${product.slug}`} className="aspect-square overflow-hidden bg-accent/30">
                        {product.featured_image ? (
                          <img src={product.featured_image} alt={displayTitle} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" decoding="async" />
                        ) : (
                          <span className="flex h-full items-center justify-center"><Sparkles className="h-10 w-10 text-muted-foreground/30" /></span>
                        )}
                      </Link>
                      <div className="flex flex-1 flex-col p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{product.category}</p>
                        <Link href={`/product/${product.slug}`} className="mt-2 font-serif text-xl leading-tight hover:text-primary">{displayTitle}</Link>
                        {product.short_description ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{product.short_description}</p> : null}
                        <div className="mt-auto pt-5"><AffiliateCta product={product} variant="product" className="w-full rounded-xl" /></div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <Button asChild variant="outline" size="lg" className="mt-8 rounded-xl">
                <Link href="/instagram/picks">View all healthy curated picks<ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </section>
        ) : null}

        <section className="py-16 md:py-24">
          <div className="container mx-auto">
            <div className="mx-auto max-w-3xl rounded-3xl bg-primary px-7 py-12 text-center text-primary-foreground shadow-xl shadow-primary/20 md:px-12">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/15"><MessageSquareQuote className="h-6 w-6" /></span>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{products.length ? "04" : "03"} · Workshop quote</p>
              <h2 className="mt-3 font-serif text-3xl md:text-4xl">Planning a session for your team?</h2>
              <p className="mx-auto mt-4 max-w-xl leading-7 opacity-90">Workshop inventory is not sold online yet. Tell us your group size and goals to receive a tailored quote.</p>
              <Button asChild variant="hero-outline" size="xl" className="mt-7 border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                <Link href="/workshops#custom-quote">Request a workshop quote</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
