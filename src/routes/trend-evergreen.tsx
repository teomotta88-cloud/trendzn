import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { trendEvergreen } from "@/lib/trends";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { ManualSubmitDialog } from "@/components/ManualSubmitDialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/trend-evergreen")({
  head: () => ({
    meta: [{ title: "Trend Evergreen — TrendDeck" }],
  }),
  component: Page,
});

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
    category: row.category ?? "Trend Evergreen",
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
      .eq("section", "trend-evergreen")
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
  const allItems: TrendItem[] = [...dbRows.map(rowToTrendItem), ...trendEvergreen];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Evergreen</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vanno bene un po' sempre. Linguaggi e costrutti social sempre validi (POV, dimmi senza dirmi…).{"\n"}
            Utili come tappabuchi quando si è a corto di idee.
          </p>
        </div>
        <ManualSubmitDialog section="trend-evergreen" onSuccess={fetchRows} />
      </header>
      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : (
        <TrendGrid items={allItems} dbIds={dbIds} onDelete={handleDelete} />
      )}
    </div>
  );
}
