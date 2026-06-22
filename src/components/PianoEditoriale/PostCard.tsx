import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { type EditorialPost, type ReviewComponent, getApprovalCounts, deletePost, updatePostText } from "@/lib/editorialPlan";
import { PostReviewBlock } from "./PostReviewBlock";
import { EditableText } from "./EditableText";
import { PostMediaGallery } from "./PostMediaGallery";

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

export function PostCard({ post, onDeleted }: { post: EditorialPost; onDeleted: () => void }) {
  const [counts, setCounts] = useState<Record<ReviewComponent, number>>({ copy: 0, copy_visual: 0, visual: 0 });
  const [deleting, setDeleting] = useState(false);
  const [copy, setCopy] = useState(post.copy);
  const [copyVisual, setCopyVisual] = useState(post.copy_visual);

  async function refreshCounts() {
    setCounts(await getApprovalCounts(post.id));
  }

  useEffect(() => {
    refreshCounts();
  }, [post.id]);

  async function handleDelete() {
    if (!window.confirm("Eliminare questo post?")) return;
    setDeleting(true);
    await deletePost(post.id);
    onDeleted();
  }

  async function saveCopy(value: string) {
    await updatePostText(post.id, "copy", value || null);
    setCopy(value || null);
  }

  async function saveCopyVisual(value: string) {
    await updatePostText(post.id, "copy_visual", value || null);
    setCopyVisual(value || null);
  }

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold capitalize text-foreground">{formatDate(post.post_date)}</span>
            {post.rubrica && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {post.rubrica}
              </span>
            )}
            {post.canale && <span className="rounded-md border border-border px-2 py-0.5 text-[10px]">{post.canale}</span>}
            {post.formato && <span className="rounded-md border border-border px-2 py-0.5 text-[10px]">{post.formato}</span>}
          </div>
          {post.topic && <h3 className="font-display text-sm font-semibold text-foreground">{post.topic}</h3>}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
          title="Elimina"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <PostReviewBlock postId={post.id} component="copy" label="Copy" approvalCount={counts.copy} onApproved={refreshCounts}>
          <EditableText value={copy} placeholder="—" onSave={saveCopy} />
        </PostReviewBlock>

        <PostReviewBlock
          postId={post.id}
          component="copy_visual"
          label="Copy Visual"
          approvalCount={counts.copy_visual}
          onApproved={refreshCounts}
        >
          <EditableText value={copyVisual} placeholder="—" onSave={saveCopyVisual} />
        </PostReviewBlock>

        <PostReviewBlock
          postId={post.id}
          component="visual"
          label="Visual"
          approvalCount={counts.visual}
          onApproved={refreshCounts}
        >
          <PostMediaGallery postId={post.id} />
        </PostReviewBlock>
      </div>

      {(post.disclaimer || post.obiettivo_media || typeof post.budget_media === "number") && (
        <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {post.disclaimer && <span>Disclaimer: {post.disclaimer}</span>}
          {post.obiettivo_media && <span>Obiettivo media: {post.obiettivo_media}</span>}
          {typeof post.budget_media === "number" && <span>Budget: €{post.budget_media}</span>}
        </div>
      )}
    </article>
  );
}
