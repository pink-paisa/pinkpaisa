import SeoHead from "@/components/SeoHead";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DISCLOSURE_TEXT } from "@/components/affiliate/AffiliateDisclosure";

export default function AffiliateDisclosurePage() {
  return (
    <>
      <SeoHead
        title="Affiliate Disclosure"
        description="Pink Paisa disclosure for curated Amazon links and partner product recommendations."
        canonicalPath="/affiliate-disclosure"
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto max-w-3xl py-12 md:py-20">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Disclosure</p>
          <h1 className="mb-5 font-serif text-3xl md:text-4xl">Affiliate Disclosure</h1>
          <div className="space-y-4 text-sm leading-7 text-muted-foreground md:text-base">
            <p className="font-medium text-foreground">{DISCLOSURE_TEXT}</p>
            <p>
              Pink Paisa curates products to help readers make better buying decisions. Some product links take you to Amazon
              or another partner website.
            </p>
            <p>
              Amazon does not sponsor, endorse, or approve our recommendations. We do not provide rewards, rebates, points, or
              discounts for clicking affiliate links.
            </p>
            <p>
              Prices, availability, ratings, and reviews can change on Amazon. When Amazon API-approved data is not available,
              use the Amazon page as the current source before buying.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
