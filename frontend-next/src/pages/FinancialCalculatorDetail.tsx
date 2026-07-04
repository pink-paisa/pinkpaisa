import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FinancialCalculatorTabs from "@/components/financial/FinancialCalculatorTabs";
import FinancialCalculatorMenu from "@/components/financial/FinancialCalculatorMenu";
import InvestmentReturnCalculator from "@/components/financial/InvestmentReturnCalculator";
import LoanEmiCalculator from "@/components/financial/LoanEmiCalculator";
import { getFinancialCalculator, type FinancialCalculatorKey } from "@/data/financialCalculators";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const investmentTabs: FinancialCalculatorKey[] = ["sip-calculator", "lumpsum-calculator"];

const FinancialCalculatorDetail = () => {
  const router = useRouter();
  const calculatorSlug = typeof router.query.calculatorSlug === "string" ? router.query.calculatorSlug : "";
  const calculator = getFinancialCalculator(calculatorSlug);

  useEffect(() => {
    if (!router.isReady || calculator) return;
    router.replace("/financial-calculator");
  }, [calculator, router]);

  if (!calculator) return null;

  const isInvestmentCalculator = investmentTabs.includes(calculator.slug as FinancialCalculatorKey);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto py-10 md:py-16">
        <section className="mb-8 rounded-[32px] border border-border/80 bg-gradient-to-br from-card via-card to-accent/40 p-6 shadow-sm md:p-10">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/financial-calculator">Financial Calculator</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{calculator.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="mt-5 max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-primary">{calculator.group}</p>
            <h1 className="mb-4 font-serif text-4xl leading-tight text-foreground md:text-5xl">{calculator.title}</h1>
            <p className="mb-6 text-base leading-7 text-muted-foreground md:text-lg">{calculator.description}</p>
            <div className="space-y-4">
              <FinancialCalculatorMenu />
              {isInvestmentCalculator ? <FinancialCalculatorTabs activeTab={calculator.slug as FinancialCalculatorKey} /> : null}
            </div>
          </div>
        </section>

        {calculator.layout === "emi" ? (
          <LoanEmiCalculator config={calculator} />
        ) : (
          <InvestmentReturnCalculator config={calculator} />
        )}
      </main>
      <Footer />
    </div>
  );
};

export default FinancialCalculatorDetail;
