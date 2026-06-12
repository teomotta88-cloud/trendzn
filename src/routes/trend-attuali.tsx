import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trendAttuali } from "@/lib/trends";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/trend-attuali")({
  head: () => ({
    meta: [
      { title: "Trend Attuali — TrendDeck" },
      {
        name: "description",
        content: "Trend social IG/TikTok con durata 1-2 settimane: light shooting, card, carousel.",
      },
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
    category: row.category ?? "Trend Attuali",
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
      .eq("section", "trend-attuali")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbItems(data.map(submissionToTrendItem));
        setLoading(false);
      });
  }, []);

  const allItems = [...dbItems, ...trendAttuali];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Attuali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Da realizzare entro 1-2 settimane. Trend social (TT o IG) con durata un po' più lunga. Possono essere sia
          light shooting sia post "normali" (card, carousel).
        </p>
      </header>
      {loading ? <div className="text-sm text-muted-foreground">Caricamento…</div> : <TrendGrid items={allItems} />}
    </div>
  );
}
