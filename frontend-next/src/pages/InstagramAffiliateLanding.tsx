import Link from "next/link";
import { Sparkles } from "lucide-react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { AffiliateCta } from "@/components/affiliate/AffiliateCta";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";

type InstagramAffiliateLandingProps = {
  title: string;
  description: string;
  products: CatalogProduct[];
  activeTab?: "home" | "picks" | "trending" | "campaign";
};

const tabs = [
  { key: "home", label: "Best Finds", href: "/instagram" },
  { key: "picks", label: "Instagram Picks", href: "/instagram/picks" },
  { key: "trending", label: "Trending Now", href: "/instagram/trending" },
] as const;

export default function InstagramAffiliateLanding({
  title,
  description,
  products,
  activeTab = "home",
}: InstagramAffiliateLandingProps) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto py-8 md:py-12">
        <section className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Pink Paisa Finds</p>
          <h1 className="max-w-3xl font-serif text-3xl leading-tight md:text-5xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">{description}</p>
        </section>

        <div className="mb-8 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/80"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {products.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {products.map((product) => (
              <article key={product.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm">
                <Link href={`/product/${product.slug}`} className="mb-4 aspect-square overflow-hidden rounded-xl bg-accent/30">
                  {product.featured_image ? (
                    <img src={product.featured_image} alt={product.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Sparkles className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                </Link>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{product.category}</p>
                <Link href={`/product/${product.slug}`} className="mt-2">
                  <h2 className="line-clamp-2 font-serif text-lg leading-tight hover:text-primary">{product.title}</h2>
                </Link>
                {product.short_description ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{product.short_description}</p>
                ) : null}
                <div className="mt-auto pt-4">
                  <AffiliateCta product={product} variant="product" className="w-full rounded-xl" />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>No published Amazon picks are available here yet.</p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
