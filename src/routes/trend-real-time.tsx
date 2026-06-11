import { createFileRoute } from "@tanstack/react-router";
import { trendRealTime } from "@/lib/trends";
import { TrendGrid } from "@/components/TrendGrid";

export const Route = createFileRoute("/trend-real-time")({
  head: () => ({
    meta: [
      { title: "Trend Real Time — TrendDeck" },
      { name: "description", content: "Trend social da realizzare entro 1-2 giorni: avvenimenti, notizie d'attualità, real time marketing." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Real Time</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Da realizzare entro 1-2 giorni. Legati ad avvenimenti, notizie d'attualità o citazioni di altri brand.
          Conta più la velocità di realizzazione che il crafting minuzioso.
        </p>
      </header>
      <TrendGrid items={trendRealTime} />
    </div>
  );
}
