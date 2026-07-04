import { useMemo, useState } from "react";
import { TrendingUp, Wallet, PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { FinancialCalculatorConfig } from "@/data/financialCalculators";

type CalculatorState = Record<string, number>;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const sanitizeValue = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const calculateSip = (values: CalculatorState) => {
  const monthlyInvestment = values.monthlyInvestment ?? 0;
  const annualReturn = values.annualReturn ?? 0;
  const years = values.years ?? 0;

  const months = years * 12;
  const monthlyRate = annualReturn / 12 / 100;
  const investedAmount = monthlyInvestment * months;
  const totalValue = monthlyRate === 0
    ? investedAmount
    : monthlyInvestment * (((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate));

  return {
    investedAmount,
    estimatedReturns: Math.max(totalValue - investedAmount, 0),
    totalValue,
  };
};

const calculateLumpsum = (values: CalculatorState) => {
  const principal = values.oneTimeInvestment ?? 0;
  const annualReturn = values.annualReturn ?? 0;
  const years = values.years ?? 0;
  const totalValue = principal * Math.pow(1 + annualReturn / 100, years);

  return {
    investedAmount: principal,
    estimatedReturns: Math.max(totalValue - principal, 0),
    totalValue,
  };
};

const getDefaults = (config: FinancialCalculatorConfig) =>
  config.inputs.reduce<CalculatorState>((acc, item) => {
    acc[item.key] = item.defaultValue;
    return acc;
  }, {});

const InvestmentReturnCalculator = ({ config }: { config: FinancialCalculatorConfig }) => {
  const [values, setValues] = useState<CalculatorState>(() => getDefaults(config));

  const result = useMemo(() => {
    return config.slug === "sip-calculator" ? calculateSip(values) : calculateLumpsum(values);
  }, [config.slug, values]);

  const totalValue = result.totalValue || 0;
  const investedShare = totalValue > 0 ? (result.investedAmount / totalValue) * 100 : 0;
  const returnsShare = totalValue > 0 ? (result.estimatedReturns / totalValue) * 100 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card className="overflow-hidden rounded-[28px] border-border/80 bg-card shadow-sm">
        <CardContent className="p-6 md:p-8">
          <div className="mb-6 border-b border-border/70 pb-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Calculator inputs</p>
            <h2 className="font-serif text-2xl text-foreground">Enter your assumptions</h2>
          </div>

          <div className="space-y-5">
            {config.inputs.map((field) => (
              <div key={field.key} className="rounded-2xl border border-border/80 bg-background/70 p-4">
                <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor={field.key} className="text-sm font-semibold text-foreground">
                    {field.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">{field.helper}</span>
                </div>
                <div className="relative mb-4">
                  {field.prefix ? (
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      {field.prefix}
                    </span>
                  ) : null}
                  <Input
                    id={field.key}
                    type="number"
                    min={field.min ?? 0}
                    max={field.max}
                    step={field.step ?? 1}
                    value={values[field.key] ?? 0}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: sanitizeValue(event.target.value),
                      }))
                    }
                    className={`h-12 rounded-2xl border-border bg-card text-base ${field.prefix ? "pl-10" : "pl-4"} ${field.suffix ? "pr-20" : "pr-4"}`}
                  />
                  {field.suffix ? (
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      {field.suffix}
                    </span>
                  ) : null}
                </div>
                {field.max !== undefined ? (
                  <div>
                    <Slider
                      min={field.min ?? 0}
                      max={field.max}
                      step={field.step ?? 1}
                      value={[Math.min(values[field.key] ?? 0, field.max)]}
                      onValueChange={([val]) =>
                        setValues((current) => ({ ...current, [field.key]: val }))
                      }
                    />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>
                        {field.prefix ?? ""}{field.min ?? 0}{field.suffix === "Years" ? " Yr" : (field.suffix ?? "")}
                      </span>
                      <span>
                        {field.prefix ?? ""}{(field.max ?? 0) >= 100000 ? `${((field.max ?? 0) / 100000).toFixed(0)}L` : field.max}{field.suffix === "Years" ? " Yrs" : (field.suffix ?? "")}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-[28px] border-border/80 bg-card shadow-sm">
          <CardContent className="p-6 md:p-8">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Result summary</p>
                <h2 className="font-serif text-2xl text-foreground">Estimated value</h2>
              </div>
              <div className="rounded-2xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">Grow over time</div>
            </div>

            <div className="mb-6 rounded-[24px] border border-border/80 bg-background/70 p-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Value</p>
                  <h3 className="font-serif text-3xl text-foreground md:text-4xl">{formatCurrency(result.totalValue)}</h3>
                </div>
                <TrendingUp className="h-9 w-9 text-primary" />
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-accent">
                <div className="h-full bg-primary" style={{ width: `${Math.min(investedShare, 100)}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Invested share {investedShare.toFixed(1)}%</span>
                <span>Returns share {returnsShare.toFixed(1)}%</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-primary">
                  <Wallet className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">Invested Amount</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{formatCurrency(result.investedAmount)}</p>
              </div>
              <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-primary">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">Estimated Returns</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{formatCurrency(result.estimatedReturns)}</p>
              </div>
              <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-primary">
                  <PiggyBank className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{formatCurrency(result.totalValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/80 bg-card shadow-sm">
          <CardContent className="p-6 md:p-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">How it works</p>
            <h3 className="mb-3 font-serif text-2xl text-foreground">Simple explanation</h3>
            <p className="text-sm leading-7 text-muted-foreground md:text-base">{config.explanation}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default InvestmentReturnCalculator;
