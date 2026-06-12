import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trendRealTime } from "@/lib/trends";
import type { TrendItem } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/trend-real-time")({
  head: () => ({
    meta: [
      { title: "Trend Real Time — TrendDeck" },
      {
        name: "description",
        content: "Trend social da realizzare entro 1-2 giorni: avvenimenti, notizie d'attualità, real time marketing.",
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
    category: row.category ?? "Trend Real Time",
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
      .eq("section", "trend-real-time")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        console.log("DB data:", data);
        console.log("DB error:", error);
        if (data) setDbItems(data.map(submissionToTrendItem));
        setLoading(false);
      });
  }, []);

  const allItems = [...dbItems, ...trendRealTime];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Real Time</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Da realizzare entro 1-2 giorni. Legati ad avvenimenti, notizie d'attualità o citazioni di altri brand. Conta
          più la velocità di realizzazione che il crafting minuzioso.
        </p>
      </header>
      {loading ? <div className="text-sm text-muted-foreground">Caricamento…</div> : <TrendGrid items={allItems} />}
    </div>
  );
}
