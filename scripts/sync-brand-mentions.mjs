// Reputazione Brand: cerca menzioni del brand e invia il risultato all'hook
// sync-brand-mentions, che fa l'upsert su Supabase (vedi sync-tiktok-hashtag.mjs
// per lo stesso pattern: script esterno -> hook pubblico -> supabaseAdmin).
//
// YouTube usa la Data API v3 ufficiale (API key gratuita). Twitter/X, Reddit,
// Instagram, LinkedIn usano la REST API di anysite (https://api.anysite.io,
// header access-token) — riattivate in PLATFORMS ora che l'account ha accesso
// REST diretto (non piu' il token "restricted to MCP usage only" del trial).
//
// ATTENZIONE: solo il path di twitter (/api/twitter/search/posts) e' stato
// confermato da un run reale. reddit/instagram/linkedin sono dedotti per
// coerenza di naming (vedi ANYSITE_ENDPOINTS in scripts/lib/social-search.mjs,
// condiviso con sync-viral-trends.mjs) e non ancora testati con un token
// valido: il primo run potrebbe dare 404 su questi tre e richiedere un
// aggiustamento dei path in base al log.
//
// Variabili d'ambiente:
//   YOUTUBE_API_KEY         richiesta se "youtube" e' tra le PLATFORMS eseguite
//   ANYSITE_API_KEY         richiesta se una piattaforma anysite e' tra le PLATFORMS eseguite
//   PLATFORMS               csv, default: "youtube" (opzioni: youtube,twitter,reddit,instagram,linkedin)
//   KEYWORDS                csv, default: "hyundai,hyundai_italia"
//   MAX_RESULTS_PER_CALL    default: 25 (ogni risultato consuma quota/credit)
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//   LANGUAGE                default: "it" — usato come bias nativo (youtube/twitter)
//                            e come filtro euristico lato script per reddit/instagram/linkedin
//   REGION                  default: "IT" — bias nativo per youtube (regionCode)
//
// Filtro lingua/regione: solo youtube (regionCode/relevanceLanguage) e twitter
// (operatore lang: nella query) hanno un filtro nativo, ed e' comunque un
// bias/preferenza, non un'esclusione rigida. reddit/instagram/linkedin non
// hanno un filtro lingua noto nella REST anysite: qui applichiamo un
// controllo euristico (parole funzionali italiane) lato script, impreciso
// ma sufficiente a scartare contenuti chiaramente in altre lingue.
//
// Eseguito da .github/workflows/sync-brand-mentions.yml su schedule.

import {
  ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS,
  containsKeyword,
  fetchVideoStatistics,
  looksItalian,
  normalizeAnysiteResult,
  normalizeYouTubeResult,
  searchAnysite,
  searchYouTube,
  sleep,
} from "./lib/social-search.mjs";

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
const LANGUAGE = process.env.LANGUAGE ?? "it";
const REGION = process.env.REGION ?? "IT";

const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (PLATFORMS_TO_RUN.includes("youtube") && !youtubeApiKey) {
  console.error("Manca YOUTUBE_API_KEY nell'ambiente (richiesta da PLATFORMS=youtube).");
  process.exit(1);
}

const anysiteApiKey = process.env.ANYSITE_API_KEY;
const ANYSITE_PLATFORMS = ["twitter", "reddit", "instagram", "linkedin"];
if (PLATFORMS_TO_RUN.some((p) => ANYSITE_PLATFORMS.includes(p)) && !anysiteApiKey) {
  console.error(
    "Manca ANYSITE_API_KEY nell'ambiente (richiesta dalle piattaforme anysite in PLATFORMS).",
  );
  process.exit(1);
}

// Framework "Manual Sentiment Classification" dal MONITORING_GUIDE.md della skill.
const POSITIVE_WORDS = [
  "love",
  "great",
  "amazing",
  "best",
  "recommend",
  "recommended",
  "consiglio",
  "consigliato",
  "fantastico",
  "ottimo",
  "top",
];
const NEGATIVE_WORDS = [
  "disappointed",
  "worst",
  "terrible",
  "awful",
  "broken",
  "refund",
  "problem",
  "deluso",
  "pessimo",
  "rotto",
  "rimborso",
  "problema",
  "guasto",
];

function classifySentiment(text) {
  const t = (text ?? "").toLowerCase();
  const positive = POSITIVE_WORDS.some((w) => t.includes(w));
  const negative = NEGATIVE_WORDS.some((w) => t.includes(w));
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  return "neutral";
}

async function fetchMentions(platform, keyword) {
  let mentions;

  if (platform === "youtube") {
    const items = await searchYouTube({
      apiKey: youtubeApiKey,
      keyword,
      region: REGION,
      language: LANGUAGE,
      maxResults: MAX_RESULTS_PER_CALL,
    });
    const videoIds = items.map((item) => item.id?.videoId).filter(Boolean);
    const statsByVideoId = await fetchVideoStatistics({ apiKey: youtubeApiKey, videoIds });
    mentions = items.map((item) => normalizeYouTubeResult({ keyword, item, statsByVideoId }));
  } else {
    const items = await searchAnysite({
      apiKey: anysiteApiKey,
      platform,
      keyword,
      language: LANGUAGE,
      maxResults: MAX_RESULTS_PER_CALL,
    });
    mentions = items.map((item) => normalizeAnysiteResult({ platform, keyword, item }));

    // reddit/instagram/linkedin non hanno un filtro lingua nativo noto: scarta
    // qui i risultati che non sembrano italiani (vedi looksItalian).
    if (ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS.includes(platform)) {
      mentions = mentions.filter((m) => looksItalian(m.content));
    }
  }

  return mentions
    .filter((m) => containsKeyword(m.content, keyword))
    .map((m) => ({ ...m, sentiment: classifySentiment(m.content) }));
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
    console.log(
      `  [${r.platform}] "${r.keyword}": ${r.found} trovate → ${r.inserted} sincronizzate`,
    );
  }
}
console.log(`\nTotale mention sincronizzate (nuove o aggiornate): ${totalInserted}`);
