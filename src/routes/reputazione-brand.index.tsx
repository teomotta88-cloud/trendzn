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

const DAYS_RANGE_OPTIONS = [7, 14, 30, 90] as const;
const KEYWORDS_STORAGE_KEY = "reputazione-brand:keywords";
const DEFAULT_KEYWORDS = ["hyundai"];

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function splitKeywordInput(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map(normalizeKeyword)
    .filter(Boolean);
}

function mentionMatchesKeyword(mention: BrandMention, keyword: string): boolean {
  const q = normalizeKeyword(keyword);
  if (!q) return true;

  const haystack = [
    mention.keyword_matched,
    mention.content,
    mention.author,
    mention.url,
    mention.category,
    mention.platform,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function mentionMatchesAnyKeyword(mention: BrandMention, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  return keywords.some((keyword) => mentionMatchesKeyword(mention, keyword));
}

function ReputazioneBrandPage() {
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [alerts, setAlerts] = useState<BrandSentimentAlert[]>([]);
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | "all">("all");
  const [daysRange, setDaysRange] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEYWORDS_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;

      const normalized = Array.from(
        new Set(parsed.map((item) => normalizeKeyword(String(item))).filter(Boolean)),
      );

      setKeywords(normalized.length > 0 ? normalized : DEFAULT_KEYWORDS);
    } catch {
      setKeywords(DEFAULT_KEYWORDS);
    }
  }, []);

  function persistKeywords(next: string[]) {
    const normalized = Array.from(new Set(next.map(normalizeKeyword).filter(Boolean)));
    setKeywords(normalized);
    window.localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(normalized));
  }

  function handleAddKeywords() {
    const nextKeywords = splitKeywordInput(keywordInput);
    if (nextKeywords.length === 0) return;

    persistKeywords([...keywords, ...nextKeywords]);
    setKeywordInput("");
  }

  function handleRemoveKeyword(keyword: string) {
    persistKeywords(keywords.filter((item) => item !== keyword));
  }

  function handleResetKeywords() {
    persistKeywords(DEFAULT_KEYWORDS);
    setKeywordInput("");
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [mentionsData, alertsData] = await Promise.all([
        listMentions({
          platform: platformFilter === "all" ? undefined : platformFilter,
          sentiment: sentimentFilter === "all" ? undefined : sentimentFilter,
          sinceDays: daysRange,
        }),
        listUnresolvedAlerts(),
      ]);

      setMentions(mentionsData);
      setAlerts(alertsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [platformFilter, sentimentFilter, daysRange]);

  const filteredMentions = useMemo(
    () => mentions.filter((mention) => mentionMatchesAnyKeyword(mention, keywords)),
    [mentions, keywords],
  );

  const trendSeries = useMemo(
    () => buildDailySentimentSeries(filteredMentions, daysRange),
    [filteredMentions, daysRange],
  );

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">
              Andamento sentiment ({daysRange} giorni)
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Filtro keyword in logica OR: almeno una keyword deve comparire nella mention.
            </p>
          </div>

          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {filteredMentions.length} / {mentions.length} menzioni
          </span>
        </div>

        <SentimentTrendChart data={trendSeries} />
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-3 flex flex-col gap-1">
          <h2 className="text-sm font-medium">Keyword monitorate</h2>
          <p className="text-xs text-muted-foreground">
            Aggiungi una o più keyword separate da virgola, punto e virgola o invio. Le keyword sono
            applicate con logica OR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddKeywords();
              }
            }}
            placeholder="Es. hyundai, kia, ioniq"
            className="min-w-[240px] flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />

          <button
            type="button"
            onClick={handleAddKeywords}
            disabled={!keywordInput.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aggiungi keyword
          </button>

          <button
            type="button"
            onClick={handleResetKeywords}
            className="rounded-md border px-4 py-2 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
          >
            Ripristina Hyundai
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {keywords.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nessuna keyword attiva: vengono mostrate tutte le menzioni.
            </span>
          ) : (
            keywords.map((keyword) => {
              const count = mentions.filter((mention) => mentionMatchesKeyword(mention, keyword)).length;

              return (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm"
                >
                  <span>{keyword}</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {count}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(keyword)}
                    title={`Rimuovi ${keyword}`}
                    className="text-muted-foreground transition hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
          onValueChange={(v) => setPlatformFilter(v as Platform | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Piattaforma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le piattaforme</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem className="capitalize" key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sentimentFilter}
          onValueChange={(v) => setSentimentFilter(v as Sentiment | "all")}
        >
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

      {error ? (
        <p className="text-sm text-destructive">
          Errore nel caricamento: {error}. Probabile causa: la migration non è ancora stata
          applicata al database (tabelle brand_mentions / brand_sentiment_alerts mancanti).
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : (
        <MentionsTable mentions={filteredMentions} />
      )}
    </div>
  );
}
