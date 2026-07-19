import { useEffect, useRef, useState } from "react";
import { Trash2, Pencil, Clock, Link2, Wand2 } from "lucide-react";
import {
  type EditorialPost,
  type ReviewComponent,
  type PublishedPostMatch,
  getApprovalStatus,
  toggleApproval,
  deletePost,
  updatePost,
  updatePostText,
  updateChannelCopy,
  getPublishedMatches,
  SAME_AS_IG_FLAG,
} from "@/lib/editorialPlan";
import { PostReviewBlock } from "./PostReviewBlock";
import { EditableText } from "./EditableText";
import { PostMediaGallery } from "./PostMediaGallery";
import { NewPostCard } from "./NewPostCard";
import { AutoGraphicsPanel } from "./AutoGraphicsPanel";
import { VisualWizardModal } from "./VisualWizardModal";

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function PostCard({
  post,
  onDeleted,
  onUpdated,
  onApprovalChange,
  onPublishedChange,
  onProgrammatoChange,
}: {
  post: EditorialPost;
  onDeleted: () => void;
  onUpdated?: () => void;
  onApprovalChange?: () => void;
  onPublishedChange?: () => void;
  onProgrammatoChange?: (programmato: boolean) => void;
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
  const [publishedMatches, setPublishedMatches] = useState<PublishedPostMatch[]>([]);
  const [showPublishedUrl, setShowPublishedUrl] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);

  async function refreshPublishedMatches() {
    setPublishedMatches(await getPublishedMatches(post.id));
    onPublishedChange?.();
  }

  useEffect(() => {
    refreshPublishedMatches();
  }, [post.id]);

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
    refreshPublishedMatches();
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
    onProgrammatoChange?.(!programmato);
  }

  const allApproved = approvals.copy && approvals.copy_visual && approvals.visual;
  const someApproved = approvals.copy || approvals.copy_visual || approvals.visual;
  const fullyDone = allApproved && programmato;
  const isPublished = publishedMatches.length > 0;

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
        isPublished
          ? "border-cyan-500 bg-cyan-500/5"
          : fullyDone
            ? "border-violet-500 bg-violet-500/5"
            : allApproved
              ? "border-green-500 bg-green-500/5"
              : someApproved
                ? "border-yellow-500 bg-yellow-500/5"
                : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold capitalize text-foreground">
              {formatDate(post.post_date)}
            </span>
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
            {post.formato && (
              <span className="rounded-md border border-border px-2 py-0.5 text-[10px]">
                {post.formato}
              </span>
            )}
          </div>
          {post.topic && (
            <h3 className="font-display text-sm font-semibold text-foreground">{post.topic}</h3>
          )}
        </div>
        <div className="relative flex items-center gap-1.5">
          {publishedMatches.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPublishedUrl((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                showPublishedUrl
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              <Link2 className="size-3.5" />
              Vai ai Post ({publishedMatches.length})
            </button>
          )}
          {showPublishedUrl && publishedMatches.length > 0 && (
            <div className="absolute right-0 top-full z-10 mt-1 flex w-64 flex-col gap-1 rounded-lg border border-border bg-popover p-2 shadow-md">
              {publishedMatches.map((m) => (
                <a
                  key={m.url}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
                >
                  <span className="rounded border border-border px-1 text-[9px] font-semibold text-foreground">
                    {m.canale}
                  </span>
                  <span className="truncate">{m.url}</span>
                </a>
              ))}
            </div>
          )}
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
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          Copy {code}
                        </span>
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
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-2.5 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/10"
            >
              <Wand2 className="size-3.5" />
              Crea visual con editor grafico
            </button>
            <PostMediaGallery key={mediaRefreshKey} postId={post.id} />
          </div>
        </PostReviewBlock>
      </div>

      <VisualWizardModal
        post={post}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onUploaded={() => setMediaRefreshKey((k) => k + 1)}
      />

      {(post.disclaimer || post.obiettivo_media || typeof post.budget_media === "number") && (
        <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {post.disclaimer && <span>Disclaimer: {post.disclaimer}</span>}
          {post.obiettivo_media && <span>Obiettivo media: {post.obiettivo_media}</span>}
          {typeof post.budget_media === "number" && <span>Budget: €{post.budget_media}</span>}
        </div>
      )}

      <AutoGraphicsPanel post={post} />
    </article>
  );
}
