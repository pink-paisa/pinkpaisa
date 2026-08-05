import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { AffiliateDisclosure } from "@/components/affiliate/AffiliateDisclosure";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import WellnessCollectionNav from "@/components/wellness/WellnessCollectionNav";
import WellnessProductCard from "@/components/wellness/WellnessProductCard";
import WellnessSeoIntro from "@/components/wellness/WellnessSeoIntro";
import type { CatalogProduct } from "@/hooks/useCatalogProducts";
import { WELLNESS_HUB_PATH, WELLNESS_HUB_SEO, WELLNESS_INSTAGRAM_PICKS_PATH, type WellnessPageConfig } from "@/lib/wellnessSeo";

type WellnessLandingProps = {
  products: CatalogProduct[];
  collections: WellnessPageConfig[];
};

export default function WellnessLanding({ products, collections }: WellnessLandingProps) {
  const concernChips = collections.length
    ? collections.slice(0, 5).map((collection) => collection.label)
    : ["Amazon finds"];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <WellnessSeoIntro
          eyebrow="Pink Paisa Wellness"
          title={WELLNESS_HUB_SEO.h1}
          description={WELLNESS_HUB_SEO.intro}
          concerns={concernChips}
        />

        <div className="container mx-auto space-y-10 py-8 md:py-12">
          <WellnessCollectionNav activePath={WELLNESS_HUB_PATH} collections={collections} />

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-serif text-2xl leading-tight">Start with a wellness collection</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Browse focused pages before opening Amazon. Pink Paisa keeps manual affiliate pages price-safe and asks buyers to confirm current details on Amazon.
            </p>
            <div className="mt-4">
              <AffiliateDisclosure />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {collections.map((config) => (
              <Link
                key={config.path}
                href={config.path}
                className="group rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{config.eyebrow}</p>
                <h2 className="mt-3 font-serif text-2xl leading-tight group-hover:text-primary">{config.label}</h2>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{config.intro}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  Open collection <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </section>

          <section>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Featured affiliate finds</p>
                <h2 className="mt-2 font-serif text-2xl">Recently curated products</h2>
              </div>
              <Link href={WELLNESS_INSTAGRAM_PICKS_PATH} className="hidden text-sm font-semibold text-primary hover:underline sm:inline-flex">
                View Instagram picks
              </Link>
            </div>
            {products.length ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {products.slice(0, 8).map((product) => (
                  <WellnessProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
                <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p>No published wellness affiliate picks are available yet.</p>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {[
              ["Search intent", "Create focused pages around problems buyers already search for, such as hair fall, dandruff, moisturizers, cleansers, and rose water."],
              ["Trust", "Give buyers clear use cases, pros, considerations, and disclosure before sending them to Amazon."],
              ["Measurement", "Use route-level CTR, affiliate CTA clicks, Clarity, and Instagram UTMs to identify which pages deserve more content."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-lg border border-border bg-secondary/50 p-5">
                <h2 className="font-serif text-xl">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
              </div>
            ))}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
