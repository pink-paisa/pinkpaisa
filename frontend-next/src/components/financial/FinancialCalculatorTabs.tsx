import { useMemo } from "react";
import { useRouter } from "next/router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FinancialCalculatorKey } from "@/data/financialCalculators";

const tabValues: FinancialCalculatorKey[] = ["sip-calculator", "lumpsum-calculator"];

const FinancialCalculatorTabs = ({ activeTab }: { activeTab: FinancialCalculatorKey }) => {
  const router = useRouter();

  const value = useMemo(() => (tabValues.includes(activeTab) ? activeTab : "sip-calculator"), [activeTab]);

  return (
    <Tabs value={value} onValueChange={(next) => router.push(`/financial-calculator/${next}`)}>
      <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-accent/70 p-1 sm:w-80">
        <TabsTrigger value="sip-calculator" className="rounded-xl px-5 py-2.5 text-sm font-semibold">
          SIP Calculator
        </TabsTrigger>
        <TabsTrigger value="lumpsum-calculator" className="rounded-xl px-5 py-2.5 text-sm font-semibold">
          Lumpsum Calculator
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

export default FinancialCalculatorTabs;

