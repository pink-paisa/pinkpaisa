import { motion } from "framer-motion";
import { ThumbsUp, ThumbsDown, Users, MessageCircle, BarChart3 } from "lucide-react";

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

const formatVoters = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
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
  const yesPercent = total > 0 ? Math.round((poll.yes_count / total) * 100) : 50;
  const noPercent = 100 - yesPercent;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-lg"
    >
      {/* Category chip + vote count */}
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold capitalize text-accent-foreground">
          {poll.category}
        </span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* Live indicator */}
          <span className="flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            LIVE
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="px-5 py-4">
        <div className="mb-4 flex items-start gap-3">
          <span className="text-2xl leading-none">{poll.image_emoji}</span>
          <h3
            className="text-base font-semibold leading-snug text-foreground"
            style={{ textWrap: "balance" } as React.CSSProperties}
          >
            {poll.question}
          </h3>
        </div>

        {/* Voter count bar — Polymarket style */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span className="font-semibold tabular-nums text-foreground">{formatVoters(total)}</span>
            <span>{total === 1 ? "voter" : "voters"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="font-semibold tabular-nums text-primary">{yesPercent}%</span>
            <span>chance</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative mb-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-2.5 rounded-full bg-primary"
            initial={{ width: "50%" }}
            animate={{ width: `${yesPercent}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
        <div className="mb-4 flex justify-between text-xs font-medium text-muted-foreground">
          <span className="text-primary">{yesPercent}% Yes · {poll.yes_count}</span>
          <span>{noPercent}% No · {poll.no_count}</span>
        </div>

        {/* Vote buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onVote(poll.id, "yes")}
            disabled={!!userVote || isVoting}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 active:scale-[0.97] ${
              userVote === "yes"
                ? "border-primary bg-primary text-primary-foreground"
                : userVote
                  ? "cursor-not-allowed border-border bg-muted/50 text-muted-foreground"
                  : "border-primary/30 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10"
            }`}
          >
            <ThumbsUp className="h-4 w-4" />
            Yes
          </button>
          <button
            onClick={() => onVote(poll.id, "no")}
            disabled={!!userVote || isVoting}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 active:scale-[0.97] ${
              userVote === "no"
                ? "border-foreground bg-foreground text-background"
                : userVote
                  ? "cursor-not-allowed border-border bg-muted/50 text-muted-foreground"
                  : "border-foreground/30 bg-foreground/5 text-foreground hover:border-foreground hover:bg-foreground/10"
            }`}
          >
            <ThumbsDown className="h-4 w-4" />
            No
          </button>
        </div>

        {/* Comments link */}
        <button
          onClick={() => onOpenComments(poll.id)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:scale-[0.98]"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {commentCount > 0 ? `${commentCount} comments` : "Add comment"}
        </button>
      </div>
    </motion.div>
  );
};

export default PollCard;
