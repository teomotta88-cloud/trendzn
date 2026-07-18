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

type RankedTopicType = "tiktok-hashtag" | "google-trends" | "x-trending";
type TopicView = RankedTopicType | "content" | "canali-inspo";

const TOPIC_VIEW_LABELS: Record<TopicView, string> = {
  "tiktok-hashtag": "TikTok Trend",
  "google-trends": "Google Trend",
  "x-trending": "X Trend",
  content: "Contenuti",
  "canali-inspo": "Dai Canali Inspo",
};

const RANKED_TOPIC_VIEWS = ["tiktok-hashtag", "google-trends", "x-trending"] as const;
function isRankedTopicView(view: TopicView): view is RankedTopicType {
  return (RANKED_TOPIC_VIEWS as readonly string[]).includes(view);
}

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
}: {
  rank: number;
  topic: MonitoredTopic;
  verdict: TopicVerdict;
}) {
  const label = topic.topic_type === "tiktok-hashtag" ? `#${topic.value}` : topic.value;
  const producing = verdict === "producing";
  // TikTok (esatto) prima di Instagram (campione).
  const signals = [...topic.signals].sort((a, b) =>
    a.platform === b.platform ? 0 : a.platform === "tiktok" ? -1 : 1,
  );

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
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
          <p className="mt-0.5 text-[11px] text-muted-foreground">Nessun segnale ancora rilevato</p>
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
    </li>
  );
}

function TopicRankingList({
  topics,
  view,
  contentByTopic,
}: {
  topics: MonitoredTopic[];
  view: RankedTopicType;
  contentByTopic: Map<string, ViralTrendContent[]>;
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
    <ol className="space-y-1.5">
      {shown.map((t, i) => (
        <TopicRankingRow
          key={t.id}
          rank={i + 1}
          topic={t}
          verdict={computeTopicVerdict(contentByTopic.get(t.value) ?? [], {
            hasSignals: t.signals.length > 0,
          })}
        />
      ))}
    </ol>
  );
}

// Card di un singolo contenuto, riusata sia nel tab "Contenuti" sia nel tab
// "Dai Canali Inspo". Il badge del trend cross-profilo (3+ canali diversi
// sullo stesso argomento, vedi discover-canali-inspo-content.mjs) compare
// ovunque sia valorizzato, non solo nel tab Canali Inspo — un post del
// genere può comparire anche nel feed generale "Contenuti".
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
  const [canaliInspoVisibleCount, setCanaliInspoVisibleCount] = useState(PAGE_SIZE);

  const [topics, setTopics] = useState<MonitoredTopic[]>([]);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicContent, setTopicContent] = useState<ViralTrendContent[]>([]);
  const [view, setView] = useState<TopicView>("tiktok-hashtag");

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

  // Tab "Dai Canali Inspo": stesso array items già caricato (nessun fetch in
  // più), solo filtrato per fonte — coerente col fatto che items non è mai
  // filtrato per discovery_source lato server.
  const canaliInspoItems = useMemo(
    () => items.filter((i) => i.discovery_source === "canali-inspo"),
    [items],
  );

  // Stesso motivo del reset di visibleCount sopra: un nuovo fetch (o il primo
  // caricamento) non deve ereditare un conteggio più alto del nuovo elenco.
  useEffect(() => {
    setCanaliInspoVisibleCount(PAGE_SIZE);
  }, [items]);

  const canaliInspoVisible = canaliInspoItems.slice(0, canaliInspoVisibleCount);

  const filtered = useMemo(() => {
    let result = items;
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
  }, [items, sourceFilter, contentTypeFilter, search]);

  // Ogni cambio di filtro/ricerca (o nuovo fetch) riparte dalla prima pagina:
  // altrimenti "Carica altri" premuto prima potrebbe lasciare visibleCount
  // più alto del nuovo risultato filtrato, mostrando comunque tutto invece
  // di limitare come richiesto.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [items, sourceFilter, contentTypeFilter, search]);

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

      <section className="space-y-3">
        <Tabs value={view} onValueChange={(v) => setView(v as TopicView)}>
          <TabsList>
            {(
              ["tiktok-hashtag", "google-trends", "x-trending", "canali-inspo", "content"] as const
            ).map((v) => (
              <TabsTrigger key={v} value={v}>
                {TOPIC_VIEW_LABELS[v]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isRankedTopicView(view) &&
          (topicsError ? (
            <p className="text-sm text-destructive">
              Errore nel caricamento dei topic monitorati: {topicsError}.
            </p>
          ) : (
            <TopicRankingList topics={topics} view={view} contentByTopic={contentByTopic} />
          ))}
      </section>

      {view === "canali-inspo" && (
        <>
          {error ? (
            <p className="text-sm text-destructive">Errore nel caricamento: {error}.</p>
          ) : loading ? (
            <div className="text-sm text-muted-foreground">Caricamento…</div>
          ) : canaliInspoItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              Nessun post virale dai Canali Inspo ancora. Il workflow "Discover Canali Inspo
              Content" (ogni 6h) applica le regole di viralità ai post già raccolti e rileva i trend
              condivisi da più profili.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {canaliInspoVisible.map((item) => (
                  <ContentCard key={item.id} item={item} />
                ))}
              </div>

              {canaliInspoVisibleCount < canaliInspoItems.length && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setCanaliInspoVisibleCount((c) => c + PAGE_SIZE)}
                    className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground transition hover:border-primary/60"
                  >
                    Carica altri ({canaliInspoItems.length - canaliInspoVisibleCount} rimanenti)
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === "content" && (
        <>
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
              volta al giorno a partire dagli hashtag TikTok in trend e dalle ricerche Google Trends
              IT.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  );
}
