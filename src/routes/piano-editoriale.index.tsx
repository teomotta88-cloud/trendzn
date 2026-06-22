import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MONTH_NAMES, getOrCreatePlan, listPosts, type EditorialPlan, type EditorialPost } from "@/lib/editorialPlan";
import { PostCard } from "@/components/PianoEditoriale/PostCard";
import { NewPostDialog } from "@/components/PianoEditoriale/NewPostDialog";
import { InstagramFeedPreview } from "@/components/PianoEditoriale/InstagramFeedPreview";

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
  const [tab, setTab] = useState<"calendario" | "feed">("calendario");

  async function load(y: number, m: number) {
    setLoading(true);
    const p = await getOrCreatePlan(y, m);
    setPlan(p);
    setPosts(await listPosts(p.id));
    setLoading(false);
  }

  useEffect(() => {
    load(year, month);
  }, [year, month]);

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
        {plan && tab === "calendario" && (
          <NewPostDialog planId={plan.id} defaultDate={defaultDate} onCreated={() => load(year, month)} />
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
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento piano…</div>
      ) : tab === "calendario" ? (
        posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            Nessun post per {MONTH_NAMES[month - 1]} {year}. Aggiungine uno con "Nuovo post".
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} onDeleted={() => load(year, month)} />
            ))}
          </div>
        )
      ) : (
        <InstagramFeedPreview posts={posts} />
      )}
    </div>
  );
}
