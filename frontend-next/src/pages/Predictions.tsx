/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Search, Users, Clock, Filter } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PollCard, { type Poll } from "@/components/predictions/PollCard";
import TrendingSidebar from "@/components/predictions/TrendingSidebar";
import CommentsDrawer from "@/components/predictions/CommentsDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  "all", "politics", "finance", "business", "workplace",
  "sports", "policy", "tech", "economy", "education",
  "lifestyle", "environment",
];

const getFingerprint = () => {
  if (typeof window === "undefined") return "server-render";
  let fp = localStorage.getItem("pp_voter_fp");
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem("pp_voter_fp", fp);
  }
  return fp;
};

const Predictions = () => {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [votingPoll, setVotingPoll] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch polls + votes + comment counts
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
        votesRes.data.forEach((v: any) => (map[v.poll_id] = v.vote));
        setUserVotes(map);
      }
      if (commentsRes.data) {
        const counts: Record<string, number> = {};
        commentsRes.data.forEach((c: any) => {
          counts[c.poll_id] = (counts[c.poll_id] || 0) + 1;
        });
        setCommentCounts(counts);
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Real-time: live vote count updates + new polls
  useEffect(() => {
    const channel = supabase
      .channel("polls-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "polls" },
        (payload) => {
          const updated = payload.new as Poll;
          setPolls((prev) =>
            prev.map((p) =>
              p.id === updated.id
                ? { ...p, yes_count: updated.yes_count, no_count: updated.no_count }
                : p
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "polls" },
        (payload) => {
          const newPoll = payload.new as Poll;
          setPolls((prev) => [newPoll, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "polls" },
        (payload) => {
          const deletedId = (payload.old as any).id;
          setPolls((prev) => prev.filter((p) => p.id !== deletedId));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "poll_comments" },
        (payload) => {
          const newComment = payload.new as any;
          setCommentCounts((prev) => ({
            ...prev,
            [newComment.poll_id]: (prev[newComment.poll_id] || 0) + 1,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleVote = async (pollId: string, vote: "yes" | "no") => {
    setVotingPoll(pollId);
    const fp = getFingerprint();

    const { data, error } = await supabase.rpc("cast_vote", {
      p_poll_id: pollId,
      p_vote: vote,
      p_fingerprint: fp,
    });

    if (error) {
      if (error.message.includes("duplicate")) {
        toast({ title: "Already voted", description: "You've already cast your vote on this poll." });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
      setVotingPoll(null);
      return;
    }

    const result = data as any;
    setPolls((prev) =>
      prev.map((p) =>
        p.id === pollId
          ? { ...p, yes_count: result.yes_count, no_count: result.no_count }
          : p
      )
    );
    setUserVotes((prev) => ({ ...prev, [pollId]: vote }));
    setVotingPoll(null);
    toast({ title: "Vote recorded!", description: `You voted ${vote.toUpperCase()} 🎉` });
  };

  const filtered = useMemo(() => {
    return polls.filter((p) => {
      const matchCat = activeCategory === "all" || p.category === activeCategory;
      const matchSearch = !searchQuery || p.question.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [polls, activeCategory, searchQuery]);

  const totalVotes = polls.reduce((s, p) => s + p.yes_count + p.no_count, 0);
  const openPoll = polls.find((p) => p.id === openCommentsId);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-12 md:py-16">
          <motion.div
            initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold uppercase tracking-widest text-primary">
                Pink Predictions
              </span>
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
                LIVE
              </span>
            </div>
            <h1 className="font-serif text-3xl leading-tight md:text-4xl lg:text-5xl" style={{ lineHeight: 1.1 }}>
              What do Indian women think?
            </h1>
            <p className="mt-3 max-w-lg text-base text-muted-foreground" style={{ textWrap: "pretty" } as React.CSSProperties}>
              Vote on trending topics — from policy and finance to tech and lifestyle. Your voice shapes the conversation.
            </p>
            <div className="mt-5 flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {totalVotes.toLocaleString()} total votes
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {polls.length} active polls
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Filters */}
      <section className="sticky top-16 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative -mx-4 px-4 md:mx-0 md:px-0">
              <div className="pointer-events-none absolute inset-y-0 left-4 z-10 w-6 bg-gradient-to-r from-background via-background/90 to-transparent md:hidden" />
              <div className="pointer-events-none absolute inset-y-0 right-4 z-10 w-6 bg-gradient-to-l from-background via-background/90 to-transparent md:hidden" />
              <div className="flex gap-2 overflow-x-auto pb-1 pr-6 scrollbar-hidden scroll-smooth snap-x snap-mandatory md:flex-wrap md:overflow-visible md:pr-0">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`shrink-0 snap-start whitespace-nowrap rounded-full border px-4 py-1.5 text-xs font-semibold capitalize transition-all duration-200 active:scale-[0.96] ${
                      activeCategory === cat
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-muted text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search polls..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-input bg-card py-2 pl-9 pr-4 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Main content: Grid + Sidebar */}
      <section className="container mx-auto px-4 py-8 md:py-12">
        <div className="flex gap-8">
          {/* Polls grid */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-20 text-center">
                <Filter className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-lg font-medium text-muted-foreground">No polls found</p>
                <p className="text-sm text-muted-foreground/70">Try adjusting your filters</p>
              </motion.div>
            ) : (
              <motion.div layout className="grid gap-4 sm:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {filtered.map((poll) => (
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
          </div>

          {/* Trending sidebar - hidden on mobile */}
          <div className="hidden w-80 shrink-0 lg:block">
            {!loading && <TrendingSidebar polls={polls} />}
          </div>
        </div>
      </section>

      {/* Comments drawer */}
      <CommentsDrawer
        pollId={openCommentsId}
        pollQuestion={openPoll?.question || ""}
        isOpen={!!openCommentsId}
        onClose={() => setOpenCommentsId(null)}
      />

      <Footer />
    </div>
  );
};

export default Predictions;
