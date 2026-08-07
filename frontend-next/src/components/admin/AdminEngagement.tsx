/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, Plus, Pencil, Trash2, TrendingUp, MessageCircle, CheckCircle2, EyeOff, Sparkles, RefreshCw, Rss, AlertTriangle, X, Copy } from "lucide-react";
import { toast } from "sonner";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { StatCard, LoadingSpinner, EmptyState, Field, FormCard, IconBtn, POLL_CATEGORIES } from "./AdminShared";

type PollRow = {
  id: string;
  question: string;
  category: string;
  image_emoji: string | null;
  yes_count: number;
  no_count: number;
  createdAt?: string;
  created_at?: string;
  ends_at: string | null;
};

type PollForm = {
  question: string;
  category: string;
  image_emoji: string;
  ends_at: string;
};

type PollCommentRow = {
  id: string;
  poll_id: string;
  author_name: string;
  content: string;
  status: string;
  created_at?: string;
};

type AiPredictionQuestion = {
  id: string;
  question: string;
  category: string;
  image_emoji: string;
  yes_count: number;
  no_count: number;
  beta_launch_votes: number;
  organic_votes: number;
  expires_at: string;
};

type PredictionVoteAnalytics = {
  total_genuine_votes: number;
  beta_launch_votes: number;
  organic_votes: number;
  unique_voting_fingerprints: number;
  duplicate_attempts: number;
  rate_limited_attempts: number;
};

const emptyPredictionVoteAnalytics: PredictionVoteAnalytics = {
  total_genuine_votes: 0,
  beta_launch_votes: 0,
  organic_votes: 0,
  unique_voting_fingerprints: 0,
  duplicate_attempts: 0,
  rate_limited_attempts: 0,
};

type AiPredictionStatus = {
  predictions_ai_enabled: boolean;
  predictions_daily_count: number;
  predictions_generation_hour_ist: number;
  predictions_generation_minute_ist: number;
  env_enabled: boolean;
  openai_ready: boolean;
  redis_ready: boolean;
  can_generate: boolean;
  disabled_reason: string | null;
  feeds: Array<{ name: string; url: string; category: string; primary_source: boolean }>;
  current_batch: null | {
    generated_at: string;
    expires_at: string;
    questions: AiPredictionQuestion[];
  };
  vote_analytics?: PredictionVoteAnalytics & {
    editorial: PredictionVoteAnalytics;
    daily: PredictionVoteAnalytics;
  };
  last_status: null | {
    status: string;
    generated_at?: string;
    failed_at?: string;
    article_count?: number;
    topic_count?: number;
    accepted_count?: number;
    rejected_count?: number;
    error?: string | null;
    feed_health?: Array<{ name: string; ok: boolean; item_count: number; error: string | null }>;
  };
};

const emptyPollForm: PollForm = {
  question: "",
  category: "trending",
  image_emoji: "📊",
  ends_at: "",
};

export const AdminEngagement = () => {
  const betaInviteUrl = `${String(process.env.NEXT_PUBLIC_SITE_URL || "https://pinkpaisa.in").replace(/\/$/, "")}/predictions?utm_source=beta_group&utm_medium=community&utm_campaign=predictions_beta_launch`;
  const [adminPolls, setAdminPolls] = useState<PollRow[]>([]);
  const [pollsLoading, setPollsLoading] = useState(false);
  const [showPollForm, setShowPollForm] = useState(false);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [pollForm, setPollForm] = useState<PollForm>(emptyPollForm);
  const [savingPoll, setSavingPoll] = useState(false);
  const [pollSearch, setPollSearch] = useState("");
  const [pollToDelete, setPollToDelete] = useState<PollRow | null>(null);
  const [flaggedComments, setFlaggedComments] = useState<PollCommentRow[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiPredictionStatus | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [clearAiOpen, setClearAiOpen] = useState(false);
  const voteAnalytics = aiStatus?.vote_analytics ?? emptyPredictionVoteAnalytics;

  const fetchPolls = async () => {
    setPollsLoading(true);
    try {
      const data = await apiFetch<PollRow[]>("/polls?_sort=createdAt&_order=desc");
      setAdminPolls(data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load polls");
    } finally {
      setPollsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPolls();
  }, []);

  const fetchFlaggedComments = async () => {
    setCommentsLoading(true);
    try {
      const data = await apiFetch<PollCommentRow[]>("/polls/comments?status=flagged");
      setFlaggedComments(data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load flagged comments");
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    void fetchFlaggedComments();
  }, []);

  const fetchAiStatus = async () => {
    setAiLoading(true);
    try {
      setAiStatus(await apiFetch<AiPredictionStatus>("/admin/predictions-ai"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load daily prediction status");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    void fetchAiStatus();
  }, []);

  const updateAiSettings = async (updates: Partial<Pick<AiPredictionStatus, "predictions_ai_enabled" | "predictions_daily_count">>) => {
    if (!aiStatus) return;
    setAiSaving(true);
    try {
      await apiFetch("/admin/predictions-ai", {
        method: "PUT",
        body: JSON.stringify({
          predictions_ai_enabled: updates.predictions_ai_enabled ?? aiStatus.predictions_ai_enabled,
          predictions_daily_count: updates.predictions_daily_count ?? aiStatus.predictions_daily_count,
          predictions_generation_hour_ist: aiStatus.predictions_generation_hour_ist,
          predictions_generation_minute_ist: aiStatus.predictions_generation_minute_ist,
        }),
      });
      toast.success("Daily prediction settings updated");
      await fetchAiStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update daily prediction settings");
    } finally {
      setAiSaving(false);
    }
  };

  const generateAiPredictions = async () => {
    setAiSaving(true);
    try {
      await apiFetch("/admin/predictions-ai/generate-now", { method: "POST" });
      toast.success("Today's AI prediction set is live");
      await fetchAiStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate daily predictions");
    } finally {
      setAiSaving(false);
    }
  };

  const removeAiQuestion = async (questionId: string) => {
    try {
      await apiFetch(`/admin/predictions-ai/current/${questionId}`, { method: "DELETE" });
      toast.success("Temporary question removed");
      await fetchAiStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove temporary question");
    }
  };

  const clearAiPredictions = async () => {
    try {
      await apiFetch("/admin/predictions-ai/current/clear", { method: "POST" });
      toast.success("Today's AI predictions cleared");
      setClearAiOpen(false);
      await fetchAiStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear daily predictions");
    }
  };

  const savePoll = async () => {
    if (!pollForm.question.trim()) {
      toast.error("Question required");
      return;
    }

    setSavingPoll(true);
    const payload = {
      question: pollForm.question.trim(),
      category: pollForm.category,
      image_emoji: pollForm.image_emoji || "📊",
      ends_at: pollForm.ends_at || null,
    };

    try {
      await apiFetch(editingPollId ? `/polls/${editingPollId}` : "/polls", {
        method: editingPollId ? "PUT" : "POST",
        body: JSON.stringify(editingPollId ? payload : { ...payload, yes_count: 0, no_count: 0 }),
      });
      toast.success(editingPollId ? "Poll updated" : "Poll created");
      setShowPollForm(false);
      await fetchPolls();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save poll");
    } finally {
      setSavingPoll(false);
    }
  };

  const deletePoll = async () => {
    if (!pollToDelete) return;

    try {
      await apiFetch(`/polls/${pollToDelete.id}`, { method: "DELETE" });
      toast.success("Poll deleted");
      setPollToDelete(null);
      await fetchPolls();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete poll");
    }
  };

  const openEditPoll = (poll: PollRow) => {
    setEditingPollId(poll.id);
    setPollForm({
      question: poll.question,
      category: poll.category,
      image_emoji: poll.image_emoji ?? "📊",
      ends_at: poll.ends_at ? poll.ends_at.slice(0, 16) : "",
    });
    setShowPollForm(true);
  };

  const filteredPolls = useMemo(
    () => adminPolls.filter((poll) => !pollSearch || poll.question.toLowerCase().includes(pollSearch.toLowerCase())),
    [adminPolls, pollSearch],
  );

  const pollAnalytics = useMemo(() => {
    const totalsByCategory = adminPolls.reduce((acc, poll) => {
      acc[poll.category] = (acc[poll.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topCategory = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const totalVotes = adminPolls.reduce((sum, poll) => sum + Number(poll.yes_count || 0) + Number(poll.no_count || 0), 0);
    return {
      total: adminPolls.length,
      totalVotes,
      avgVotes: adminPolls.length > 0 ? Math.round(totalVotes / adminPolls.length) : 0,
      topCategory,
      flaggedComments: flaggedComments.length,
    };
  }, [adminPolls, flaggedComments.length]);

  const updateCommentStatus = async (commentId: string, status: "visible" | "hidden") => {
    try {
      await apiFetch(`/polls/comments/${commentId}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      toast.success(status === "visible" ? "Comment approved" : "Comment hidden");
      await fetchFlaggedComments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update comment");
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await apiFetch(`/polls/comments/${commentId}`, { method: "DELETE" });
      toast.success("Comment deleted");
      await fetchFlaggedComments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete comment");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-serif text-2xl">Engagement</h2>
        <p className="text-sm text-muted-foreground">Manage polls, user interactions, and community engagement.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Polls" value={pollAnalytics.total} />
        <StatCard label="Total Votes" value={pollAnalytics.totalVotes.toLocaleString()} color="text-primary" />
        <StatCard label="Avg Votes/Poll" value={pollAnalytics.avgVotes} color="text-blue-600" />
        <StatCard label="Top Category" value={pollAnalytics.topCategory} color="text-emerald-600" />
        <StatCard label="Flagged Comments" value={pollAnalytics.flaggedComments} color="text-amber-600" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="daily-ai-predictions-title">
        <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h3 id="daily-ai-predictions-title" className="font-serif text-xl">Daily AI Predictions</h3>
              {aiStatus && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  aiStatus.predictions_ai_enabled && aiStatus.can_generate
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}>
                  {aiStatus.predictions_ai_enabled && aiStatus.can_generate ? "Automatic" : "Paused"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Generates temporary, source-backed community questions at 6:00 AM IST. Valid questions publish automatically without approval and expire the next day.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchAiStatus()} disabled={aiLoading}>
            <RefreshCw className={`h-4 w-4 ${aiLoading ? "animate-spin" : ""}`} /> Refresh status
          </Button>
        </div>

        {aiLoading && !aiStatus ? (
          <div className="p-8"><LoadingSpinner /></div>
        ) : aiStatus ? (
          <div className="space-y-5 p-5">
            {aiStatus.disabled_reason && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Automatic generation is blocked</p>
                  <p className="text-xs">{aiStatus.disabled_reason}</p>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
              <div className="space-y-4">
                <div className="flex flex-col gap-4 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="daily-ai-enabled"
                      checked={aiStatus.predictions_ai_enabled}
                      disabled={aiSaving || !aiStatus.env_enabled}
                      onCheckedChange={(checked) => void updateAiSettings({ predictions_ai_enabled: checked })}
                    />
                    <div>
                      <Label htmlFor="daily-ai-enabled" className="font-semibold">Automatic daily publishing</Label>
                      <p className="text-xs text-muted-foreground">Environment: {aiStatus.env_enabled ? "ready" : "disabled"} · Redis: {aiStatus.redis_ready ? "ready" : "missing"} · OpenAI: {aiStatus.openai_ready ? "ready" : "missing"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Questions</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={aiSaving || aiStatus.predictions_daily_count <= 10}
                      onClick={() => void updateAiSettings({ predictions_daily_count: aiStatus.predictions_daily_count - 1 })}
                      aria-label="Decrease daily question count"
                    >-</Button>
                    <span className="w-7 text-center text-sm font-semibold tabular-nums">{aiStatus.predictions_daily_count}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={aiSaving || aiStatus.predictions_daily_count >= 20}
                      onClick={() => void updateAiSettings({ predictions_daily_count: aiStatus.predictions_daily_count + 1 })}
                      aria-label="Increase daily question count"
                    >+</Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void generateAiPredictions()} disabled={aiSaving || !aiStatus.can_generate}>
                    <Sparkles className="h-4 w-4" /> {aiSaving ? "Working..." : "Generate now"}
                  </Button>
                  {aiStatus.current_batch && (
                    <Button variant="outline" onClick={() => setClearAiOpen(true)} disabled={aiSaving}>
                      <Trash2 className="h-4 w-4" /> Clear today&apos;s set
                    </Button>
                  )}
                </div>

                {aiStatus.last_status && (
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-4">
                    <div><p className="text-[11px] uppercase text-muted-foreground">Status</p><p className="text-sm font-semibold capitalize">{aiStatus.last_status.status}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Articles</p><p className="text-sm font-semibold">{aiStatus.last_status.article_count ?? 0}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Topics</p><p className="text-sm font-semibold">{aiStatus.last_status.topic_count ?? 0}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Accepted</p><p className="text-sm font-semibold">{aiStatus.last_status.accepted_count ?? 0}</p></div>
                    {aiStatus.last_status.error && <p className="col-span-2 text-xs text-destructive sm:col-span-4">{aiStatus.last_status.error}</p>}
                  </div>
                )}

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Genuine vote activity</h4>
                      <p className="text-xs text-muted-foreground">Beta and organic responses use the same duplicate and rate-limit safeguards.</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(betaInviteUrl);
                          toast.success("Beta invitation link copied");
                        } catch {
                          toast.error("Could not copy the beta invitation link");
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy beta link
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <div><p className="text-[11px] uppercase text-muted-foreground">All genuine</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.total_genuine_votes.toLocaleString()}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Beta launch</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.beta_launch_votes.toLocaleString()}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Organic</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.organic_votes.toLocaleString()}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Voter signals</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.unique_voting_fingerprints.toLocaleString()}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Daily duplicates blocked</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.duplicate_attempts.toLocaleString()}</p></div>
                    <div><p className="text-[11px] uppercase text-muted-foreground">Daily rate limits</p><p className="text-lg font-semibold tabular-nums">{voteAnalytics.rate_limited_attempts.toLocaleString()}</p></div>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                    Voter signals are privacy-safe deduplication identifiers, not identified people. Daily safeguard counts expire with the current AI batch.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Rss className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Approved RSS sources</h4>
                </div>
                <div className="space-y-2">
                  {aiStatus.feeds.map((feed) => {
                    const health = aiStatus.last_status?.feed_health?.find((item) => item.name === feed.name);
                    return (
                      <div key={feed.url} className="flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{feed.name}</p>
                          <p className="capitalize text-muted-foreground">{feed.category}{feed.primary_source ? " · primary source" : ""}</p>
                        </div>
                        <span className={`shrink-0 font-semibold ${health?.ok ? "text-emerald-600" : health ? "text-destructive" : "text-muted-foreground"}`}>
                          {health?.ok ? `${health.item_count} items` : health ? "Failed" : "Unchecked"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold">Current temporary set</h4>
                  <p className="text-xs text-muted-foreground">
                    {aiStatus.current_batch
                      ? `${aiStatus.current_batch.questions.length} live questions · expires ${new Date(aiStatus.current_batch.expires_at).toLocaleString("en-IN")}`
                      : "No AI-generated questions are live."}
                  </p>
                </div>
              </div>
              {aiStatus.current_batch && (
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {aiStatus.current_batch.questions.map((question) => (
                    <div key={question.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="text-xl" aria-hidden="true">{question.image_emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{question.question}</p>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                          {question.category} · {question.yes_count + question.no_count} genuine votes · {question.beta_launch_votes} beta · {question.organic_votes} organic
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => void removeAiQuestion(question.id)}
                        aria-label={`Remove ${question.question}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Daily prediction status could not be loaded.</div>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search polls..." value={pollSearch} onChange={(e) => setPollSearch(e.target.value)} className="pl-9" />
        </div>
        <Button
          onClick={() => {
            setEditingPollId(null);
            setPollForm(emptyPollForm);
            setShowPollForm(true);
          }}
          className="rounded-xl"
        >
          <Plus className="h-4 w-4" /> Add Poll
        </Button>
      </div>

      {showPollForm && (
        <FormCard title={editingPollId ? "Edit Poll" : "Create New Poll"} onClose={() => setShowPollForm(false)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Question *">
                <Textarea value={pollForm.question} onChange={(e) => setPollForm({ ...pollForm, question: e.target.value })} rows={2} placeholder="Will RBI cut interest rates in Q2 2026?" />
              </Field>
            </div>
            <Field label="Category">
              <Select value={pollForm.category} onValueChange={(value) => setPollForm({ ...pollForm, category: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{POLL_CATEGORIES.map((category) => <SelectItem key={category} value={category} className="capitalize">{category}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Emoji">
              <Input value={pollForm.image_emoji} onChange={(e) => setPollForm({ ...pollForm, image_emoji: e.target.value })} placeholder="📊" />
            </Field>
            <Field label="Ends At (optional)">
              <Input type="datetime-local" value={pollForm.ends_at} onChange={(e) => setPollForm({ ...pollForm, ends_at: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowPollForm(false)}>Cancel</Button>
            <Button onClick={savePoll} disabled={savingPoll}>{savingPoll ? "Saving..." : "Save"}</Button>
          </div>
        </FormCard>
      )}

      <div className="space-y-3">
        {pollsLoading ? (
          <LoadingSpinner />
        ) : filteredPolls.length === 0 ? (
          <EmptyState icon={TrendingUp} text="No polls" />
        ) : filteredPolls.map((poll) => {
          const totalVotes = Number(poll.yes_count || 0) + Number(poll.no_count || 0);
          const yesPercentage = totalVotes > 0 ? Math.round((Number(poll.yes_count || 0) / totalVotes) * 100) : 50;
          const createdAt = poll.created_at || poll.createdAt;

          return (
            <div key={poll.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
              <span className="text-2xl">{poll.image_emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="truncate text-sm font-medium">{poll.question}</h4>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold capitalize text-accent-foreground">{poll.category}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalVotes.toLocaleString()} votes · {yesPercentage}% Yes · {100 - yesPercentage}% No · {createdAt ? new Date(createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Recently"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn onClick={() => openEditPoll(poll)} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
                <IconBtn onClick={() => setPollToDelete(poll)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmActionDialog
        open={Boolean(pollToDelete)}
        onOpenChange={(open) => {
          if (!open) setPollToDelete(null);
        }}
        title="Delete this poll?"
        description={pollToDelete ? `This will permanently remove "${pollToDelete.question}".` : undefined}
        confirmLabel="Delete poll"
        destructive
        onConfirm={deletePoll}
      />

      <ConfirmActionDialog
        open={clearAiOpen}
        onOpenChange={setClearAiOpen}
        title="Clear today's AI predictions?"
        description="This removes the current temporary questions and vote counts immediately. The next scheduled run can create a new set."
        confirmLabel="Clear temporary set"
        destructive
        onConfirm={clearAiPredictions}
      />

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg">Comment Moderation</h3>
            <p className="text-sm text-muted-foreground">Anonymous and profane comments land here for review.</p>
          </div>
          <Button variant="outline" onClick={() => void fetchFlaggedComments()}>Refresh</Button>
        </div>

        {commentsLoading ? (
          <LoadingSpinner />
        ) : flaggedComments.length === 0 ? (
          <EmptyState icon={MessageCircle} text="No flagged comments" />
        ) : (
          <div className="space-y-3">
            {flaggedComments.map((comment) => {
              const poll = adminPolls.find((entry) => entry.id === comment.poll_id);
              return (
                <div key={comment.id} className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{comment.author_name}</p>
                      <p className="text-xs text-muted-foreground">{poll?.question || "Unknown poll"}</p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      {comment.status}
                    </span>
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">{comment.content}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void updateCommentStatus(comment.id, "visible")}>
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void updateCommentStatus(comment.id, "hidden")}>
                      <EyeOff className="h-4 w-4" /> Hide
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteComment(comment.id)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
