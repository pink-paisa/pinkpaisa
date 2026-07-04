import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FinancialCalculatorMenu from "@/components/financial/FinancialCalculatorMenu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { financialCalculatorGroups } from "@/data/financialCalculators";
import { ArrowRight, Calculator } from "lucide-react";

const groupDescriptions: Record<string, string> = {
  "Loan Calculators": "Estimate repayment, monthly obligations, and the full cost of borrowing before you take a loan.",
  "Investment & Return Calculators": "Compare recurring and one-time investment growth with clean, responsive calculator flows.",
};

const FinancialCalculatorLanding = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto py-10 md:py-16">
        <section className="mb-10 rounded-[32px] border border-border/80 bg-gradient-to-br from-card via-card to-accent/40 p-6 shadow-sm md:p-10">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-primary">Financial Calculator</p>
            <h1 className="mb-4 font-serif text-4xl leading-tight text-foreground md:text-5xl">
              Plan borrowing and investments with simple financial calculators.
            </h1>
            <p className="text-base leading-7 text-muted-foreground md:text-lg">
              Explore EMI, SIP, and lumpsum calculators in a responsive frontend flow that fits your current site theme.
            </p>
          </div>
          <div className="mt-8">
            <FinancialCalculatorMenu />
          </div>
        </section>

        <section className="space-y-5">
          {financialCalculatorGroups.map((group) => (
            <div key={group.title}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Calculator group</p>
                  <h2 className="font-serif text-2xl text-foreground">{group.title}</h2>
                </div>
              </div>

              <div className="mb-5 max-w-3xl rounded-[24px] border border-border/70 bg-card/70 p-5 text-sm leading-7 text-muted-foreground md:text-base">
                {groupDescriptions[group.title]}
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                {group.items.map((item) => (
                  <Card key={item.slug} className="rounded-[28px] border-border/80 bg-card shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                    <CardContent className="p-6 md:p-7">
                      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Calculator className="h-5 w-5" />
                      </div>
                      <h3 className="mb-2 font-serif text-2xl text-foreground">{item.title}</h3>
                      <p className="mb-6 text-sm leading-7 text-muted-foreground md:text-base">
                        {item.slug === "emi-calculator"
                          ? "Estimate monthly EMI, total interest, and total repayment with an optional amortization preview."
                          : "Open the dedicated calculator page to enter values, view estimated results, and switch between SIP and lumpsum layouts."}
                      </p>
                      <Button asChild className="rounded-xl">
                        <Link href={`/financial-calculator/${item.slug}`}>
                          Open calculator
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default FinancialCalculatorLanding;

