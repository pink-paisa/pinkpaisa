import SeoHead from "@/components/SeoHead";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function PrivacyPage() {
  return (
    <>
      <SeoHead
        title="Privacy Policy"
        description="How Pink Paisa handles privacy, analytics, affiliate links, and sensitive information."
        canonicalPath="/privacy"
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto max-w-3xl py-12 md:py-20">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Privacy</p>
          <h1 className="mb-5 font-serif text-3xl md:text-4xl">Privacy Policy</h1>
          <div className="space-y-5 text-sm leading-7 text-muted-foreground md:text-base">
            <p>
              Pink Paisa uses basic account, order, vendor, and communication details only to operate the services requested
              by visitors, buyers, vendors, and admins.
            </p>
            <p>
              We use Microsoft Clarity on public buyer pages to understand aggregate user behavior through heatmaps,
              interaction analytics, and session recordings. This helps us improve product discovery, mobile layouts,
              Instagram landing pages, and affiliate click flows.
            </p>
            <p>
              Clarity is not used as a replacement for Amazon affiliate reports or order records. Pink Paisa does not send
              customer IDs, admin IDs, vendor IDs, emails, phone numbers, order IDs, or payment details to Clarity.
            </p>
            <p>
              Sensitive screens such as admin, vendor, account, checkout, payment, order, and password reset pages are
              excluded from Clarity tracking in our application. Sensitive form areas are masked where Clarity could
              otherwise see them.
            </p>
            <p>
              Affiliate links may take you to Amazon or another partner website. Those websites operate under their own
              privacy policies after you leave Pink Paisa.
            </p>
            <p>
              For privacy questions, contact Pink Paisa through the support email listed on the site.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
