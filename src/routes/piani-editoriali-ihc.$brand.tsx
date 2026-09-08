import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IHC_BRANDS,
  POST_FORMATS,
  MONTH_NAMES,
  getOrCreatePlan,
  listPosts,
  getApprovalStatus,
  getPublishedMatches,
  syncPublishedPostsFromTrendsJson,
  type EditorialPlan,
  type EditorialPost,
  type ReviewComponent,
} from "@/lib/editorialPlan";
import { PostCard } from "@/components/PianoEditoriale/PostCard";
import { NewPostCard } from "@/components/PianoEditoriale/NewPostCard";
import { InstagramFeedPreview } from "@/components/PianoEditoriale/InstagramFeedPreview";
import { PostNumberRail } from "@/components/PianoEditoriale/PostNumberRail";
import { StoryExportPanel } from "@/components/PianoEditoriale/StoryExportPanel";

export const Route = createFileRoute("/piani-editoriali-ihc/$brand")({
  head: () => ({
    meta: [
      { title: "Piani Editoriali IHC" },
      {
        name: "description",
        content: "Calendario editoriale mensile con copy, visual e approvazioni per sotto-brand IHC.",
      },
    ],
  }),
  component: PianiEditorialiIhcPage,
});

function PianiEditorialiIhcPage() {
  const { brand: brandSlug } = Route.useParams();
  const brand = IHC_BRANDS.find((b) => b.slug === brandSlug) ?? IHC_BRANDS[0];
  // Calcolato dentro il componente (non a livello di modulo) per evitare un
  // mismatch di hydration, come in piano-editoriale.index.tsx.
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [plan, setPlan] = useState<EditorialPlan | null>(null);
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"calendario" | "feed">("calendario");
  const [creating, setCreating] = useState(false);
  const postElsRef = useRef(new Map<string, HTMLDivElement>());
  const getPostEl = useCallback((id: string) => postElsRef.current.get(id) ?? null, []);
  const postsColumnRef = useRef<HTMLDivElement>(null);
  const [approvalsByPost, setApprovalsByPost] = useState<
    Record<string, Record<ReviewComponent, boolean>>
  >({});
  const [publishedCountByPost, setPublishedCountByPost] = useState<Record<string, number>>({});
  const postsRef = useRef<EditorialPost[]>([]);

  async function load(y: number, m: number) {
    setLoading(true);
    const p = await getOrCreatePlan(y, m, brand.slug);
    setPlan(p);
    const loadedPosts = await listPosts(p.id);
    setPosts(loadedPosts);
    setLoading(false);
    loadApprovals(loadedPosts);
    loadPublished(loadedPosts);
  }

  async function loadApprovals(postList: EditorialPost[]) {
    const entries = await Promise.all(
      postList.map((p) => getApprovalStatus(p.id).then((a) => [p.id, a] as const)),
    );
    setApprovalsByPost(Object.fromEntries(entries));
  }

  async function loadPublished(postList: EditorialPost[]) {
    const entries = await Promise.all(
      postList.map((p) => getPublishedMatches(p.id).then((m) => [p.id, m.length] as const)),
    );
    setPublishedCountByPost(Object.fromEntries(entries));
  }

  useEffect(() => {
    load(year, month);
  }, [brand.slug, year, month]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    syncPublishedPostsFromTrendsJson()
      .then(() => loadPublished(postsRef.current))
      .catch((err) => console.error("[syncPublishedPostsFromTrendsJson]", err));
  }, []);

  const defaultDate = useMemo(() => {
    const day = Math.min(now.getDate(), 28);
    const d = new Date(year, month - 1, day);
    return d.toISOString().slice(0, 10);
  }, [year, month]);

  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i), []);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Piani Editoriali IHC</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Calendario editoriale mensile per sotto-brand: copy, copy visual e visual, con
            approvazioni e commenti per ogni componente.
          </p>
        </div>

        <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-border bg-card/50 p-2">
          {IHC_BRANDS.map((b) => (
            <Link
              key={b.slug}
              to="/piani-editoriali-ihc/$brand"
              params={{ brand: b.slug }}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
            >
              {b.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold sm:text-2xl">{brand.label}</h2>
        {plan && tab === "calendario" && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            Nuovo post
          </button>
        )}
      </div>

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
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento piano…</div>
      ) : tab === "calendario" ? (
        <div ref={postsColumnRef} className="space-y-4">
          <StoryExportPanel posts={posts} sheetName={`${brand.label} Stories`} />
          {plan && creating && (
            <NewPostCard
              planId={plan.id}
              defaultDate={defaultDate}
              formatOptions={POST_FORMATS}
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
                  formatOptions={POST_FORMATS}
                  onDeleted={() => load(year, month)}
                  onUpdated={() => load(year, month)}
                  onApprovalChange={() => loadApprovals(posts)}
                  onPublishedChange={() => loadPublished(posts)}
                  onProgrammatoChange={(programmato) =>
                    setPosts((prev) =>
                      prev.map((post) => (post.id === p.id ? { ...post, programmato } : post)),
                    )
                  }
                />
              </div>
            ))
          )}
          <PostNumberRail
            posts={posts}
            getPostEl={getPostEl}
            anchorRef={postsColumnRef}
            approvalsByPost={approvalsByPost}
            publishedCountByPost={publishedCountByPost}
          />
        </div>
      ) : (
        <InstagramFeedPreview posts={posts} />
      )}
    </div>
  );
}
