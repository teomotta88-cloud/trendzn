// Trend Virali: nuova fonte di discovery "youtube-trending" — due liste
// distinte dalla stessa API (YouTube Data API v3, già in uso altrove nel
// progetto, vedi scripts/lib/social-search.mjs):
//
// 1. Trending IT classico: videos.list(chart=mostPopular, regionCode=IT) —
//    la classifica ufficiale "di tendenza" di YouTube per l'Italia.
// 2. Shorts candidati: search.list(videoDuration=short, order=date,
//    pubblicati nelle ultime SHORTS_LOOKBACK_HOURS) su un pool ampio,
//    ordinati poi lato client per viewCount — short recenti che stanno già
//    raccogliendo molte views, candidati alla "velocity" (vedi sotto).
//    (In produzione order=viewCount combinato con publishedAfter recente
//    dava sistematicamente 0 risultati: l'indice di ricerca di YouTube non
//    aggiorna il ranking per viewCount abbastanza in fretta per i video
//    pubblicati nelle ultime 48h, quindi quella combinazione di filtri non
//    trova mai nulla. order=date pesca invece tutto ciò che è stato
//    pubblicato nella finestra, e l'ordinamento per popolarità reale si fa
//    dopo aver recuperato le statistiche.)
//
// "Shorts velocity" non è un concetto YouTube ufficiale: è lo stesso
// meccanismo già in uso per TikTok/Reddit applicato qui — un singolo video
// non ha un "volume di contenuti" (è un contenuto solo), quindi si
// registra content_volume=null e total_engagement=viewCount: ogni volta che
// questo script lo ritrova (stesso video_id -> stesso value nel topic),
// computeTopicGrowth (src/lib/topicGrowth.ts) calcola da solo il tasso di
// crescita delle views normalizzato su 24h — è la "velocity" reale, non un
// singolo numero statico.
//
// Costo quota: search.list costa 100 unità per chiamata (quota default
// 10.000/giorno) — una sola chiamata a run, non per ogni short. videos.list
// (sia per trending che per le statistiche degli short) costa 1 unità
// indipendentemente dal numero di ID nella stessa chiamata batch.
//
// Variabili d'ambiente:
//   YOUTUBE_API_KEY        richiesta (stessa già usata da sync-brand-mentions.mjs)
//   MAX_TRENDING_VIDEOS    default: 15
//   MAX_SHORTS_CANDIDATES  default: 15 — quanti candidati finali tenere dopo
//                          l'ordinamento per viewCount
//   SHORTS_SEARCH_POOL     default: 50 (max consentito da search.list) —
//                          quanti short recenti recuperare PRIMA di
//                          ordinarli per viewCount e tagliare a
//                          MAX_SHORTS_CANDIDATES: un pool più ampio del
//                          risultato finale serve perché order=date non
//                          garantisce che i più virali siano tra i primi
//                          MAX_SHORTS_CANDIDATES pubblicati
//   SHORTS_LOOKBACK_HOURS  default: 48 — solo short pubblicati entro questa
//                          finestra sono candidati "early", non contenuti
//                          già vecchi ma ancora popolari
//
// Eseguito da .github/workflows/discover-youtube-trending.yml su schedule.

import { fetchVideoStatistics } from "./lib/social-search.mjs";
import { keywordToHashtag } from "./lib/word-segment.mjs";

const MONITOR_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/monitor-topics";
const RECORD_VOLUME_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/record-topic-volume";
const YOUTUBE_VIDEOS_BASE = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_SEARCH_BASE = "https://www.googleapis.com/youtube/v3/search";

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.error("Manca YOUTUBE_API_KEY nell'ambiente.");
  process.exit(1);
}

const MAX_TRENDING_VIDEOS = parseInt(process.env.MAX_TRENDING_VIDEOS ?? "15", 10);
const MAX_SHORTS_CANDIDATES = parseInt(process.env.MAX_SHORTS_CANDIDATES ?? "15", 10);
const SHORTS_SEARCH_POOL = parseInt(process.env.SHORTS_SEARCH_POOL ?? "50", 10);
const SHORTS_LOOKBACK_HOURS = parseInt(process.env.SHORTS_LOOKBACK_HOURS ?? "48", 10);

// Stessa soglia già usata per Google Trends/X/Reddit multi-parola: oltre le
// 2 parole (praticamente tutti i titoli YouTube) l'hashtag derivato ha un
// tasso di successo troppo basso sulla pagina hashtag Instagram.
const MAX_DERIVABLE_WORDS = 2;
const MAX_TITLE_LENGTH = 140;

function cleanTitle(title) {
  const collapsed = (title ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TITLE_LENGTH ? collapsed.slice(0, MAX_TITLE_LENGTH).trim() : collapsed;
}

// Stessa logica di toTopicFields in discover-reddit-trending.mjs /
// discover-x-trending.mjs.
function toTopicFields(rawTitle) {
  const value = cleanTitle(rawTitle);
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 1) return { value, derivedHashtag: value ? keywordToHashtag(value) : null };
  if (wordCount > MAX_DERIVABLE_WORDS) return { value, derivedHashtag: null };
  return { value, derivedHashtag: keywordToHashtag(value) };
}

async function fetchTrendingVideos() {
  const url = new URL(YOUTUBE_VIDEOS_BASE);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", "IT");
  url.searchParams.set("maxResults", String(MAX_TRENDING_VIDEOS));
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list(mostPopular) fallito (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []).map((item) => ({
    videoId: item.id,
    title: item.snippet?.title,
    channelTitle: item.snippet?.channelTitle ?? null,
    viewCount: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
    commentCount: item.statistics?.commentCount != null ? Number(item.statistics.commentCount) : null,
  }));
}

async function fetchShortsCandidates() {
  const publishedAfter = new Date(Date.now() - SHORTS_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const url = new URL(YOUTUBE_SEARCH_BASE);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoDuration", "short");
  url.searchParams.set("order", "date");
  url.searchParams.set("regionCode", "IT");
  url.searchParams.set("relevanceLanguage", "it");
  url.searchParams.set("publishedAfter", publishedAfter);
  url.searchParams.set("maxResults", String(SHORTS_SEARCH_POOL));
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`search.list(shorts) fallito (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const items = (data.items ?? []).filter((item) => item.id?.videoId);
  if (items.length === 0) return [];

  const stats = await fetchVideoStatistics({
    apiKey: API_KEY,
    videoIds: items.map((item) => item.id.videoId),
  });

  const withStats = items.map((item) => {
    const videoId = item.id.videoId;
    const s = stats.get(videoId) ?? {};
    return {
      videoId,
      title: item.snippet?.title,
      channelTitle: item.snippet?.channelTitle ?? null,
      viewCount: s.viewCount != null ? Number(s.viewCount) : null,
      commentCount: s.commentCount != null ? Number(s.commentCount) : null,
    };
  });

  // order=date ha già recuperato il pool: la selezione dei candidati "in
  // rapida crescita" avviene qui, ordinando per popolarità reale invece che
  // per data di pubblicazione.
  return withStats
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    .slice(0, MAX_SHORTS_CANDIDATES);
}

async function registerTopic(fields) {
  const res = await fetch(MONITOR_TOPICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topics: [fields] }),
  });
  if (!res.ok) throw new Error(`monitor-topics fallito (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`monitor-topics error: ${data.error}`);
  return data.topics?.[0]?.id ?? null;
}

async function recordSignal(topicId, { viewCount }) {
  const res = await fetch(RECORD_VOLUME_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicId,
      platform: "youtube",
      // Un video singolo non ha un "volume di contenuti" come un hashtag —
      // solo la crescita delle views nel tempo ha senso qui (vedi commento
      // in testa al file). is_volume_exact=true: YouTube dà conteggi reali,
      // non un campione.
      contentVolume: null,
      totalEngagement: viewCount,
      isVolumeExact: true,
    }),
  });
  if (!res.ok) throw new Error(`record-topic-volume fallito (${res.status}): ${await res.text()}`);
}

async function processVideos(videos, label) {
  let registered = 0;
  let skipped = 0;

  for (const video of videos) {
    if (!video.title || video.viewCount == null) {
      skipped++;
      continue;
    }

    const { value, derivedHashtag } = toTopicFields(video.title);
    if (!value) {
      skipped++;
      continue;
    }

    console.log(
      `  [${label}] "${value}" — canale=${video.channelTitle ?? "?"} views=${video.viewCount} commenti=${video.commentCount ?? "?"} hashtag=${derivedHashtag ?? "—"}`,
    );

    try {
      const topicId = await registerTopic({
        topicType: "youtube-trending",
        value,
        derivedHashtag,
        derivedKeyword: null,
        category: video.channelTitle,
      });
      if (!topicId) {
        skipped++;
        continue;
      }
      await recordSignal(topicId, { viewCount: video.viewCount });
      registered++;
    } catch (err) {
      console.error(`    Errore registrazione "${value}": ${String(err)}`);
      skipped++;
    }
  }

  return { registered, skipped };
}

console.log("=== TRENDZN — Discovery YouTube Trending + Shorts velocity ===");

let trendingResult = { registered: 0, skipped: 0 };
try {
  const trending = await fetchTrendingVideos();
  console.log(`\nTrending IT: ${trending.length} video trovati.`);
  trendingResult = await processVideos(trending, "trending");
} catch (err) {
  console.error(`Trending IT fallito: ${String(err)}`);
}

let shortsResult = { registered: 0, skipped: 0 };
try {
  const shorts = await fetchShortsCandidates();
  console.log(`\nShorts candidati (ultime ${SHORTS_LOOKBACK_HOURS}h): ${shorts.length} trovati.`);
  shortsResult = await processVideos(shorts, "shorts");
} catch (err) {
  console.error(`Shorts candidati fallito: ${String(err)}`);
}

console.log(
  `\n=== Fine === Trending: ${trendingResult.registered} registrati/${trendingResult.skipped} scartati · Shorts: ${shortsResult.registered} registrati/${shortsResult.skipped} scartati`,
);
