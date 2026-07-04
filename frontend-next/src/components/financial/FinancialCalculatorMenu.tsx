import Link from "next/link";
import { useRouter } from "next/router";
import { ChevronDown, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { financialCalculatorGroups } from "@/data/financialCalculators";

const FinancialCalculatorMenu = () => {
  const router = useRouter();
  const pathname = router.asPath.split("?")[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        {financialCalculatorGroups.map((group) => (
          <DropdownMenu key={group.title}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 rounded-2xl border-border bg-card px-4">
                <Calculator className="h-4 w-4 text-primary" />
                {group.title}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 rounded-2xl border-border p-2">
              <DropdownMenuLabel className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Choose calculator
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {group.items.map((item) => (
                <DropdownMenuItem key={item.slug} asChild>
                  <Link
                    href={`/financial-calculator/${item.slug}`}
                    className={`rounded-xl px-3 py-3 ${pathname.endsWith(item.slug) ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    {item.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>

      <div className="space-y-3 md:hidden">
        {financialCalculatorGroups.map((group) => (
          <div key={group.title} className="rounded-2xl border border-border/80 bg-card p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {group.title}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {group.items.map((item) => {
                const active = pathname.endsWith(item.slug);
                return (
                  <Link
                    key={item.slug}
                    href={`/financial-calculator/${item.slug}`}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground"
                    }`}
                  >
                    {item.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FinancialCalculatorMenu;

