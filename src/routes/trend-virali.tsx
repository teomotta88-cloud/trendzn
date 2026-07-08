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
  listViralTrendContent,
  VIRAL_PLATFORMS,
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
          "Contenuti reali ordinati per view ed engagement, trovati cercando su Twitter/X, Reddit, Instagram, LinkedIn e YouTube le keyword ricavate dagli hashtag TikTok in trend.",
      },
    ],
  }),
  component: Page,
});

const DAYS_RANGE_OPTIONS = [7, 14, 30, 90] as const;

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
  const [daysRange, setDaysRange] = useState<number>(14);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    listViralTrendContent({
      platform: platformFilter === "all" ? undefined : platformFilter,
      sourceHashtag: hashtagFilter === "all" ? undefined : hashtagFilter,
      sinceDays: daysRange,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [platformFilter, hashtagFilter, daysRange]);

  const hashtags = useMemo(
    () => Array.from(new Set(items.map((i) => i.source_hashtag))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.content?.toLowerCase().includes(q) ||
        i.author?.toLowerCase().includes(q) ||
        i.keyword_matched.toLowerCase().includes(q) ||
        i.source_hashtag.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Virali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ogni hashtag TikTok in trend (pagina TikTok Trending) viene trasformato in una keyword di
          ricerca leggibile tramite Claude, poi cercato su Twitter/X, Reddit, Instagram, LinkedIn e
          YouTube. I contenuti trovati sono ordinati per view ed engagement reali — non per hashtag.
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

        <Select value={String(daysRange)} onValueChange={(v) => setDaysRange(Number(v))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Intervallo" />
          </SelectTrigger>
          <SelectContent>
            {DAYS_RANGE_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                Ultimi {d} giorni
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

        {hashtags.length > 0 && (
          <Select value={hashtagFilter} onValueChange={setHashtagFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Hashtag di origine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli hashtag</SelectItem>
              {hashtags.map((h) => (
                <SelectItem key={h} value={h}>
                  #{h}
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
          giorno a partire dagli hashtag TikTok in trend.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Piattaforma</TableHead>
                  <TableHead>Hashtag → Keyword</TableHead>
                  <TableHead>Autore</TableHead>
                  <TableHead>Contenuto</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Engagement</TableHead>
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
                      #{item.source_hashtag} → {item.keyword_matched}
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
                      {formatCompactNumber(item.engagement)}
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
