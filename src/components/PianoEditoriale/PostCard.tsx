import { useEffect, useRef, useState } from "react";
import { Trash2, Pencil, Clock } from "lucide-react";
import {
  type EditorialPost,
  type ReviewComponent,
  getApprovalStatus,
  toggleApproval,
  deletePost,
  updatePost,
  updatePostText,
  updateChannelCopy,
  SAME_AS_IG_FLAG,
} from "@/lib/editorialPlan";
import { PostReviewBlock } from "./PostReviewBlock";
import { EditableText } from "./EditableText";
import { PostMediaGallery } from "./PostMediaGallery";
import { NewPostCard } from "./NewPostCard";

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

export function PostCard({
  post,
  onDeleted,
  onUpdated,
  onApprovalChange,
}: {
  post: EditorialPost;
  onDeleted: () => void;
  onUpdated?: () => void;
  onApprovalChange?: () => void;
}) {
  const [approvals, setApprovals] = useState<Record<ReviewComponent, boolean>>({
    copy: false,
    copy_visual: false,
    visual: false,
  });
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [programmato, setProgrammato] = useState(post.programmato);
  const [togglingProgrammato, setTogglingProgrammato] = useState(false);
  const [channelCopies, setChannelCopies] = useState(post.channel_copies);
  const [activeChannel, setActiveChannel] = useState(post.canali[0]);
  const [copyVisual, setCopyVisual] = useState(post.copy_visual);
  const [editingCopy, setEditingCopy] = useState(false);
  const [editingCopyVisual, setEditingCopyVisual] = useState(false);
  const visualContentRef = useRef<HTMLDivElement>(null);
  const [visualContentHeight, setVisualContentHeight] = useState<number>();

  useEffect(() => {
    const el = visualContentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setVisualContentHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function refreshApprovals() {
    setApprovals(await getApprovalStatus(post.id));
  }

  useEffect(() => {
    refreshApprovals();
  }, [post.id]);

  async function handleDelete() {
    if (!window.confirm("Eliminare questo post?")) return;
    setDeleting(true);
    await deletePost(post.id);
    onDeleted();
  }

  async function saveChannelCopy(channel: string, value: string) {
    const next = await updateChannelCopy(post.id, channel, value || null, channelCopies);
    setChannelCopies(next);
  }

  async function toggleSameAsIG(channel: string, checked: boolean) {
    await saveChannelCopy(channel, checked ? SAME_AS_IG_FLAG : "");
  }

  async function saveCopyVisual(value: string) {
    await updatePostText(post.id, "copy_visual", value || null);
    setCopyVisual(value || null);
  }

  async function handleToggle(component: ReviewComponent) {
    await toggleApproval(post.id, component, approvals[component]);
    await refreshApprovals();
    onApprovalChange?.();
  }

  async function handleToggleProgrammato() {
    setTogglingProgrammato(true);
    await updatePost(post.id, { programmato: !programmato });
    setProgrammato((v) => !v);
    setTogglingProgrammato(false);
    onUpdated?.();
  }

  const allApproved = approvals.copy && approvals.copy_visual && approvals.visual;
  const fullyDone = allApproved && programmato;

  if (editing) {
    return (
      <NewPostCard
        editPost={post}
        onCreated={() => {
          setEditing(false);
          onUpdated?.();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article
      className={`space-y-3 rounded-2xl border p-4 transition-colors ${
        fullyDone
          ? "border-violet-500 bg-violet-500/5"
          : allApproved
            ? "border-green-500 bg-green-500/5"
            : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold capitalize text-foreground">{formatDate(post.post_date)}</span>
            {post.rubrica && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {post.rubrica}
              </span>
            )}
            {post.canali.map((code) => (
              <span key={code} className="rounded-md border border-border px-2 py-0.5 text-[10px]">
                {code}
              </span>
            ))}
            {post.formato && <span className="rounded-md border border-border px-2 py-0.5 text-[10px]">{post.formato}</span>}
          </div>
          {post.topic && <h3 className="font-display text-sm font-semibold text-foreground">{post.topic}</h3>}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleProgrammato}
            disabled={togglingProgrammato}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-60 ${
              fullyDone
                ? "border-violet-500 text-violet-600 hover:bg-violet-500/10"
                : programmato
                  ? "border-green-500 text-green-600 hover:bg-green-500/10"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            title={programmato ? "Programmato" : "Non programmato"}
          >
            <Clock className="size-3.5" />
            {programmato ? "Programmato" : "Non programmato"}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary"
            title="Modifica post"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
            title="Elimina"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <PostReviewBlock
          postId={post.id}
          component="copy"
          label="Copy"
          approved={approvals.copy}
          onToggle={() => handleToggle("copy")}
          maxContentHeight={editingCopy ? undefined : visualContentHeight}
        >
          {post.canali.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1">
                {post.canali.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setActiveChannel(code)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                      activeChannel === code
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
              {activeChannel &&
                (() => {
                  const code = activeChannel;
                  const sameAsIG = code !== "IG" && channelCopies[code] === SAME_AS_IG_FLAG;
                  return (
                    <div key={code} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground">Copy {code}</span>
                        {code !== "IG" && post.canali.includes("IG") && (
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={sameAsIG}
                              onChange={(e) => toggleSameAsIG(code, e.target.checked)}
                            />
                            Uguale al copy IG
                          </label>
                        )}
                      </div>
                      {sameAsIG ? (
                        <p className="whitespace-pre-line text-[11px] leading-snug text-foreground/90">
                          {channelCopies.IG || "—"}
                        </p>
                      ) : (
                        <EditableText
                          value={channelCopies[code] ?? null}
                          placeholder="—"
                          onSave={(value) => saveChannelCopy(code, value)}
                          onEditingChange={setEditingCopy}
                        />
                      )}
                    </div>
                  );
                })()}
            </div>
          )}
        </PostReviewBlock>

        <PostReviewBlock
          postId={post.id}
          component="copy_visual"
          label="Copy Visual"
          approved={approvals.copy_visual}
          onToggle={() => handleToggle("copy_visual")}
          maxContentHeight={editingCopyVisual ? undefined : visualContentHeight}
        >
          <EditableText
            value={copyVisual}
            placeholder="—"
            onSave={saveCopyVisual}
            onEditingChange={setEditingCopyVisual}
          />
        </PostReviewBlock>

        <PostReviewBlock
          postId={post.id}
          component="visual"
          label="Visual"
          approved={approvals.visual}
          onToggle={() => handleToggle("visual")}
          contentRef={visualContentRef}
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
