import { useEffect, useState } from "react";
import { ThumbsUp, MessageSquare } from "lucide-react";
import {
  type ReviewComponent,
  type EditorialPostComment,
  addComment,
  listComments,
} from "@/lib/editorialPlan";

export function PostReviewBlock({
  postId,
  component,
  label,
  approved,
  onToggle,
  children,
}: {
  postId: string;
  component: ReviewComponent;
  label: string;
  approved: boolean;
  onToggle: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [comments, setComments] = useState<EditorialPostComment[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");
  const [approving, setApproving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (showComments) {
      listComments(postId).then((all) => setComments(all.filter((c) => c.component === component)));
    }
  }, [showComments, postId, component]);

  async function handleToggleApprove() {
    setApproving(true);
    await onToggle();
    setApproving(false);
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    const c = await addComment(postId, component, draft.trim());
    setComments((prev) => [...prev, c]);
    setDraft("");
    setSending(false);
  }

  return (
    <div
      className={`flex h-full flex-col space-y-2 rounded-xl border p-3 transition-colors ${
        approved ? "border-green-500 bg-green-500/5" : "border-border bg-background/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleApprove}
            disabled={approving}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-60 ${
              approved
                ? "border-green-500 text-green-600 hover:bg-green-500/10"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <ThumbsUp className="size-3" />
            {approved ? "Approvato" : "Approva"}
          </button>
          <button
            onClick={() => setShowComments((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            <MessageSquare className="size-3" />
            {comments.length > 0 ? comments.length : ""}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 text-xs text-foreground/90">{children}</div>

      {showComments && (
        <div className="space-y-2 border-t border-border pt-2">
          {comments.length === 0 && <p className="text-[11px] text-muted-foreground">Nessun commento</p>}
          {comments.map((c) => (
            <p key={c.id} className="rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-foreground/90">
              {c.body}
            </p>
          ))}
          <form onSubmit={handleAddComment} className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Scrivi un commento…"
              className="flex-1 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
            >
              Invia
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
