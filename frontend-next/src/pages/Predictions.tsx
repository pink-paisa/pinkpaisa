/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Filter, Flame, History, Search, Sparkles, TrendingUp, Users } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PollCard, { type Poll } from "@/components/predictions/PollCard";
import DailyPredictionCard, { type DailyPrediction } from "@/components/predictions/DailyPredictionCard";
import CommentsDrawer from "@/components/predictions/CommentsDrawer";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  capturePredictionVoteAttribution,
} from "@/lib/predictionVoteAttribution";
import { withStudyVoteCounts } from "@/lib/predictionStudyMode";

const CATEGORIES = [
  "all", "politics", "finance", "business", "workplace",
  "sports", "policy", "tech", "economy", "education",
  "lifestyle", "environment",
];

type SortMode = "trending" | "newest" | "most_voted";

const SORT_OPTIONS: Array<{ value: SortMode; label: string; icon: typeof TrendingUp }> = [
  { value: "trending", label: "Trending", icon: Flame },
  { value: "newest", label: "New", icon: History },
  { value: "most_voted", label: "Most voted", icon: Users },
];

type SortablePoll = {
  yes_count: number;
  no_count: number;
  created_at?: string;
  generated_at?: string;
};

const sortPolls = <T extends SortablePoll>(items: T[], mode: SortMode): T[] => {
  const timestamp = (item: T) => new Date(item.generated_at || item.created_at || 0).getTime();
  const votes = (item: T) => item.yes_count + item.no_count;
  return [...items].sort((a, b) => {
    if (mode === "newest") return timestamp(b) - timestamp(a);
    if (mode === "most_voted") return votes(b) - votes(a);
    const ageHoursA = Math.max((Date.now() - timestamp(a)) / 3600000, 0);
    const ageHoursB = Math.max((Date.now() - timestamp(b)) / 3600000, 0);
    const scoreA = votes(a) * 10 + Math.max(72 - ageHoursA, 0);
    const scoreB = votes(b) * 10 + Math.max(72 - ageHoursB, 0);
    return scoreB - scoreA;
  });
};

type DailyPredictionResponse = {
  enabled: boolean;
  status: "disabled" | "empty" | "live";
  batch_id?: string;
  date_key?: string;
  generated_at?: string;
  expires_at?: string;
  questions: DailyPrediction[];
};

const getFingerprint = () => {
  if (typeof window === "undefined") return "server-render";
  let fingerprint = localStorage.getItem("pp_voter_fp");
  if (!fingerprint) {
    fingerprint = crypto.randomUUID();
    localStorage.setItem("pp_voter_fp", fingerprint);
  }
  return fingerprint;
};

const formatRefreshCountdown = (expiresAt?: string, now = Date.now()) => {
  if (!expiresAt) return "Refreshes daily at 6:00 AM IST";
  const remaining = Math.max(new Date(expiresAt).getTime() - now, 0);
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return remaining > 0 ? `Refreshes in ${hours}h ${minutes}m` : "Refreshing soon";
};

const Predictions = () => {
  const isBetaLaunch = process.env.NEXT_PUBLIC_PREDICTIONS_LAUNCH_PHASE === "beta";
  const isStudyMode = process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_PREDICTIONS_STUDY_MODE === "true";
  const [polls, setPolls] = useState<Poll[]>([]);
  const [daily, setDaily] = useState<DailyPredictionResponse>({ enabled: false, status: "disabled", questions: [] });
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [dailyVotes, setDailyVotes] = useState<Record<string, string>>({});
  const [votingPoll, setVotingPoll] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("trending");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [studyGrowth, setStudyGrowth] = useState(0);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    capturePredictionVoteAttribution();
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      const [pollsRes, votesRes, commentsRes] = await Promise.all([
        supabase.from("polls").select("*").order("created_at", { ascending: false }),
        supabase.from("poll_votes").select("poll_id, vote").eq("voter_fingerprint", getFingerprint()),
        supabase.from("poll_comments").select("poll_id"),
      ]);

      if (pollsRes.data) setPolls(pollsRes.data);
      if (votesRes.data) {
        const map: Record<string, string> = {};
        votesRes.data.forEach((vote: any) => (map[vote.poll_id] = vote.vote));
        setUserVotes(map);
      }
      if (commentsRes.data) {
        const counts: Record<string, number> = {};
        commentsRes.data.forEach((comment: any) => {
          counts[comment.poll_id] = (counts[comment.poll_id] || 0) + 1;
        });
        setCommentCounts(counts);
      }
      setLoading(false);
    };
    void fetchAll();
  }, []);

  useEffect(() => {
    let active = true;
    const fetchDaily = async (silent = false) => {
      if (!silent) setDailyLoading(true);
      try {
        const result = await apiFetch<DailyPredictionResponse>("/predictions/daily");
        if (!active) return;
        setDaily(result);
        setDailyError(null);
        const savedVotes: Record<string, string> = {};
        result.questions.forEach((question) => {
          const saved = localStorage.getItem(`pp_daily_prediction_vote:${question.id}`);
          if (saved === "yes" || saved === "no") savedVotes[question.id] = saved;
        });
        setDailyVotes(savedVotes);
      } catch (error) {
        if (active) setDailyError(error instanceof Error ? error.message : "Today's predictions are unavailable");
      } finally {
        if (active) setDailyLoading(false);
      }
    };

    void fetchDaily();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchDaily(true);
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isStudyMode) return undefined;
    const interval = window.setInterval(() => {
      setStudyGrowth((current) => Math.min(current + 1, 50));
    }, 60000);
    return () => window.clearInterval(interval);
  }, [isStudyMode]);

  useEffect(() => {
    const channel = supabase
      .channel("polls-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "polls" }, (payload) => {
        const updated = payload.new as Poll;
        setPolls((previous) => previous.map((poll) => poll.id === updated.id
          ? { ...poll, yes_count: updated.yes_count, no_count: updated.no_count }
          : poll));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "polls" }, (payload) => {
        setPolls((previous) => [payload.new as Poll, ...previous]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "polls" }, (payload) => {
        const deletedId = (payload.old as any).id;
        setPolls((previous) => previous.filter((poll) => poll.id !== deletedId));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "poll_comments" }, (payload) => {
        const comment = payload.new as any;
        setCommentCounts((previous) => ({
          ...previous,
          [comment.poll_id]: (previous[comment.poll_id] || 0) + 1,
        }));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const handleVote = async (pollId: string, vote: "yes" | "no") => {
    setVotingPoll(pollId);
    const attribution = capturePredictionVoteAttribution();
    const { data, error } = await supabase.rpc("cast_vote", {
      p_poll_id: pollId,
      p_vote: vote,
      p_fingerprint: getFingerprint(),
      p_vote_source: attribution.vote_source,
      p_campaign: attribution.campaign,
    });

    if (error) {
      toast({
        title: error.message.includes("duplicate") ? "Already voted" : "Error",
        description: error.message.includes("duplicate") ? "You have already voted on this poll." : error.message,
        variant: error.message.includes("duplicate") ? undefined : "destructive",
      });
      setVotingPoll(null);
      return;
    }

    setPolls((previous) => previous.map((poll) => poll.id === pollId
      ? { ...poll, yes_count: data.yes_count, no_count: data.no_count }
      : poll));
    setUserVotes((previous) => ({ ...previous, [pollId]: vote }));
    setVotingPoll(null);
    toast({ title: "Vote recorded", description: `You voted ${vote.toUpperCase()}.` });
  };

  const handleDailyVote = async (pollId: string, vote: "yes" | "no") => {
    setVotingPoll(pollId);
    try {
      const attribution = capturePredictionVoteAttribution();
      const result = await apiFetch<{ yes_count: number; no_count: number }>(`/predictions/daily/${pollId}/vote`, {
        method: "POST",
        body: JSON.stringify({ vote, voter_fingerprint: getFingerprint(), ...attribution }),
      });
      setDaily((previous) => ({
        ...previous,
        questions: previous.questions.map((question) => question.id === pollId
          ? { ...question, yes_count: result.yes_count, no_count: result.no_count }
          : question),
      }));
      setDailyVotes((previous) => ({ ...previous, [pollId]: vote }));
      localStorage.setItem(`pp_daily_prediction_vote:${pollId}`, vote);
      toast({ title: "Vote recorded", description: "Your vote is part of today's community snapshot." });
    } catch (error) {
      toast({ title: "Could not record vote", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setVotingPoll(null);
    }
  };

  const matchesFilters = useCallback((poll: { category: string; question: string }) => {
    const matchesCategory = activeCategory === "all" || poll.category === activeCategory;
    const matchesSearch = !searchQuery || poll.question.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }, [activeCategory, searchQuery]);
  const displayedDaily = useMemo(
    () => isStudyMode ? daily.questions.map((question) => withStudyVoteCounts(question, studyGrowth)) : daily.questions,
    [daily.questions, isStudyMode, studyGrowth]
  );
  const displayedEditorial = useMemo(
    () => isStudyMode ? polls.map((poll) => withStudyVoteCounts(poll, studyGrowth)) : polls,
    [isStudyMode, polls, studyGrowth]
  );
  const filteredDaily = useMemo(
    () => sortPolls(displayedDaily.filter(matchesFilters), sortMode),
    [displayedDaily, matchesFilters, sortMode]
  );
  const filteredEditorial = useMemo(
    () => sortPolls(displayedEditorial.filter(matchesFilters), sortMode),
    [displayedEditorial, matchesFilters, sortMode]
  );
  const dailyEmptyTitle = dailyError
    ? "Today's questions are temporarily unavailable"
    : daily.status === "disabled"
      ? "Daily AI questions are paused"
      : daily.questions.length > 0
        ? "No daily questions match these filters"
        : "Today's question set has not been generated yet";
  const dailyEmptyDetail = dailyError || (daily.status === "disabled"
    ? "Pink Paisa editorial polls remain available below."
    : "Check back after the next scheduled generation at 6:00 AM IST.");
  const hotCategories = useMemo(() => {
    const totals = new Map<string, { polls: number; votes: number }>();
    [...displayedDaily, ...displayedEditorial].forEach((poll) => {
      const current = totals.get(poll.category) || { polls: 0, votes: 0 };
      current.polls += 1;
      current.votes += poll.yes_count + poll.no_count;
      totals.set(poll.category, current);
    });
    return [...totals.entries()]
      .sort((a, b) => (b[1].votes + b[1].polls) - (a[1].votes + a[1].polls))
      .slice(0, 5);
  }, [displayedDaily, displayedEditorial]);
  const openPoll = polls.find((poll) => poll.id === openCommentsId);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <section className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-5 md:py-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"
          >
            <div className="max-w-2xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase text-primary">
                  <TrendingUp className="h-4 w-4" /> Pink Predictions
                </span>
                <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Community voting live
                </span>
                {isBetaLaunch && (
                  <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                    Early community voting
                  </span>
                )}
              </div>
              <h1 className="font-serif text-2xl leading-tight md:text-3xl">What does India think today?</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Explore current questions, compare the community split, and cast your yes or no vote.
              </p>
            </div>
          </motion.div>
          <p className="mt-4 border-t border-border/70 pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Community responses are informal and are not a scientific or representative survey. Percentages show participant responses, not probabilities, research, financial advice, or betting markets.
          </p>
        </div>
      </section>

      <section className="sticky top-16 z-40 border-b border-border bg-background/95 shadow-sm backdrop-blur-md">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/70 py-2 scrollbar-hidden">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                  activeCategory === category
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-hidden">
              {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSortMode(value)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                    sortMode === value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search predictions"
                placeholder="Search predictions"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-6 md:py-8">
        {hotCategories.length > 0 && (
          <div className="mb-6 flex items-center gap-3 overflow-x-auto rounded-lg border border-border bg-card px-3 py-2 scrollbar-hidden">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-foreground">
              <Flame className="h-4 w-4 text-orange-500" /> Hot today
            </span>
            <span className="h-5 w-px shrink-0 bg-border" />
            {hotCategories.map(([category, activity], index) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                <span className="font-semibold text-muted-foreground">{index + 1}</span>
                <span className="font-semibold capitalize text-foreground">{category}</span>
                <span className="text-muted-foreground">{activity.votes.toLocaleString()} votes</span>
              </button>
            ))}
          </div>
        )}
        <main className="min-w-0 space-y-10">
            <section aria-labelledby="daily-predictions-heading">
              <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h2 id="daily-predictions-heading" className="text-xl font-bold">Today&apos;s Predictions</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Current India-relevant questions grounded in approved headline sources.</p>
                </div>
                {daily.generated_at && (
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(daily.generated_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} | {formatRefreshCountdown(daily.expires_at, clockNow)}
                  </p>
                )}
              </div>

              {dailyLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-lg bg-muted" />)}
                </div>
              ) : filteredDaily.length > 0 ? (
                <motion.div layout className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {filteredDaily.map((prediction) => (
                      <DailyPredictionCard
                        key={prediction.id}
                        prediction={prediction}
                        onVote={handleDailyVote}
                        userVote={dailyVotes[prediction.id] || null}
                        isVoting={votingPoll === prediction.id}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center">
                  <p className="font-medium">{dailyEmptyTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{dailyEmptyDetail}</p>
                </div>
              )}
            </section>

            <section aria-labelledby="editorial-polls-heading">
              <div className="mb-4 border-b border-border pb-3">
                <h2 id="editorial-polls-heading" className="text-xl font-bold">Pink Paisa Editorial Polls</h2>
                <p className="mt-1 text-sm text-muted-foreground">Longer-running questions selected by the Pink Paisa team.</p>
              </div>

              {loading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-60 animate-pulse rounded-lg bg-muted" />)}
                </div>
              ) : filteredEditorial.length === 0 ? (
                <div className="py-12 text-center">
                  <Filter className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" />
                  <p className="font-medium text-muted-foreground">No editorial polls match these filters</p>
                </div>
              ) : (
                <motion.div layout className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {filteredEditorial.map((poll) => (
                      <PollCard
                        key={poll.id}
                        poll={poll}
                        onVote={handleVote}
                        userVote={userVotes[poll.id] || null}
                        isVoting={votingPoll === poll.id}
                        commentCount={commentCounts[poll.id] || 0}
                        onOpenComments={setOpenCommentsId}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </section>
        </main>
      </section>

      <CommentsDrawer
        pollId={openCommentsId}
        pollQuestion={openPoll?.question || ""}
        isOpen={Boolean(openCommentsId)}
        onClose={() => setOpenCommentsId(null)}
      />
      <Footer />
    </div>
  );
};

export default Predictions;
