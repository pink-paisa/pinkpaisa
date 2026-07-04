export type FinancialCalculatorKey = "emi-calculator" | "sip-calculator" | "lumpsum-calculator";

export type FinancialCalculatorGroup = "Loan Calculators" | "Investment & Return Calculators";
export type FinancialCalculatorLayout = "emi" | "investment";

export type FinancialCalculatorConfig = {
  slug: FinancialCalculatorKey;
  title: string;
  shortLabel: string;
  group: FinancialCalculatorGroup;
  layout: FinancialCalculatorLayout;
  description: string;
  explanation: string;
  inputs: Array<{
    key: string;
    label: string;
    helper: string;
    prefix?: string;
    suffix?: string;
    min?: number;
    max?: number;
    step?: number;
    defaultValue: number;
  }>;
};

export const financialCalculatorGroups = [
  {
    title: "Loan Calculators",
    items: [{ slug: "emi-calculator", title: "EMI Calculator" }],
  },
  {
    title: "Investment & Return Calculators",
    items: [
      { slug: "sip-calculator", title: "SIP Calculator" },
      { slug: "lumpsum-calculator", title: "Lumpsum Calculator" },
    ],
  },
] as const;

export const financialCalculators: Record<FinancialCalculatorKey, FinancialCalculatorConfig> = {
  "emi-calculator": {
    slug: "emi-calculator",
    title: "EMI Calculator",
    shortLabel: "EMI",
    group: "Loan Calculators",
    layout: "emi",
    description:
      "Estimate your monthly EMI, total interest outgo, and total repayment before you commit to a loan.",
    explanation:
      "This EMI calculator uses the standard reducing-balance formula. Enter your loan amount, annual interest rate, and tenure to estimate your monthly installment, total interest, and full repayment value. You can also review an amortization snapshot to understand how principal and interest get split over time.",
    inputs: [
      {
        key: "loanAmount",
        label: "Loan Amount",
        helper: "Total amount you plan to borrow.",
        prefix: "₹",
        min: 10000,
        max: 50000000,
        step: 10000,
        defaultValue: 1500000,
      },
      {
        key: "interestRate",
        label: "Interest Rate (% per annum)",
        helper: "Your lender's annual reducing-balance interest rate.",
        suffix: "%",
        min: 1,
        max: 30,
        step: 0.1,
        defaultValue: 9.5,
      },
      {
        key: "loanTenure",
        label: "Loan Tenure",
        helper: "Enter tenure and switch between years or months.",
        min: 1,
        max: 360,
        step: 1,
        defaultValue: 20,
      },
    ],
  },
  "sip-calculator": {
    slug: "sip-calculator",
    title: "SIP Calculator",
    shortLabel: "SIP",
    group: "Investment & Return Calculators",
    layout: "investment",
    description:
      "Estimate the future value of your monthly SIP with projected annual returns and investment duration.",
    explanation:
      "This calculator assumes a monthly SIP contribution and monthly compounding based on the annual return entered above. It gives you a simple estimate of invested amount, estimated returns, and total portfolio value.",
    inputs: [
      {
        key: "monthlyInvestment",
        label: "Monthly Investment Amount",
        helper: "How much you plan to invest every month.",
        prefix: "₹",
        min: 500,
        max: 200000,
        step: 500,
        defaultValue: 25000,
      },
      {
        key: "annualReturn",
        label: "Expected Annual Return (%)",
        helper: "Expected yearly return before inflation and taxes.",
        suffix: "%",
        min: 1,
        max: 30,
        step: 0.5,
        defaultValue: 12,
      },
      {
        key: "years",
        label: "Time Period (Years)",
        helper: "How long you want to stay invested.",
        suffix: "Years",
        min: 1,
        max: 40,
        step: 1,
        defaultValue: 10,
      },
    ],
  },
  "lumpsum-calculator": {
    slug: "lumpsum-calculator",
    title: "Lumpsum Calculator",
    shortLabel: "Lumpsum",
    group: "Investment & Return Calculators",
    layout: "investment",
    description:
      "Estimate how a one-time investment can grow over time based on your expected annual return.",
    explanation:
      "This calculator assumes a one-time investment with annual compounding. Use it to compare your principal amount with the total maturity value and estimated growth over the selected period.",
    inputs: [
      {
        key: "oneTimeInvestment",
        label: "One-Time Investment Amount",
        helper: "The amount you invest once at the start.",
        prefix: "₹",
        min: 1000,
        max: 10000000,
        step: 1000,
        defaultValue: 500000,
      },
      {
        key: "annualReturn",
        label: "Expected Annual Return (%)",
        helper: "Expected yearly return before inflation and taxes.",
        suffix: "%",
        min: 1,
        max: 30,
        step: 0.5,
        defaultValue: 12,
      },
      {
        key: "years",
        label: "Time Period (Years)",
        helper: "How long the investment stays invested.",
        suffix: "Years",
        min: 1,
        max: 40,
        step: 1,
        defaultValue: 10,
      },
    ],
  },
};

export const getFinancialCalculator = (slug: string) => {
  if (slug in financialCalculators) {
    return financialCalculators[slug as FinancialCalculatorKey];
  }
  return null;
};
