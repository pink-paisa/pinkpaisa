import FinancialCalculatorLandingPage from "@/pages/FinancialCalculatorLanding";
import SeoHead from "@/components/SeoHead";

export default function FinancialCalculatorLandingRoute() {
  return (
    <>
      <SeoHead
        title="Financial Calculators"
        description="Use Pink Paisa financial calculators for EMI, investment return, and money planning scenarios."
        canonicalPath="/financial-calculator"
      />
      <FinancialCalculatorLandingPage />
    </>
  );
}
