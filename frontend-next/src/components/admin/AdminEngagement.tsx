/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Pencil, Trash2, TrendingUp, MessageCircle, CheckCircle2, EyeOff } from "lucide-react";
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

const emptyPollForm: PollForm = {
  question: "",
  category: "trending",
  image_emoji: "📊",
  ends_at: "",
};

export const AdminEngagement = () => {
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
