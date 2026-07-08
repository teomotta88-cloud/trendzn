import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Eye, Heart, TrendingUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlatformIcon, SocialEmbed } from "@/components/SocialEmbed";
import { formatCompactNumber } from "@/lib/format";
import {
  DISCOVERY_SOURCES,
  listViralTrendContent,
  SORT_OPTIONS,
  VIRAL_PLATFORMS,
  VIRALITY_WINDOW_DAYS,
  type DiscoverySource,
  type SortBy,
  type ViralPlatform,
  type ViralTrendContent,
} from "@/lib/viralTrends";

export const Route = createFileRoute("/trend-virali")({
  head: () => ({
    meta: [
      { title: "Trend Virali — TRENDZN" },
      {
        name: "description",
        content:
          "Contenuti Instagram e TikTok reali degli ultimi 7 giorni, con la variazione di view/engagement rilevata — ordinabili per viralità, data, engagement o views.",
      },
    ],
  }),
  component: Page,
});

const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  "tiktok-hashtag": "TikTok",
  "google-trends": "Google Trends",
};

const SORT_LABELS: Record<SortBy, string> = {
  virality: "Viralità",
  date: "Più recenti",
  engagement: "Engagement",
  views: "Views",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return "—";
  }
}

// La variazione (crescita nella finestra di 7gg) è assente finché il
// contenuto non è stato ritrovato in almeno un sync successivo al primo —
// non è "zero crescita", è "ancora nessun secondo dato". Va distinto nella UI.
function VariationBadge({ item }: { item: ViralTrendContent }) {
  const hasReachGrowth = item.delta_reach > 0;
  const hasEngagementGrowth = item.platform !== "tiktok" && item.delta_engagement > 0;

  if (!hasReachGrowth && !hasEngagementGrowth) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
        Nessuna crescita rilevata ancora
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <TrendingUp className="size-3.5 shrink-0" />
      {hasReachGrowth && <span>+{formatCompactNumber(item.delta_reach)} views</span>}
      {hasEngagementGrowth && <span>+{formatCompactNumber(item.delta_engagement)} engagement</span>}
      <span className="text-emerald-600/70 dark:text-emerald-400/70">
        (ultimi {VIRALITY_WINDOW_DAYS}gg)
      </span>
    </span>
  );
}

function Page() {
  const [items, setItems] = useState<ViralTrendContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<ViralPlatform | "all">("all");
  const [hashtagFilter, setHashtagFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<DiscoverySource | "all">("all");
  const [sortBy, setSortBy] = useState<SortBy>("virality");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    listViralTrendContent({
      platform: platformFilter === "all" ? undefined : platformFilter,
      sourceHashtag: hashtagFilter === "all" ? undefined : hashtagFilter,
      sortBy,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [platformFilter, hashtagFilter, sortBy]);

  // Per gli item da Google Trends, source_hashtag contiene il termine di
  // ricerca stesso (non un hashtag): l'etichetta "#" va mostrata solo per
  // quelli scoperti da un hashtag TikTok.
  const hashtagOptions = useMemo(() => {
    const bySourceHashtag = new Map<string, DiscoverySource>();
    for (const i of items) {
      if (!bySourceHashtag.has(i.source_hashtag))
        bySourceHashtag.set(i.source_hashtag, i.discovery_source);
    }
    return Array.from(bySourceHashtag.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (sourceFilter !== "all") result = result.filter((i) => i.discovery_source === sourceFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.content?.toLowerCase().includes(q) ||
          i.author?.toLowerCase().includes(q) ||
          i.keyword_matched.toLowerCase().includes(q) ||
          i.source_hashtag.toLowerCase().includes(q),
      );
    }
    return result;
  }, [items, sourceFilter, search]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Virali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Topic scoperti da due fonti indipendenti — hashtag TikTok in trend (convertiti in keyword
          leggibile, es. #empirestatebuilding → "Empire State Building") e ricerche in tendenza
          Google Trends per l'Italia — poi cercati su Instagram. Contenuti sempre degli ultimi{" "}
          {VIRALITY_WINDOW_DAYS} giorni, con la variazione di view/engagement rilevata rispetto al
          sync più vecchio in questa stessa finestra.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per contenuto, autore, keyword o hashtag…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Ordina per" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={platformFilter}
          onValueChange={(v) => setPlatformFilter(v as ViralPlatform | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Piattaforma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le piattaforme</SelectItem>
            {VIRAL_PLATFORMS.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as DiscoverySource | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Fonte del topic" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le fonti</SelectItem>
            {DISCOVERY_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {DISCOVERY_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hashtagOptions.length > 0 && (
          <Select value={hashtagFilter} onValueChange={setHashtagFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Hashtag di origine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli hashtag</SelectItem>
              {hashtagOptions.map(([h, source]) => (
                <SelectItem key={h} value={h}>
                  {source === "tiktok-hashtag" ? `#${h}` : h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} contenuti</span>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          Errore nel caricamento: {error}. Probabile causa: la migration non è ancora stata
          applicata al database (tabella viral_trend_content mancante).
        </p>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun contenuto ancora. Il workflow "Sync Trend Virali" popola questa pagina una volta al
          giorno a partire dagli hashtag TikTok in trend e dalle ricerche Google Trends IT.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 transition hover:border-primary/60"
            >
              <SocialEmbed url={item.url} />

              <div className="space-y-2 px-1 pb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-xs font-medium capitalize text-foreground">
                    <PlatformIcon platform={item.platform} className="size-3.5" />
                    {item.platform}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {DISCOVERY_SOURCE_LABELS[item.discovery_source]}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatDate(item.published_at ?? item.created_at)}
                  </span>
                </div>

                {item.author && (
                  <p className="text-xs font-semibold text-foreground">{item.author}</p>
                )}

                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:underline"
                >
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {item.content || item.url}
                  </p>
                </a>

                <p className="text-[10px] text-muted-foreground">
                  {item.discovery_source === "tiktok-hashtag"
                    ? `#${item.source_hashtag}`
                    : item.source_hashtag}{" "}
                  → {item.keyword_matched}
                </p>

                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3 text-muted-foreground" />
                    {formatCompactNumber(item.reach)}
                  </span>
                  {/* TikTok non ha una fonte gratuita per l'engagement: 0 significherebbe
                      "zero interazioni", non "dato non disponibile". */}
                  {item.platform !== "tiktok" && (
                    <span className="inline-flex items-center gap-1">
                      <Heart className="size-3 text-muted-foreground" />
                      {formatCompactNumber(item.engagement)}
                    </span>
                  )}
                </div>

                <VariationBadge item={item} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
