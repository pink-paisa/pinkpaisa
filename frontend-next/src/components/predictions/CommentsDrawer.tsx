import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Comment = {
  id: string;
  poll_id: string;
  author_name: string;
  content: string;
  created_at: string;
};

const CommentsDrawer = ({
  pollId,
  pollQuestion,
  isOpen,
  onClose,
}: {
  pollId: string | null;
  pollQuestion: string;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAuthorName(localStorage.getItem("pp_author_name") || "");
  }, []);

  useEffect(() => {
    if (!pollId || !isOpen) return;

    const fetchComments = async () => {
      const { data } = await supabase
        .from("poll_comments")
        .select("*")
        .eq("poll_id", pollId)
        .order("created_at", { ascending: true });
      setComments(data || []);
    };
    fetchComments();

    // Real-time comments
    const channel = supabase
      .channel(`comments-${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "poll_comments",
          filter: `poll_id=eq.${pollId}`,
        },
        (payload) => {
          setComments((prev) => [...prev, payload.new as Comment]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId, isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSend = async () => {
    if (!newComment.trim() || !pollId) return;
    setSending(true);

    const name = authorName.trim() || "Anonymous";
    if (typeof window !== "undefined") {
      localStorage.setItem("pp_author_name", name);
    }

    const { data, error } = await supabase.from("poll_comments").insert({
      poll_id: pollId,
      author_name: name,
      content: newComment.trim(),
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setNewComment("");
      const status = Array.isArray(data) ? data[0]?.status : data?.status;
      toast({
        title: status === "flagged" ? "Comment submitted for review" : "Comment posted",
        description: status === "flagged"
          ? "We'll publish it once it clears moderation."
          : "Your comment is now live.",
      });
    }
    setSending(false);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>{comments.length} comments</span>
                  <span className="flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                    </span>
                    Live
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{pollQuestion}</p>
              </div>
              <button
                onClick={onClose}
                className="ml-3 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Comments list */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {comments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No comments yet</p>
                  <p className="text-xs text-muted-foreground/60">Be the first to share your thoughts</p>
                </div>
              ) : (
                comments.map((c) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {c.author_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-foreground">{c.author_name}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="mt-1 pl-9 text-sm leading-relaxed text-muted-foreground">{c.content}</p>
                  </motion.div>
                ))
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border px-5 py-4 space-y-2">
              <input
                type="text"
                placeholder="Your name (optional)"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none transition-all focus:border-primary focus:ring-1 focus:ring-ring/30"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-all focus:border-primary focus:ring-1 focus:ring-ring/30"
                />
                <button
                  onClick={handleSend}
                  disabled={!newComment.trim() || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CommentsDrawer;
