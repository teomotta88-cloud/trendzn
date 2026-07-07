import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { TrendingHashtagsTable } from "@/components/TrendingHashtagsTable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tiktok-hashtag")({
  head: () => ({
    meta: [{ title: "TikTok Trending IT — TRENDZN" }],
  }),
  component: Page,
});

const SECTION = "tiktok-hashtag";

type DbRow = {
  id: string;
  url: string;
  title: string | null;
  category: string | null;
  industry: string | null;
  tags: string[] | null;
  posted_at: string | null;
};

function rowToTrendItem(row: DbRow): TrendItem {
  return {
    category: row.category ?? "TikTok",
    links: [row.url],
    descrizione: null,
    nome_trend: row.title ?? null,
    industry: row.industry ?? null,
    applicazione: null,
    canali: null,
  };
}

function Page() {
  const [dbRows, setDbRows] = useState<DbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTag, setActiveTag] = useState<string>("tutti");

  const fetchRows = useCallback(() => {
    supabase
      .from("trend_submissions")
      .select("id, url, title, category, industry, tags, posted_at")
      .eq("section", SECTION)
      .eq("status", "approved")
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (data) setDbRows(data as DbRow[]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Ricava lista hashtag univoci presenti nel DB, ordinati per frequenza
  const allTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const row of dbRows) {
      for (const t of row.tags ?? []) {
        if (t) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [dbRows]);

  const filteredRows = useMemo(
    () =>
      activeTag === "tutti"
        ? dbRows
        : dbRows.filter((r) => r.tags?.includes(activeTag)),
    [dbRows, activeTag],
  );

  const handleDelete = useCallback((url: string) => {
    setDbRows((prev) => prev.filter((r) => r.url !== url));
  }, []);

  const dbIds: Record<string, string> = Object.fromEntries(
    filteredRows.map((r) => [r.url, r.id]),
  );
  const allItems: TrendItem[] = filteredRows.map(rowToTrendItem);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">TikTok Trending Italia</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Video TikTok raccolti automaticamente dagli hashtag in trend in Italia ogni 12 ore.
          Filtrate per hashtag con i chip qui sotto.
        </p>
      </header>

      <TrendingHashtagsTable onSelectHashtag={setActiveTag} />

      {/* Filtro hashtag */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag("tutti")}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              activeTag === "tutti"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            Tutti ({dbRows.length})
          </button>
          {allTags.map((tag) => {
            const count = dbRows.filter((r) => r.tags?.includes(tag)).length;
            return (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  activeTag === tag
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                #{tag} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : allItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {activeTag === "tutti"
            ? "Nessun video trovato ancora. Il workflow GitHub Actions raccoglie i contenuti ogni 12 ore."
            : `Nessun video per #${activeTag}.`}
        </div>
      ) : (
        <TrendGrid items={allItems} dbIds={dbIds} onDelete={handleDelete} />
      )}
    </div>
  );
}
