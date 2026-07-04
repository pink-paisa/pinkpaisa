import { useMemo, useState } from "react";
import { BarChart3, CalendarClock, Landmark, Percent, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { FinancialCalculatorConfig } from "@/data/financialCalculators";

type CalculatorState = Record<string, number>;
type TenureType = "years" | "months";

type AmortizationRow = {
  month: number;
  emi: number;
  principal: number;
  interest: number;
  balance: number;
};

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

const getDefaults = (config: FinancialCalculatorConfig) =>
  config.inputs.reduce<CalculatorState>((acc, item) => {
    acc[item.key] = item.defaultValue;
    return acc;
  }, {});

const calculateEmi = (values: CalculatorState, tenureType: TenureType) => {
  const principal = values.loanAmount ?? 0;
  const annualRate = values.interestRate ?? 0;
  const tenureInput = Math.max(values.loanTenure ?? 0, 0);
  const months = tenureType === "years" ? tenureInput * 12 : tenureInput;

  if (principal <= 0 || months <= 0) {
    return {
      emi: 0,
      principalAmount: principal,
      totalInterest: 0,
      totalAmountPayable: principal,
      months,
      schedule: [] as AmortizationRow[],
    };
  }

  const monthlyRate = annualRate / 12 / 100;
  const emi = monthlyRate === 0
    ? principal / months
    : (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);

  const totalAmountPayable = emi * months;
  const totalInterest = Math.max(totalAmountPayable - principal, 0);

  let balance = principal;
  const schedule: AmortizationRow[] = [];

  for (let month = 1; month <= months; month += 1) {
    const interest = monthlyRate === 0 ? 0 : balance * monthlyRate;
    const principalPaid = month === months ? balance : Math.min(emi - interest, balance);
    balance = Math.max(balance - principalPaid, 0);

    schedule.push({
      month,
      emi,
      principal: principalPaid,
      interest,
      balance,
    });
  }

  return {
    emi,
    principalAmount: principal,
    totalInterest,
    totalAmountPayable,
    months,
    schedule,
  };
};

const summaryCards = [
  { key: "emi", label: "Monthly EMI", icon: Wallet },
  { key: "principalAmount", label: "Principal Amount", icon: Landmark },
  { key: "totalInterest", label: "Total Interest", icon: Percent },
  { key: "totalAmountPayable", label: "Total Amount Payable", icon: CalendarClock },
] as const;

const LoanEmiCalculator = ({ config }: { config: FinancialCalculatorConfig }) => {
  const [values, setValues] = useState<CalculatorState>(() => getDefaults(config));
  const [tenureType, setTenureType] = useState<TenureType>("years");

  const result = useMemo(() => calculateEmi(values, tenureType), [values, tenureType]);
  const previewSchedule = result.schedule.slice(0, 12);
  const principalShare = result.totalAmountPayable > 0 ? (result.principalAmount / result.totalAmountPayable) * 100 : 0;
  const interestShare = result.totalAmountPayable > 0 ? (result.totalInterest / result.totalAmountPayable) * 100 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card className="overflow-hidden rounded-[28px] border-border/80 bg-card shadow-sm">
        <CardContent className="p-6 md:p-8">
          <div className="mb-6 border-b border-border/70 pb-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Loan inputs</p>
            <h2 className="font-serif text-2xl text-foreground">Check your EMI before you apply</h2>
          </div>

          <div className="space-y-5">
            {config.inputs.map((field) => {
              const isTenureField = field.key === "loanTenure";
              const currentMax = isTenureField ? (tenureType === "years" ? 30 : 360) : field.max;
              const currentSuffix = isTenureField ? (tenureType === "years" ? "Years" : "Months") : field.suffix;

              return (
                <div key={field.key} className="rounded-2xl border border-border/80 bg-background/70 p-4">
                  <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <Label htmlFor={field.key} className="text-sm font-semibold text-foreground">
                      {field.label}
                    </Label>
                    <span className="text-xs text-muted-foreground">{field.helper}</span>
                  </div>

                  {isTenureField ? (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Tenure type
                      </div>
                      <ToggleGroup
                        type="single"
                        value={tenureType}
                        onValueChange={(next) => {
                          if (next === "years" || next === "months") {
                            setTenureType(next);
                          }
                        }}
                        className="rounded-2xl border border-border/70 bg-card p-1"
                      >
                        <ToggleGroupItem value="years" className="rounded-xl px-4 text-sm font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                          Years
                        </ToggleGroupItem>
                        <ToggleGroupItem value="months" className="rounded-xl px-4 text-sm font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                          Months
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  ) : null}

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
                      max={currentMax}
                      step={field.step ?? 1}
                      value={values[field.key] ?? 0}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: sanitizeValue(event.target.value),
                        }))
                      }
                      className={`h-12 rounded-2xl border-border bg-card text-base ${field.prefix ? "pl-10" : "pl-4"} ${currentSuffix ? "pr-24" : "pr-4"}`}
                    />
                    {currentSuffix ? (
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                        {currentSuffix}
                      </span>
                    ) : null}
                  </div>

                  {currentMax !== undefined ? (
                    <div>
                      <Slider
                        min={field.min ?? 0}
                        max={currentMax}
                        step={field.step ?? 1}
                        value={[Math.min(values[field.key] ?? 0, currentMax)]}
                        onValueChange={([val]) =>
                          setValues((current) => ({ ...current, [field.key]: val }))
                        }
                      />
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>{field.prefix ?? ""}{field.min ?? 0}{currentSuffix === "Years" ? " Yr" : currentSuffix === "Months" ? " Mo" : currentSuffix ?? ""}</span>
                        <span>
                          {field.prefix ?? ""}
                          {typeof currentMax === "number" && currentMax >= 100000 ? `${(currentMax / 100000).toFixed(0)}L` : currentMax}
                          {currentSuffix === "Years" ? " Yrs" : currentSuffix === "Months" ? " Mos" : currentSuffix ?? ""}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-[28px] border-border/80 bg-card shadow-sm">
          <CardContent className="p-6 md:p-8">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Result summary</p>
                <h2 className="font-serif text-2xl text-foreground">Estimated repayment</h2>
              </div>
              <div className="rounded-2xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">{result.months} monthly payments</div>
            </div>

            <div className="mb-6 rounded-[24px] border border-border/80 bg-background/70 p-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Monthly EMI</p>
                  <h3 className="font-serif text-3xl text-foreground md:text-4xl">{formatCurrency(result.emi)}</h3>
                </div>
                <Wallet className="h-9 w-9 text-primary" />
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-accent">
                <div className="h-full bg-primary" style={{ width: `${Math.min(principalShare, 100)}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Principal share {principalShare.toFixed(1)}%</span>
                <span>Interest share {interestShare.toFixed(1)}%</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {summaryCards.map(({ key, label, icon: Icon }) => (
                <div key={key} className="rounded-2xl border border-border/80 bg-background/70 p-4">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">{formatCurrency(result[key])}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/80 bg-card shadow-sm">
          <CardContent className="p-6 md:p-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">How it works</p>
            <h3 className="mb-3 font-serif text-2xl text-foreground">EMI breakdown</h3>
            <p className="mb-5 text-sm leading-7 text-muted-foreground md:text-base">{config.explanation}</p>

            <Accordion type="single" collapsible className="rounded-2xl border border-border/80 px-4">
              <AccordionItem value="amortization" className="border-none">
                <AccordionTrigger className="py-4 text-left text-sm font-semibold text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Amortization preview
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="px-2 py-2">Month</th>
                          <th className="px-2 py-2">EMI</th>
                          <th className="px-2 py-2">Principal</th>
                          <th className="px-2 py-2">Interest</th>
                          <th className="px-2 py-2">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewSchedule.map((row) => (
                          <tr key={row.month} className="rounded-2xl bg-background/70 text-sm text-foreground">
                            <td className="rounded-l-2xl px-2 py-3">{row.month}</td>
                            <td className="px-2 py-3">{formatCurrency(row.emi)}</td>
                            <td className="px-2 py-3">{formatCurrency(row.principal)}</td>
                            <td className="px-2 py-3">{formatCurrency(row.interest)}</td>
                            <td className="rounded-r-2xl px-2 py-3">{formatCurrency(row.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {result.schedule.length > previewSchedule.length ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Showing the first 12 months of the amortization schedule.
                    </p>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoanEmiCalculator;
