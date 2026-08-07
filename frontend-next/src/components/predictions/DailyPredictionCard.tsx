import { motion } from "framer-motion";
import { ExternalLink, Newspaper, ThumbsDown, ThumbsUp, Users } from "lucide-react";

export type DailyPrediction = {
  id: string;
  question: string;
  category: string;
  image_emoji: string;
  question_type: "opinion" | "short_term_forecast";
  source_refs: Array<{
    source: string;
    title: string;
    url: string;
    published_at: string;
  }>;
  generated_at: string;
  expires_at: string;
  yes_count: number;
  no_count: number;
  comments_enabled: false;
  source_type: "ai_daily";
};

const formatVoters = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

export default function DailyPredictionCard({
  prediction,
  onVote,
  userVote,
  isVoting,
}: {
  prediction: DailyPrediction;
  onVote: (pollId: string, vote: "yes" | "no") => void;
  userVote: string | null;
  isVoting: boolean;
}) {
  const total = prediction.yes_count + prediction.no_count;
  const yesPercent = total > 0 ? Math.round((prediction.yes_count / total) * 100) : 0;
  const noPercent = total > 0 ? 100 - yesPercent : 0;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-foreground/20"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <span className="rounded bg-primary/10 px-2 py-1 text-[11px] font-bold capitalize text-primary">
          {prediction.category}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Daily question
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-4 flex min-h-14 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl" aria-hidden="true">
            {prediction.image_emoji}
          </span>
          <h3 className="text-[15px] font-bold leading-snug text-foreground">{prediction.question}</h3>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onVote(prediction.id, "yes")}
            disabled={Boolean(userVote) || isVoting}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-sm font-bold transition-colors ${
              userVote === "yes"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : userVote
                  ? "cursor-not-allowed border-border bg-muted/50 text-muted-foreground"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400"
            }`}
          >
            <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" /> Yes</span>
            <span className="tabular-nums">{yesPercent}%</span>
          </button>
          <button
            type="button"
            onClick={() => onVote(prediction.id, "no")}
            disabled={Boolean(userVote) || isVoting}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-sm font-bold transition-colors ${
              userVote === "no"
                ? "border-rose-600 bg-rose-600 text-white"
                : userVote
                  ? "cursor-not-allowed border-border bg-muted/50 text-muted-foreground"
                  : "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400"
            }`}
          >
            <span className="flex items-center gap-1.5"><ThumbsDown className="h-4 w-4" /> No</span>
            <span className="tabular-nums">{noPercent}%</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {formatVoters(total)} votes</span>
          <span>{total > 0 ? `${prediction.yes_count} yes / ${prediction.no_count} no` : "Be the first to vote"}</span>
        </div>

        <details className="mt-3 border-t border-border/70 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-foreground">
            <Newspaper className="h-3.5 w-3.5" /> Based on today&apos;s coverage
          </summary>
          <div className="mt-2 space-y-2">
            {prediction.source_refs.map((source) => (
              <a
                key={`${prediction.id}-${source.url}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong>{source.source}:</strong> {source.title}</span>
              </a>
            ))}
          </div>
        </details>
      </div>
    </motion.article>
  );
}
