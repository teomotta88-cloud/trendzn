import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tiktok-hashtag")({
  head: () => ({
    meta: [{ title: "TikTok Hashtag — TRENDZN" }],
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
};

function rowToTrendItem(row: DbRow): TrendItem {
  return {
    category: row.category ?? "TikTok Hashtag",
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

  const fetchRows = useCallback(() => {
    supabase
      .from("trend_submissions")
      .select("id, url, title, category, industry, tags")
      .eq("section", SECTION)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbRows(data as DbRow[]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleDelete = useCallback((url: string) => {
    setDbRows((prev) => prev.filter((r) => r.url !== url));
  }, []);

  const dbIds: Record<string, string> = Object.fromEntries(dbRows.map((r) => [r.url, r.id]));
  const allItems: TrendItem[] = dbRows.map(rowToTrendItem);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">TikTok Hashtag</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Post pubblici raccolti automaticamente dall'hashtag{" "}
          <a
            href="https://www.tiktok.com/tag/starhotels"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary"
          >
            #starhotels
          </a>{" "}
          su TikTok. Aggiornato periodicamente da uno scraper esterno (GitHub Actions), pubblicati
          qui automaticamente senza revisione manuale.
        </p>
      </header>
      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : allItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun post trovato ancora per questo hashtag.
        </div>
      ) : (
        <TrendGrid items={allItems} dbIds={dbIds} onDelete={handleDelete} />
      )}
    </div>
  );
}
