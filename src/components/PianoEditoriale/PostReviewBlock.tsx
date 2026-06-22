import { useEffect, useState } from "react";
import { ThumbsUp, MessageSquare } from "lucide-react";
import {
  type ReviewComponent,
  type EditorialPostComment,
  approveComponent,
  addComment,
  listComments,
} from "@/lib/editorialPlan";

export function PostReviewBlock({
  postId,
  component,
  label,
  approvalCount,
  onApproved,
  children,
}: {
  postId: string;
  component: ReviewComponent;
  label: string;
  approvalCount: number;
  onApproved: () => void;
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

  async function handleApprove() {
    setApproving(true);
    await approveComponent(postId, component);
    onApproved();
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
    <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleApprove}
            disabled={approving}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <ThumbsUp className="size-3" />
            Approva{approvalCount > 0 ? ` (${approvalCount})` : ""}
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

      <div className="text-xs text-foreground/90">{children}</div>

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
