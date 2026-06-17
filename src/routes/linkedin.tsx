import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { TrendGrid } from "@/components/TrendGrid";
import { ManualSubmitDialog } from "@/components/ManualSubmitDialog";
import type { TrendItem } from "@/lib/trends";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/linkedin")({
  head: () => ({
    meta: [
      { title: "LinkedIn — Trendzn" },
      {
        name: "description",
        content: "Post LinkedIn segnalati dal team, organizzati per industry.",
      },
    ],
  }),
  component: LinkedInPage,
});

type DbRow = {
  id: string;
  url: string;
  title: string | null;
  industry: string | null;
  category: string | null;
};

function rowToTrendItem(row: DbRow): TrendItem {
  return {
    category: row.category ?? "LinkedIn",
    links: [row.url],
    descrizione: null,
    nome_trend: row.title,
    industry: row.industry,
    applicazione: null,
    canali: null,
  };
}

function LinkedInPage() {
  const [rows, setRows] = useState<DbRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(() => {
    supabase
      .from("trend_submissions")
      .select("id, url, title, industry, category")
      .eq("section", "linkedin")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRows(data as DbRow[]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const items = rows.map(rowToTrendItem);
  const dbIds = Object.fromEntries(rows.map((r) => [r.url, r.id]));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">LinkedIn</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Post LinkedIn segnalati via mail dal team, organizzati per industry.
          </p>
        </div>
        <ManualSubmitDialog section="linkedin" onSuccess={fetchRows} />
      </header>

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : (
        <TrendGrid
          items={items}
          dbIds={dbIds}
          onDelete={(url) => setRows((prev) => prev.filter((r) => r.url !== url))}
        />
      )}
    </div>
  );
}
