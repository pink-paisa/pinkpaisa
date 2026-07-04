import { motion } from "framer-motion";
import { TrendingUp, Flame, ArrowUp } from "lucide-react";
import type { Poll } from "./PollCard";

const TrendingSidebar = ({ polls }: { polls: Poll[] }) => {
  // Top polls by total votes
  const trending = [...polls]
    .sort((a, b) => (b.yes_count + b.no_count) - (a.yes_count + a.no_count))
    .slice(0, 5);

  // "Breaking" = most recent polls
  const breaking = [...polls]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 20, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {/* Breaking */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Flame className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Breaking</h2>
        </div>
        <div className="space-y-3">
          {breaking.map((poll, i) => {
            const total = poll.yes_count + poll.no_count;
            const yesP = total > 0 ? Math.round((poll.yes_count / total) * 100) : 50;
            return (
              <div key={poll.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{poll.question}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-bold text-primary">{yesP}%</span>
                    <span className="flex items-center gap-0.5 text-xs text-green-600">
                      <ArrowUp className="h-3 w-3" />
                      {total}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hot Topics */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Hot topics</h2>
        </div>
        <div className="space-y-2">
          {trending.map((poll, i) => {
            const total = poll.yes_count + poll.no_count;
            return (
              <div
                key={poll.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <span className="truncate text-sm font-medium text-foreground">{poll.category}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{total} votes</span>
                  <Flame className="h-3 w-3 text-orange-500" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.aside>
  );
};

export default TrendingSidebar;
