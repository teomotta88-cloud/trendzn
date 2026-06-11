import { createFileRoute } from "@tanstack/react-router";
import { trendAttuali } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";

export const Route = createFileRoute("/trend-attuali")({
  head: () => ({
    meta: [
      { title: "Trend Attuali — TrendDeck" },
      { name: "description", content: "Trend social IG/TikTok con durata 1-2 settimane: light shooting, card, carousel." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Attuali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Da realizzare entro 1-2 settimane. Trend social (TT o IG) con durata un po' più lunga.
          Possono essere sia light shooting sia post "normali" (card, carousel).
        </p>
      </header>
      <TrendGrid items={trendAttuali} />
    </div>
  );
}
