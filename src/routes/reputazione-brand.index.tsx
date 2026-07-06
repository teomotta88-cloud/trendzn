import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PLATFORMS,
  buildDailySentimentSeries,
  listMentions,
  listUnresolvedAlerts,
  resolveAlert,
  type BrandMention,
  type BrandSentimentAlert,
  type Platform,
  type Sentiment,
} from "@/lib/brandReputation";
import { AlertBanner } from "@/components/ReputazioneBrand/AlertBanner";
import { SentimentTrendChart } from "@/components/ReputazioneBrand/SentimentTrendChart";
import { MentionsTable } from "@/components/ReputazioneBrand/MentionsTable";

export const Route = createFileRoute("/reputazione-brand/")({
  head: () => ({
    meta: [
      { title: "Reputazione Brand" },
      { name: "description", content: "Monitoraggio menzioni e sentiment del brand sui social." },
    ],
  }),
  component: ReputazioneBrandPage,
});

const TREND_DAYS = 14;

function ReputazioneBrandPage() {
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [alerts, setAlerts] = useState<BrandSentimentAlert[]>([]);
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | "all">("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [mentionsData, alertsData] = await Promise.all([
      listMentions({
        platform: platformFilter === "all" ? undefined : platformFilter,
        sentiment: sentimentFilter === "all" ? undefined : sentimentFilter,
      }),
      listUnresolvedAlerts(),
    ]);
    setMentions(mentionsData);
    setAlerts(alertsData);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [platformFilter, sentimentFilter]);

  const trendSeries = useMemo(() => buildDailySentimentSeries(mentions, TREND_DAYS), [mentions]);

  async function handleResolve(id: string) {
    await resolveAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reputazione Brand</h1>
        <p className="text-sm text-muted-foreground">
          Menzioni e sentiment su Twitter/X, Reddit, Instagram, YouTube, LinkedIn.
        </p>
      </div>

      <AlertBanner alerts={alerts} onResolve={handleResolve} />

      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Andamento sentiment (14 giorni)</h2>
        <SentimentTrendChart data={trendSeries} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v as Platform | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Piattaforma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le piattaforme</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sentimentFilter} onValueChange={(v) => setSentimentFilter(v as Sentiment | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i sentiment</SelectItem>
            <SelectItem value="positive">Positivo</SelectItem>
            <SelectItem value="neutral">Neutro</SelectItem>
            <SelectItem value="negative">Negativo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : (
        <MentionsTable mentions={mentions} />
      )}
    </div>
  );
}
