import { motion } from "framer-motion";
import { MessageCircle, ThumbsDown, ThumbsUp, Users } from "lucide-react";

export type Poll = {
  id: string;
  question: string;
  category: string;
  image_emoji: string;
  yes_count: number;
  no_count: number;
  created_at: string;
  ends_at: string | null;
};

const formatVoters = (value: number): string => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

const PollCard = ({
  poll,
  onVote,
  userVote,
  isVoting,
  commentCount,
  onOpenComments,
}: {
  poll: Poll;
  onVote: (pollId: string, vote: "yes" | "no") => void;
  userVote: string | null;
  isVoting: boolean;
  commentCount: number;
  onOpenComments: (pollId: string) => void;
}) => {
  const total = poll.yes_count + poll.no_count;
  const yesPercent = total > 0 ? Math.round((poll.yes_count / total) * 100) : 0;
  const noPercent = total > 0 ? 100 - yesPercent : 0;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-foreground/20"
    >
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
        <span className="rounded bg-accent px-2 py-1 text-[11px] font-bold capitalize text-accent-foreground">
          {poll.category}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-4 flex min-h-14 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl" aria-hidden="true">
            {poll.image_emoji}
          </span>
          <h3 className="text-[15px] font-bold leading-snug text-foreground">
            {poll.question}
          </h3>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onVote(poll.id, "yes")}
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
            onClick={() => onVote(poll.id, "no")}
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

        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {formatVoters(total)} votes</span>
          <span className="truncate">{total > 0 ? `${poll.yes_count} yes / ${poll.no_count} no` : "Be the first to vote"}</span>
        </div>

        <button
          type="button"
          onClick={() => onOpenComments(poll.id)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 border-t border-border/70 pt-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {commentCount > 0 ? `${commentCount} comments` : "Discuss"}
        </button>
      </div>
    </motion.article>
  );
};

export default PollCard;
