import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MONTH_NAMES,
  getOrCreatePlan,
  listPosts,
  getApprovalStatus,
  syncPublishedPostsFromTrendsJson,
  type EditorialPlan,
  type EditorialPost,
  type ReviewComponent,
} from "@/lib/editorialPlan";
import { PostCard } from "@/components/PianoEditoriale/PostCard";
import { NewPostCard } from "@/components/PianoEditoriale/NewPostCard";
import { InstagramFeedPreview } from "@/components/PianoEditoriale/InstagramFeedPreview";
import { PostNumberRail } from "@/components/PianoEditoriale/PostNumberRail";
import { ClientChannelsPanel } from "@/components/PianoEditoriale/ClientChannelsPanel";

export const Route = createFileRoute("/piano-editoriale/")({
  head: () => ({
    meta: [
      { title: "Piano Editoriale" },
      { name: "description", content: "Calendario editoriale mensile con copy, visual e approvazioni." },
    ],
  }),
  component: PianoEditorialePage,
});

const now = new Date();

function PianoEditorialePage() {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [plan, setPlan] = useState<EditorialPlan | null>(null);
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"calendario" | "feed" | "canali">("calendario");
  const [creating, setCreating] = useState(false);
  const postElsRef = useRef(new Map<string, HTMLDivElement>());
  const getPostEl = useCallback((id: string) => postElsRef.current.get(id) ?? null, []);
  const postsColumnRef = useRef<HTMLDivElement>(null);
  const [approvalsByPost, setApprovalsByPost] = useState<Record<string, Record<ReviewComponent, boolean>>>({});

  async function load(y: number, m: number) {
    setLoading(true);
    const p = await getOrCreatePlan(y, m);
    setPlan(p);
    const loadedPosts = await listPosts(p.id);
    setPosts(loadedPosts);
    setLoading(false);
    loadApprovals(loadedPosts);
  }

  async function loadApprovals(postList: EditorialPost[]) {
    const entries = await Promise.all(postList.map((p) => getApprovalStatus(p.id).then((a) => [p.id, a] as const)));
    setApprovalsByPost(Object.fromEntries(entries));
  }

  useEffect(() => {
    load(year, month);
  }, [year, month]);

  useEffect(() => {
    syncPublishedPostsFromTrendsJson().catch(() => {});
  }, []);

  const defaultDate = useMemo(() => {
    const day = Math.min(now.getDate(), 28);
    const d = new Date(year, month - 1, day);
    return d.toISOString().slice(0, 10);
  }, [year, month]);

  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i), []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Piano Editoriale</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Componi i post mese per mese: copy, copy visual e visual, con approvazioni e commenti per ogni componente.
          </p>
        </div>
        {plan && tab === "calendario" && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            Nuovo post
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <div className="ml-auto flex gap-1 rounded-lg border border-border p-1">
          <button
            onClick={() => setTab("calendario")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "calendario" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Calendario
          </button>
          <button
            onClick={() => setTab("feed")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "feed" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Feed Instagram
          </button>
          <button
            onClick={() => setTab("canali")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "canali" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Canali cliente
          </button>
        </div>
      </div>

      {tab === "canali" ? (
        <ClientChannelsPanel />
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Caricamento piano…</div>
      ) : tab === "calendario" ? (
        <div ref={postsColumnRef} className="space-y-4">
          {plan && creating && (
            <NewPostCard
              planId={plan.id}
              defaultDate={defaultDate}
              onCreated={() => {
                setCreating(false);
                load(year, month);
              }}
              onCancel={() => setCreating(false)}
            />
          )}
          {posts.length === 0 && !creating ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              Nessun post per {MONTH_NAMES[month - 1]} {year}. Aggiungine uno con "Nuovo post".
            </div>
          ) : (
            posts.map((p) => (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) postElsRef.current.set(p.id, el);
                  else postElsRef.current.delete(p.id);
                }}
              >
                <PostCard
                  post={p}
                  onDeleted={() => load(year, month)}
                  onUpdated={() => load(year, month)}
                  onApprovalChange={() => loadApprovals(posts)}
                />
              </div>
            ))
          )}
          <PostNumberRail
            posts={posts}
            getPostEl={getPostEl}
            anchorRef={postsColumnRef}
            approvalsByPost={approvalsByPost}
          />
        </div>
      ) : (
        <InstagramFeedPreview posts={posts} />
      )}
    </div>
  );
}
