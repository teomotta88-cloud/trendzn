import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Eye } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformIcon } from "@/components/SocialEmbed";
import { formatCompactNumber } from "@/lib/format";
import {
  DISCOVERY_SOURCES,
  listViralTrendContent,
  VIRAL_PLATFORMS,
  VIRALITY_WINDOW_DAYS,
  type DiscoverySource,
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
          "Contenuti Instagram e TikTok reali degli ultimi 7 giorni, ordinati per viralità (crescita di view/engagement, non valore assoluto).",
      },
    ],
  }),
  component: Page,
});

const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  "tiktok-hashtag": "TikTok",
  "google-trends": "Google Trends",
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

function Page() {
  const [items, setItems] = useState<ViralTrendContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<ViralPlatform | "all">("all");
  const [hashtagFilter, setHashtagFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<DiscoverySource | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    listViralTrendContent({
      platform: platformFilter === "all" ? undefined : platformFilter,
      sourceHashtag: hashtagFilter === "all" ? undefined : hashtagFilter,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [platformFilter, hashtagFilter]);

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
          Google Trends per l'Italia — poi cercati su Instagram. I contenuti (sempre degli ultimi{" "}
          {VIRALITY_WINDOW_DAYS} giorni) sono ordinati per punteggio di viralità: quanto stanno
          crescendo view/engagement in questa finestra, non il loro valore assoluto. I video TikTok
          per lo stesso hashtag sono inclusi con le view quando disponibili; l'engagement
          (like/commenti) non è invece disponibile per questa fonte gratuita.
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
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Piattaforma</TableHead>
                  <TableHead>Fonte → Keyword</TableHead>
                  <TableHead>Autore</TableHead>
                  <TableHead>Contenuto</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Engagement</TableHead>
                  <TableHead className="text-right">Variazione (7gg)</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <PlatformIcon platform={item.platform} className="size-3.5" />
                        {item.platform}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {DISCOVERY_SOURCE_LABELS[item.discovery_source]}
                      </span>{" "}
                      {item.discovery_source === "tiktok-hashtag"
                        ? `#${item.source_hashtag}`
                        : item.source_hashtag}{" "}
                      → {item.keyword_matched}
                    </TableCell>
                    <TableCell>{item.author ?? "—"}</TableCell>
                    <TableCell className="max-w-md truncate">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {item.content || item.url}
                      </a>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {item.reach != null ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          <Eye className="size-3 text-muted-foreground" />
                          {formatCompactNumber(item.reach)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* TikTok non ha una fonte gratuita per l'engagement: 0 significherebbe
                          "zero interazioni", non "dato non disponibile". */}
                      {item.platform === "tiktok" ? "—" : formatCompactNumber(item.engagement)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-xs">
                      {/* Crescita nella finestra nota (7gg): assente finché il contenuto non
                          è stato ritrovato in almeno un sync successivo al primo. */}
                      {item.delta_reach > 0
                        ? `+${formatCompactNumber(item.delta_reach)} views`
                        : "—"}
                      {item.platform !== "tiktok" && item.delta_engagement > 0 && (
                        <>, +{formatCompactNumber(item.delta_engagement)} eng</>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(item.published_at ?? item.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
