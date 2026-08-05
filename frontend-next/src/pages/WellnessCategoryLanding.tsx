import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { AffiliateDisclosure } from "@/components/affiliate/AffiliateDisclosure";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import WellnessCollectionNav from "@/components/wellness/WellnessCollectionNav";
import WellnessProductCard from "@/components/wellness/WellnessProductCard";
import WellnessSeoIntro from "@/components/wellness/WellnessSeoIntro";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { WELLNESS_INSTAGRAM_PICKS_PATH, pickSectionProducts, type WellnessPageConfig } from "@/lib/wellnessSeo";

type WellnessCategoryLandingProps = {
  config: WellnessPageConfig;
  products: CatalogProduct[];
  collections: WellnessPageConfig[];
};

export default function WellnessCategoryLanding({
  config,
  products,
  collections,
}: WellnessCategoryLandingProps) {
  const sectionedProducts = config.bestForSections.map((section) => ({
    ...section,
    products: pickSectionProducts(products, section),
  }));

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <WellnessSeoIntro
          eyebrow={config.eyebrow}
          title={config.h1}
          description={config.intro}
          concerns={config.concerns}
        />

        <div className="container mx-auto space-y-10 py-8 md:py-12">
          <WellnessCollectionNav activePath={config.path} collections={collections} />

          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-serif text-2xl leading-tight">Curated {config.label.toLowerCase()} picks</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                These are published Pink Paisa affiliate finds that passed the public product filters.
                Open each product page for context before going to Amazon.
              </p>
              <div className="mt-4">
                <AffiliateDisclosure />
              </div>
            </div>
            <aside className="rounded-lg border border-border bg-secondary/50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Buyer intent</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Start with the concern, compare the product notes, then check current price and availability on Amazon.
              </p>
            </aside>
          </section>

          {products.length ? (
            <section>
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Top picks</p>
                  <h2 className="mt-2 font-serif text-2xl">Start with these products</h2>
                </div>
                <Link href="/products" className="hidden text-sm font-semibold text-primary hover:underline sm:inline-flex">
                  Browse all products
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {products.slice(0, 8).map((product) => (
                  <WellnessProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
              <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <h2 className="font-serif text-xl text-foreground">No published picks yet</h2>
              <p className="mt-2 text-sm">Publish compliant affiliate products in this category to populate this page.</p>
            </section>
          )}

          {sectionedProducts.map((section) => (
            <section key={section.title}>
              <div className="mb-4 max-w-3xl">
                <h2 className="font-serif text-2xl leading-tight">{section.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>
              </div>
              {section.products.length ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  {section.products.map((product) => (
                    <WellnessProductCard key={`${section.title}-${product.id}`} product={product} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No matching published picks yet.
                </div>
              )}
            </section>
          ))}

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">How to choose</p>
              <h2 className="mt-2 font-serif text-2xl">A safer way to compare picks</h2>
              <ul className="mt-4 space-y-3">
                {config.howToChoose.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-secondary/50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Next step</p>
              <h2 className="mt-2 font-serif text-2xl">Use this page for Instagram traffic</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Link reels, stories, and bio traffic here when the campaign focuses on {config.label.toLowerCase()}.
                UTM tracking can separate reel, story, bio, and campaign performance.
              </p>
              <Link
                href={WELLNESS_INSTAGRAM_PICKS_PATH}
                className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                View Instagram picks <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-2xl">Questions buyers ask</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {config.faqs.map((faq) => (
                <div key={faq.question} className="rounded-lg border border-border bg-card p-5">
                  <h3 className="font-medium">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
