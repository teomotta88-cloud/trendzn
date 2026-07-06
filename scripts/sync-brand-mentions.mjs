// Reputazione Brand: cerca menzioni del brand e invia il risultato all'hook
// sync-brand-mentions, che fa l'upsert su Supabase (vedi sync-tiktok-hashtag.mjs
// per lo stesso pattern: script esterno -> hook pubblico -> supabaseAdmin).
//
// Stato attuale: solo YouTube e' collegato a una fonte dati reale e gratuita
// (YouTube Data API v3, richiede solo una API key gratuita — niente OAuth,
// niente carta di credito, quota gratuita 10.000 unita'/giorno). Le altre
// piattaforme (Twitter/X, Reddit, Instagram, LinkedIn) restano collegate ad
// anysite (https://api.anysite.io) ma non vengono eseguite di default perche'
// l'account anysite in uso e' in trial e la sua REST API diretta risponde
// 403 "This token is restricted to MCP usage only" — serve un piano a
// pagamento per sbloccarle. Il codice resta pronto: basta aggiungere quelle
// piattaforme a PLATFORMS quando l'accesso anysite sara' disponibile.
//
// Variabili d'ambiente:
//   YOUTUBE_API_KEY         richiesta se "youtube" e' tra le PLATFORMS eseguite
//   ANYSITE_API_KEY         richiesta se una piattaforma anysite e' tra le PLATFORMS eseguite
//   PLATFORMS               csv, default: "youtube" (opzioni: youtube,twitter,reddit,instagram,linkedin)
//   KEYWORDS                csv, default: "hyundai,hyundai_italia"
//   MAX_RESULTS_PER_CALL    default: 25 (ogni risultato consuma quota/credit)
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//
// Eseguito da .github/workflows/sync-brand-mentions.yml su schedule.

const ANYSITE_BASE = "https://api.anysite.io";
const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_BASE = "https://www.googleapis.com/youtube/v3/videos";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-brand-mentions";

const KEYWORDS = (process.env.KEYWORDS ?? "hyundai,hyundai_italia")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const PLATFORMS_TO_RUN = (process.env.PLATFORMS ?? "youtube")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const MAX_RESULTS_PER_CALL = parseInt(process.env.MAX_RESULTS_PER_CALL ?? "25", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);

const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (PLATFORMS_TO_RUN.includes("youtube") && !youtubeApiKey) {
  console.error("Manca YOUTUBE_API_KEY nell'ambiente (richiesta da PLATFORMS=youtube).");
  process.exit(1);
}

const anysiteApiKey = process.env.ANYSITE_API_KEY;
const ANYSITE_PLATFORMS = ["twitter", "reddit", "instagram", "linkedin"];
if (PLATFORMS_TO_RUN.some((p) => ANYSITE_PLATFORMS.includes(p)) && !anysiteApiKey) {
  console.error("Manca ANYSITE_API_KEY nell'ambiente (richiesta dalle piattaforme anysite in PLATFORMS).");
  process.exit(1);
}

// path/param anysite: confermati per twitter, dedotti per gli altri (vedi
// PR #80). Non eseguiti di default: vedi nota in testa al file.
const ANYSITE_ENDPOINTS = {
  twitter: { path: "/api/twitter/search/posts", param: "query" },
  reddit: { path: "/api/reddit/search/posts", param: "query" },
  instagram: { path: "/api/instagram/search/posts", param: "query" },
  linkedin: { path: "/api/linkedin/search/posts", param: "keywords" },
};

// Framework "Manual Sentiment Classification" dal MONITORING_GUIDE.md della skill.
const POSITIVE_WORDS = [
  "love", "great", "amazing", "best", "recommend", "recommended",
  "consiglio", "consigliato", "fantastico", "ottimo", "top",
];
const NEGATIVE_WORDS = [
  "disappointed", "worst", "terrible", "awful", "broken", "refund", "problem",
  "deluso", "pessimo", "rotto", "rimborso", "problema", "guasto",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifySentiment(text) {
  const t = (text ?? "").toLowerCase();
  const positive = POSITIVE_WORDS.some((w) => t.includes(w));
  const negative = NEGATIVE_WORDS.some((w) => t.includes(w));
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  return "neutral";
}

async function searchYouTube(keyword) {
  const url = new URL(YOUTUBE_BASE);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", keyword);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", String(Math.min(MAX_RESULTS_PER_CALL, 50)));
  url.searchParams.set("key", youtubeApiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.items ?? [];
}

// search.list non include statistiche (viste/like/commenti): videos.list le
// da' in un'unica chiamata batch per fino a 50 ID, costo 1 unita' di quota
// totale (non per video) — molto piu' economico che chiamarla per ogni item.
async function fetchVideoStatistics(videoIds) {
  if (videoIds.length === 0) return new Map();

  const url = new URL(YOUTUBE_VIDEOS_BASE);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", youtubeApiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube videos.list failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return new Map((data.items ?? []).map((v) => [v.id, v.statistics ?? {}]));
}

function normalizeYouTubeResult(keyword, item, statsByVideoId) {
  const videoId = item.id?.videoId ?? "";
  const snippet = item.snippet ?? {};
  const stats = statsByVideoId.get(videoId) ?? {};
  const likes = Number(stats.likeCount ?? 0);
  const comments = Number(stats.commentCount ?? 0);
  const views = stats.viewCount != null ? Number(stats.viewCount) : null;

  return {
    platform: "youtube",
    external_id: videoId || `youtube-${keyword}-${Math.random().toString(36).slice(2)}`,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    author: snippet.channelTitle ?? null,
    content: [snippet.title, snippet.description].filter(Boolean).join(" — "),
    published_at: snippet.publishedAt ?? null,
    keyword_matched: keyword,
    sentiment: classifySentiment(`${snippet.title ?? ""} ${snippet.description ?? ""}`),
    engagement: likes + comments,
    reach: views,
    is_viral: likes + comments > 1000,
    raw: item,
  };
}

async function searchAnysite(platform, keyword) {
  const { path, param } = ANYSITE_ENDPOINTS[platform];
  const url = new URL(path, ANYSITE_BASE);

  const res = await fetch(url, {
    method: "POST",
    headers: { "access-token": anysiteApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ [param]: keyword, count: MAX_RESULTS_PER_CALL }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anysite ${platform} search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? data.data ?? data.items ?? []);
}

function normalizeAnysiteResult(platform, keyword, item) {
  const externalId = String(item.id ?? item.post_id ?? item.external_id ?? item.url ?? "");
  const url = item.url ?? item.link ?? item.permalink ?? "";
  const content = item.text ?? item.content ?? item.caption ?? item.title ?? item.body ?? "";
  const author = item.author ?? item.username ?? item.user?.username ?? item.channel ?? null;
  const publishedAt = item.published_at ?? item.created_at ?? item.date ?? null;
  const likes = item.likes ?? item.like_count ?? 0;
  const shares = item.shares ?? item.retweet_count ?? item.share_count ?? 0;
  const comments = item.comments ?? item.comment_count ?? item.reply_count ?? 0;
  const reach = item.followers ?? item.follower_count ?? item.reach ?? null;
  const engagement = Number(likes) + Number(shares) + Number(comments);

  return {
    platform,
    external_id: externalId || `${platform}-${keyword}-${Math.random().toString(36).slice(2)}`,
    url,
    author,
    content,
    published_at: publishedAt,
    keyword_matched: keyword,
    sentiment: classifySentiment(content),
    engagement,
    reach,
    is_viral: engagement > 1000,
    raw: item,
  };
}

async function fetchMentions(platform, keyword) {
  if (platform === "youtube") {
    const items = await searchYouTube(keyword);
    const videoIds = items.map((item) => item.id?.videoId).filter(Boolean);
    const statsByVideoId = await fetchVideoStatistics(videoIds);
    return items.map((item) => normalizeYouTubeResult(keyword, item, statsByVideoId));
  }
  const items = await searchAnysite(platform, keyword);
  return items.map((item) => normalizeAnysiteResult(platform, keyword, item));
}

async function sendToHook(mentions, run) {
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mentions, run }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync endpoint failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — Reputazione Brand ===");
console.log(`Piattaforme: ${PLATFORMS_TO_RUN.join(", ")}`);
console.log(`Keyword: ${KEYWORDS.join(", ")}`);

let totalInserted = 0;
const summary = [];

for (const platform of PLATFORMS_TO_RUN) {
  for (const keyword of KEYWORDS) {
    const startedAt = new Date().toISOString();
    console.log(`\n[${platform}] "${keyword}"`);
    try {
      const mentions = await fetchMentions(platform, keyword);
      console.log(`  Trovate ${mentions.length} mention`);

      const result = await sendToHook(mentions, {
        platform,
        keyword,
        requests_used: 1,
        mentions_found: mentions.length,
        status: "ok",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      totalInserted += result.inserted ?? 0;
      summary.push({ platform, keyword, found: mentions.length, inserted: result.inserted ?? 0 });
      console.log(`  Sincronizzate (nuove o aggiornate): ${result.inserted ?? 0}`);
    } catch (err) {
      console.error(`  ERRORE: ${String(err)}`);
      summary.push({ platform, keyword, error: String(err) });
      await sendToHook([], {
        platform,
        keyword,
        requests_used: 1,
        mentions_found: 0,
        status: "error",
        error_message: String(err).slice(0, 500),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      }).catch(() => {});
    }

    await sleep(DELAY_MS);
  }
}

console.log("\n=== RIEPILOGO ===");
for (const r of summary) {
  if (r.error) {
    console.log(`  [${r.platform}] "${r.keyword}": ERRORE — ${r.error}`);
  } else {
    console.log(`  [${r.platform}] "${r.keyword}": ${r.found} trovate → ${r.inserted} sincronizzate`);
  }
}
console.log(`\nTotale mention sincronizzate (nuove o aggiornate): ${totalInserted}`);
