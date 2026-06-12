import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trendEvergreen } from "@/lib/trends";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/trend-evergreen")({
  head: () => ({
    meta: [
      { title: "Trend Evergreen — TrendDeck" },
      { name: "description", content: "Linguaggi e costrutti social sempre validi. Utili come tappabuchi quando si è a corto di idee." },
    ],
  }),
  component: Page,
});

function submissionToTrendItem(row: {
  url: string;
  title: string | null;
  category: string | null;
  industry: string | null;
  tags: string[] | null;
}): TrendItem {
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
  const [dbItems, setDbItems] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("trend_submissions")
      .select("url, title, category, industry, tags")
      .eq("section", "trend-evergreen")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbItems(data.map(submissionToTrendItem));
        setLoading(false);
      });
  }, []);

  const allItems = [...dbItems, ...trendEvergreen];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Evergreen</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Vanno bene un po' sempre. Linguaggi e costrutti social sempre validi (POV, dimmi senza dirmi…).
          Utili come tappabuchi quando si è a corto di idee.
        </p>
      </header>
      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : (
        <TrendGrid items={allItems} />
      )}
    </div>
  );
}
