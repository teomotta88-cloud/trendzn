import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Eye,
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  CircleDashed,
  X,
  Zap,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LazyEmbed, PlatformIcon } from "@/components/SocialEmbed";
import { formatCompactNumber } from "@/lib/format";
import {
  computeTopicVerdict,
  DISCOVERY_SOURCES,
  listViralTrendContent,
  SORT_OPTIONS,
  VIRAL_PLATFORMS,
  VIRALITY_WINDOW_DAYS,
  type DiscoverySource,
  type SortBy,
  type TopicVerdict,
  type ViralPlatform,
  type ViralTrendContent,
} from "@/lib/viralTrends";
import {
  isCurrentlyRanked,
  listMonitoredTopics,
  SIGNAL_PLATFORM_LABEL,
  signalConfidence,
  type MonitoredTopic,
} from "@/lib/monitoredTopics";
import { GROWTH_THRESHOLD_PCT } from "@/lib/topicGrowth";
import {
  listCrossSourceTrends,
  TIER_CHILI_COUNT,
  TIER_LABEL,
  type CrossSourceTrend,
} from "@/lib/crossSourceTrends";

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
  // Nessun contenuto reale ancora (predisposizione, Fase 9): la label serve
  // solo a soddisfare il tipo, il filtro non produce risultati per ora.
  "trending-audio": "Audio",
  "x-trending": "X",
  "canali-inspo": "Canali Inspo",
  "reddit-trending": "Reddit",
  "youtube-trending": "YouTube",
};

const SORT_LABELS: Record<SortBy, string> = {
  virality: "Viralità",
  date: "Più recenti",
  engagement: "Engagement",
  views: "Views",
};

// "trending topic" raggruppa le due fonti di scoperta (TikTok, Google
// Trends); "audio" è la fonte predisposta ma non ancora implementata (Fase
// 9) — il filtro esiste già, semplicemente non produce risultati per ora.
const CONTENT_TYPE_OPTIONS = ["all", "topic", "audio"] as const;
type ContentTypeFilter = (typeof CONTENT_TYPE_OPTIONS)[number];
const CONTENT_TYPE_LABELS: Record<ContentTypeFilter, string> = {
  all: "Tutti i tipi",
  topic: "Trending topic",
  audio: "Audio",
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

// Intervallo reale coperto dal delta mostrato, non il tetto massimo della
// finestra di eleggibilità (VIRALITY_WINDOW_DAYS = 7gg): delta_since è il
// captured_at dello snapshot più vecchio usato da computeDeltaMetrics per
// calcolare delta_engagement/delta_reach (vedi sync-viral-trends.ts e
// recheck-viral-engagement.ts) — un post visto la prima volta 18 ore fa deve
// mostrare "nelle ultime 18h", non "ultimi 7gg" anche se la finestra di
// ricerca dello snapshot arriva fino a 7 giorni indietro.
function formatSinceLabel(deltaSince: string | null): string {
  if (!deltaSince) return `ultimi ${VIRALITY_WINDOW_DAYS}gg`;

  const hours = (Date.now() - new Date(deltaSince).getTime()) / (1000 * 60 * 60);
  if (hours < 1) return "nell'ultima ora";
  if (hours < 24) return `nelle ultime ${Math.round(hours)}h`;

  const days = Math.round(hours / 24);
  return `negli ultimi ${days} giorn${days === 1 ? "o" : "i"}`;
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
        ({formatSinceLabel(item.delta_since)})
      </span>
    </span>
  );
}

// Percentuale calcolata solo se il campione è abbastanza grande da fidarsi
// (vedi computeTopicGrowth in src/lib/topicGrowth.ts) — null non è "0% di
// crescita", è "non ancora misurabile" e va distinto in UI. Sotto la soglia
// dell'1% il topic è "non in aumento" (richiesta esplicita), non per forza
// in calo: il colore neutro copre sia il caso piatto sia una lieve discesa.
function GrowthIndicator({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="text-[11px] text-muted-foreground">Dati insufficienti</span>;
  }
  if (pct >= GROWTH_THRESHOLD_PCT) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <TrendingUp className="size-3.5" />+{pct.toFixed(1)}%
      </span>
    );
  }
  if (pct <= -GROWTH_THRESHOLD_PCT) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <TrendingDown className="size-3.5" />
        {pct.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Minus className="size-3.5" />
      non in aumento
    </span>
  );
}

// Verdetto di viralità del topic (vedi computeTopicVerdict in
// src/lib/viralTrends.ts): "produce" se almeno un contenuto sta accelerando
// ora, "si scalda" se c'è crescita ma nessun contenuto ancora virale,
// "piatto" altrimenti. Sostituisce il vecchio badge "Viralità marcata", che
// richiedeva la crescita di volume ED engagement totali e quindi premiava il
// volume di pubblicazione invece del singolo contenuto che esplode.
const VERDICT_META: Record<TopicVerdict, { label: string; className: string; Icon: typeof Flame }> =
  {
    producing: {
      label: "Produce virale",
      className: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
      Icon: Flame,
    },
    warming: {
      label: "Si scalda",
      className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      Icon: TrendingUp,
    },
    flat: {
      label: "Nessun virale ora",
      className: "bg-muted text-muted-foreground",
      Icon: Minus,
    },
    unknown: {
      label: "Dati insufficienti",
      className: "bg-muted/60 text-muted-foreground",
      Icon: CircleDashed,
    },
  };

function VerdictBadge({ verdict }: { verdict: TopicVerdict }) {
  const { label, className, Icon } = VERDICT_META[verdict];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

// Filtro attivo sui contenuti quando l'utente clicca una keyword (in
// sidebar o in "Trendzning Now") invece di scrivere nella ricerca testuale —
// tre modi di abbinamento perché le fonti non condividono tutte la stessa
// chiave (vedi topic_id per TikTok/Google/X, cross_profile_topic per Canali
// Inspo). Combinati in OR: un contenuto passa se soddisfa almeno uno.
interface ActiveTopicFilter {
  label: string;
  topicIds: string[];
  sourceHashtag: string | null;
  canaliInspoTopic: string | null;
}

function contentMatchesTopicFilter(item: ViralTrendContent, filter: ActiveTopicFilter): boolean {
  if (filter.topicIds.length > 0 && item.topic_id && filter.topicIds.includes(item.topic_id)) {
    return true;
  }
  if (filter.sourceHashtag != null && item.source_hashtag === filter.sourceHashtag) {
    return true;
  }
  if (filter.canaliInspoTopic != null && item.cross_profile_topic === filter.canaliInspoTopic) {
    return true;
  }
  return false;
}

type RankedTopicType = "tiktok-hashtag" | "google-trends" | "x-trending";

// Nessun "rank" reale esiste ancora per Google Trends (solo TikTok
// Creative Center lo fornisce, e nemmeno quello è esposto oggi da
// list-monitored-topics) — come proxy si ordina per il volume più alto
// disponibile tra i segnali del topic (il più esatto se ce n'è più di uno),
// così la classifica numerata riflette comunque "quanto è grande il topic
// adesso", non l'ordine di arrivo dall'API.
function topicRankValue(topic: MonitoredTopic): number {
  let best = -1;
  for (const s of topic.signals) {
    if (s.latest_content_volume != null && s.latest_content_volume > best) {
      best = s.latest_content_volume;
    }
  }
  return best;
}

function TopicRankingRow({
  rank,
  topic,
  verdict,
  onSelect,
}: {
  rank: number;
  topic: MonitoredTopic;
  verdict: TopicVerdict;
  onSelect: () => void;
}) {
  const label = topic.topic_type === "tiktok-hashtag" ? `#${topic.value}` : topic.value;
  const producing = verdict === "producing";
  // TikTok (esatto) prima di Instagram (campione).
  const signals = [...topic.signals].sort((a, b) =>
    a.platform === b.platform ? 0 : a.platform === "tiktok" ? -1 : 1,
  );

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:border-primary/60 ${
          producing ? "border-orange-500/60 bg-orange-500/5" : "border-border bg-card"
        }`}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{label}</p>
            <VerdictBadge verdict={verdict} />
          </div>
          {topic.topic_type === "x-trending" ? (
            // X non fornisce qui alcun volume/conteggio utilizzabile (solo
            // rank + categoria in pagina) — su richiesta esplicita questa
            // fonte non traccia crescita/segnali come le altre due, mostra
            // solo la categoria vista da X (assente per i trend senza una
            // categoria reale, es. "Trending in Italy").
            <span className="mt-0.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {topic.category ?? "Nessuna categoria"}
            </span>
          ) : signals.length === 0 ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Nessun segnale ancora rilevato
            </p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              {signals.map((s) => {
                const sampled = signalConfidence(s) === "sampled";
                return (
                  <div key={s.platform} className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-foreground">
                      {SIGNAL_PLATFORM_LABEL[s.platform]}
                    </span>
                    {s.latest_content_volume != null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {sampled ? "~" : ""}
                        {formatCompactNumber(s.latest_content_volume)}
                      </span>
                    )}
                    <GrowthIndicator pct={s.volume_growth_pct} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

function TopicRankingList({
  topics,
  view,
  contentByTopic,
  onSelect,
}: {
  topics: MonitoredTopic[];
  view: RankedTopicType;
  contentByTopic: Map<string, ViralTrendContent[]>;
  onSelect: (topic: MonitoredTopic) => void;
}) {
  // Solo i topic davvero ancora in classifica adesso, non quelli nel periodo
  // di grazia (usciti dai top-N, ma ancora status='active' e monitorati in
  // background per altre 24h) — vedi isCurrentlyRanked in monitoredTopics.ts.
  // Ordinati per volume decrescente per dare una classifica numerata stabile
  // invece della griglia libera di prima.
  const shown = useMemo(
    () =>
      topics
        .filter((t) => t.topic_type === view && isCurrentlyRanked(t))
        .sort((a, b) => topicRankValue(b) - topicRankValue(a)),
    [topics, view],
  );

  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nessun topic monitorato al momento per questa fonte.
      </p>
    );
  }

  return (
    <ol className="max-h-[36rem] space-y-1.5 overflow-y-auto pr-1">
      {shown.map((t, i) => (
        <TopicRankingRow
          key={t.id}
          rank={i + 1}
          topic={t}
          verdict={computeTopicVerdict(contentByTopic.get(t.value) ?? [], {
            hasSignals: t.signals.length > 0,
          })}
          onSelect={() => onSelect(t)}
        />
      ))}
    </ol>
  );
}

// Classifica Canali Inspo nella sidebar: non esiste un rank/volume reale
// come per le altre 3 fonti (nessun conteggio ufficiale), quindi si ordina
// per numero di canali distinti (il segnale più forte di un trend cross-
// profilo) poi per numero di post.
function CanaliInspoTopicList({
  topics,
  onSelect,
}: {
  topics: { topic: string; channelCount: number; postCount: number }[];
  onSelect: (topic: string) => void;
}) {
  if (topics.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nessun trend cross-profilo rilevato al momento.
      </p>
    );
  }

  return (
    <ol className="max-h-[36rem] space-y-1.5 overflow-y-auto pr-1">
      {topics.map((t, i) => (
        <li key={t.topic}>
          <button
            type="button"
            onClick={() => onSelect(t.topic)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary/60"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{t.topic}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t.channelCount} canali · {t.postCount} post
              </p>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}

const SIDEBAR_SOURCES = ["canali-inspo", "x-trending", "tiktok-hashtag", "google-trends"] as const;
type SidebarSource = (typeof SIDEBAR_SOURCES)[number];
const SIDEBAR_SOURCE_LABELS: Record<SidebarSource, string> = {
  "canali-inspo": "Canali Inspo",
  "x-trending": "X",
  "tiktok-hashtag": "TikTok",
  "google-trends": "Google",
};

function TrendSidebar({
  sidebarSource,
  setSidebarSource,
  topics,
  topicsError,
  contentByTopic,
  crossProfileTopics,
  onSelectTopic,
  onSelectCanaliInspoTopic,
}: {
  sidebarSource: SidebarSource;
  setSidebarSource: (s: SidebarSource) => void;
  topics: MonitoredTopic[];
  topicsError: string | null;
  contentByTopic: Map<string, ViralTrendContent[]>;
  crossProfileTopics: { topic: string; channelCount: number; postCount: number }[];
  onSelectTopic: (topic: MonitoredTopic) => void;
  onSelectCanaliInspoTopic: (topic: string) => void;
}) {
  return (
    <aside className="w-full shrink-0 space-y-3 lg:w-80">
      <h2 className="text-sm font-semibold text-foreground">Classifiche per fonte</h2>

      <Tabs value={sidebarSource} onValueChange={(v) => setSidebarSource(v as SidebarSource)}>
        <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-2">
          {SIDEBAR_SOURCES.map((s) => (
            <TabsTrigger key={s} value={s} className="text-xs">
              {SIDEBAR_SOURCE_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {sidebarSource === "canali-inspo" ? (
        <CanaliInspoTopicList topics={crossProfileTopics} onSelect={onSelectCanaliInspoTopic} />
      ) : topicsError ? (
        <p className="text-sm text-destructive">
          Errore nel caricamento dei topic monitorati: {topicsError}.
        </p>
      ) : (
        <TopicRankingList
          topics={topics}
          view={sidebarSource}
          contentByTopic={contentByTopic}
          onSelect={onSelectTopic}
        />
      )}
    </aside>
  );
}

// Riga di un trend condiviso da più fonti (o solo Canali Inspo) nella tab
// "Trendzning Now" — vedi scripts/match-cross-source-trends.mjs. Tre tag
// indipendenti e non esclusivi: "Dai Canali Inspo" quando quella fonte fa
// parte del gruppo, il tier (peperoncini) quando il gruppo copre 2+ fonti,
// "In accelerazione" (fulmine) quando ALMENO UNO dei topic del gruppo sta
// accelerando ora — dimensione diversa dal tier: un trend può essere
// condiviso da molte fonti ma stabile, o da poche ma in forte accelerazione.
// Un trend può avere tutti e tre insieme.
function CrossSourceTrendRow({
  trend,
  onSelect,
}: {
  trend: CrossSourceTrend;
  onSelect: () => void;
}) {
  const fromCanaliInspo = trend.sources.includes("canali-inspo");
  const otherSources = trend.sources.filter((s) => s !== "canali-inspo");

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/60"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{trend.label}</p>
          {trend.tier && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
              {"🌶️".repeat(TIER_CHILI_COUNT[trend.tier])} {TIER_LABEL[trend.tier]}
            </span>
          )}
          {trend.is_accelerating && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              <Zap className="size-3" /> In accelerazione
            </span>
          )}
          {fromCanaliInspo && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Dai Canali Inspo
            </span>
          )}
        </div>
        {otherSources.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Presente anche su{" "}
            {otherSources.map((s) => DISCOVERY_SOURCE_LABELS[s as DiscoverySource]).join(", ")}
          </p>
        )}
      </button>
    </li>
  );
}

function TrendzningNowView({
  trends,
  loading,
  error,
  onSelect,
}: {
  trends: CrossSourceTrend[];
  loading: boolean;
  error: string | null;
  onSelect: (trend: CrossSourceTrend) => void;
}) {
  // Più fonti condivise prima (i tre peperoncini in cima), a parità i trend
  // Canali Inspo isolati (source_count=1) restano in coda: sono comunque
  // sempre mostrati (tag "Dai Canali Inspo"), solo meno in evidenza dei
  // trend confermati da più fonti indipendenti.
  const sorted = useMemo(
    () => [...trends].sort((a, b) => b.source_count - a.source_count),
    [trends],
  );

  if (error) {
    return <p className="text-sm text-destructive">Errore nel caricamento: {error}.</p>;
  }
  if (loading) {
    return <div className="text-sm text-muted-foreground">Caricamento…</div>;
  }
  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        Nessun trend rilevato ancora. Il workflow "Match Trend Cross-Fonte" (ogni 6h) confronta le
        keyword di TikTok, Google Trends, X e Canali Inspo e segnala quelle condivise da più fonti.
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {sorted.map((t) => (
        <CrossSourceTrendRow key={t.id} trend={t} onSelect={() => onSelect(t)} />
      ))}
    </ol>
  );
}

// Card di un singolo contenuto, riusata sia nella tab "Trendzning Now" (via
// filtro) sia in "Contenuti". Il badge del trend cross-profilo (3+ canali
// diversi sullo stesso argomento, vedi discover-canali-inspo-content.mjs)
// compare ovunque sia valorizzato, non solo per i post Canali Inspo.
function ContentCard({ item }: { item: ViralTrendContent }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 transition hover:border-primary/60">
      <LazyEmbed url={item.url} />

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

        {item.author && <p className="text-xs font-semibold text-foreground">{item.author}</p>}

        <a href={item.url} target="_blank" rel="noreferrer" className="block hover:underline">
          <p className="line-clamp-3 text-xs text-muted-foreground">{item.content || item.url}</p>
        </a>

        <p className="text-[10px] text-muted-foreground">
          {item.discovery_source === "tiktok-hashtag"
            ? `#${item.source_hashtag}`
            : item.source_hashtag}{" "}
          → {item.keyword_matched}
        </p>

        {item.cross_profile_topic && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-orange-500/10 px-2 py-1 text-[11px] font-medium text-orange-600 dark:text-orange-400">
            <Flame className="size-3.5 shrink-0" />
            Trend condiviso da {item.cross_profile_channel_count} canali: {item.cross_profile_topic}
          </span>
        )}

        <div className="flex items-center gap-3 text-xs tabular-nums">
          {/* reach è null (non 0) per i post foto/carosello: Instagram non
          traccia le views per contenuti statici, non è un dato mancante
          da segnalare con un placeholder — l'indicatore va tolto del tutto. */}
          {item.reach != null && (
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3 text-muted-foreground" />
              {formatCompactNumber(item.reach)}
            </span>
          )}
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
  );
}

// Contenuti mostrati inizialmente e ad ogni click su "Carica altri". Il DOM
// delle card non è comunque leggero (una per ogni contenuto filtrato) anche
// se il singolo embed è lazy (vedi LazyEmbed in SocialEmbed.tsx, che rimanda
// il montaggio dell'iframe/fetch a quando la card entra in viewport): il
// limite qui evita di mettere in pagina centinaia di card insieme.
const PAGE_SIZE = 8;

type MainTab = "trendzning-now" | "content";
const MAIN_TAB_LABELS: Record<MainTab, string> = {
  "trendzning-now": "Trendzning Now",
  content: "Contenuti",
};

function Page() {
  const [items, setItems] = useState<ViralTrendContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<ViralPlatform | "all">("all");
  const [hashtagFilter, setHashtagFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<DiscoverySource | "all">("all");
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentTypeFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("virality");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [topics, setTopics] = useState<MonitoredTopic[]>([]);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicContent, setTopicContent] = useState<ViralTrendContent[]>([]);

  const [crossSourceTrends, setCrossSourceTrends] = useState<CrossSourceTrend[]>([]);
  const [crossSourceLoading, setCrossSourceLoading] = useState(true);
  const [crossSourceError, setCrossSourceError] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>("trendzning-now");
  const [sidebarSource, setSidebarSource] = useState<SidebarSource>("canali-inspo");
  const [activeTopicFilter, setActiveTopicFilter] = useState<ActiveTopicFilter | null>(null);

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

  useEffect(() => {
    listMonitoredTopics()
      .then(setTopics)
      .catch((err) => setTopicsError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    setCrossSourceLoading(true);
    setCrossSourceError(null);
    listCrossSourceTrends()
      .then(setCrossSourceTrends)
      .catch((err) => setCrossSourceError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCrossSourceLoading(false));
  }, []);

  // Contenuti per il verdetto dei topic: fetch senza filtri di
  // piattaforma/hashtag, così il verdetto in cima resta stabile mentre
  // l'utente filtra il feed sotto. Fase 1: derivato dal feed già caricato; la
  // Fase 2 lo sposterà server-side in topic_signals con un livello di
  // confidenza.
  useEffect(() => {
    listViralTrendContent({ sortBy: "virality" })
      .then(setTopicContent)
      .catch(() => setTopicContent([]));
  }, []);

  // I contenuti sono raggruppati per source_hashtag, che per i topic da
  // hashtag TikTok coincide con l'hashtag (topic.value) e per i topic Google
  // Trends col termine di ricerca (anch'esso topic.value): la stessa chiave
  // vale per entrambe le fonti.
  const contentByTopic = useMemo(() => {
    const map = new Map<string, ViralTrendContent[]>();
    for (const c of topicContent) {
      const arr = map.get(c.source_hashtag);
      if (arr) arr.push(c);
      else map.set(c.source_hashtag, [c]);
    }
    return map;
  }, [topicContent]);

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

  // Elenco dei trend cross-profilo distinti tra i post Canali Inspo caricati
  // (3+ canali sullo stesso argomento, rilevati da discover-canali-inspo-content.mjs
  // via clustering LLM — vedi cross_profile_topic/cross_profile_channel_count).
  // Alimenta il pannello "Canali Inspo" della sidebar. Derivato lato client
  // dagli stessi item già caricati, nessun fetch in più.
  const crossProfileTopics = useMemo(() => {
    const byTopic = new Map<string, { channelCount: number; postCount: number }>();
    for (const item of items) {
      if (item.discovery_source !== "canali-inspo" || !item.cross_profile_topic) continue;
      const existing = byTopic.get(item.cross_profile_topic);
      if (existing) {
        existing.postCount += 1;
      } else {
        byTopic.set(item.cross_profile_topic, {
          channelCount: item.cross_profile_channel_count ?? 0,
          postCount: 1,
        });
      }
    }
    return Array.from(byTopic.entries())
      .map(([topic, stats]) => ({ topic, ...stats }))
      .sort((a, b) => b.channelCount - a.channelCount || b.postCount - a.postCount);
  }, [items]);

  function selectTopic(topic: MonitoredTopic) {
    const label = topic.topic_type === "tiktok-hashtag" ? `#${topic.value}` : topic.value;
    setActiveTopicFilter({
      label,
      topicIds: [topic.id],
      sourceHashtag: topic.value,
      canaliInspoTopic: null,
    });
    setSourceFilter("all");
    setMainTab("content");
  }

  function selectCanaliInspoTopic(topic: string) {
    setActiveTopicFilter({
      label: topic,
      topicIds: [],
      sourceHashtag: null,
      canaliInspoTopic: topic,
    });
    setSourceFilter("all");
    setMainTab("content");
  }

  function selectCrossSourceTrend(trend: CrossSourceTrend) {
    setActiveTopicFilter({
      label: trend.label,
      topicIds: trend.topic_ids,
      sourceHashtag: null,
      canaliInspoTopic: trend.canali_inspo_topic,
    });
    setSourceFilter("all");
    setMainTab("content");
  }

  const filtered = useMemo(() => {
    let result = items;
    if (activeTopicFilter) {
      result = result.filter((i) => contentMatchesTopicFilter(i, activeTopicFilter));
    }
    if (sourceFilter !== "all") result = result.filter((i) => i.discovery_source === sourceFilter);
    if (contentTypeFilter === "topic") {
      result = result.filter((i) => i.discovery_source !== "trending-audio");
    } else if (contentTypeFilter === "audio") {
      result = result.filter((i) => i.discovery_source === "trending-audio");
    }
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
  }, [items, activeTopicFilter, sourceFilter, contentTypeFilter, search]);

  // Ogni cambio di filtro/ricerca (o nuovo fetch) riparte dalla prima pagina:
  // altrimenti "Carica altri" premuto prima potrebbe lasciare visibleCount
  // più alto del nuovo risultato filtrato, mostrando comunque tutto invece
  // di limitare come richiesto.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [items, activeTopicFilter, sourceFilter, contentTypeFilter, search]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trend Virali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Topic scoperti da tre fonti indipendenti — hashtag TikTok in trend (convertiti in keyword
          leggibile, es. #empirestatebuilding → "Empire State Building"), ricerche in tendenza
          Google Trends per l'Italia e trend X.com — poi cercati su Instagram. Contenuti sempre
          degli ultimi {VIRALITY_WINDOW_DAYS} giorni, con la variazione di view/engagement rilevata
          rispetto al sync più vecchio in questa stessa finestra.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)}>
            <TabsList>
              {(["trendzning-now", "content"] as const).map((v) => (
                <TabsTrigger key={v} value={v}>
                  {MAIN_TAB_LABELS[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {mainTab === "trendzning-now" && (
            <TrendzningNowView
              trends={crossSourceTrends}
              loading={crossSourceLoading}
              error={crossSourceError}
              onSelect={selectCrossSourceTrend}
            />
          )}

          {mainTab === "content" && (
            <>
              {activeTopicFilter && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Filtrato per:</span>
                  <span className="font-medium text-foreground">{activeTopicFilter.label}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTopicFilter(null)}
                    aria-label="Rimuovi filtro"
                    className="ml-auto flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

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

                <Select
                  value={contentTypeFilter}
                  onValueChange={(v) => setContentTypeFilter(v as ContentTypeFilter)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Tipologia" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPE_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CONTENT_TYPE_LABELS[c]}
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

                <span className="ml-auto text-xs text-muted-foreground">
                  {filtered.length} contenuti
                </span>
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
                  Nessun contenuto ancora. Il workflow "Sync Trend Virali" popola questa pagina una
                  volta al giorno a partire dagli hashtag TikTok in trend e dalle ricerche Google
                  Trends IT.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map((item) => (
                    <ContentCard key={item.id} item={item} />
                  ))}
                </div>
              )}

              {!error && !loading && visibleCount < filtered.length && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground transition hover:border-primary/60"
                  >
                    Carica altri ({filtered.length - visibleCount} rimanenti)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <TrendSidebar
          sidebarSource={sidebarSource}
          setSidebarSource={setSidebarSource}
          topics={topics}
          topicsError={topicsError}
          contentByTopic={contentByTopic}
          crossProfileTopics={crossProfileTopics}
          onSelectTopic={selectTopic}
          onSelectCanaliInspoTopic={selectCanaliInspoTopic}
        />
      </div>
    </div>
  );
}
