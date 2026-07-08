// "Trend Virali": prende gli hashtag TikTok in trend (già sincronizzati
// dalla pipeline tiktok-hashtag), li converte in keyword di ricerca
// leggibili tramite Claude (es. "#empirestatebuilding" -> "Empire State
// Building"), poi cerca quella keyword su YouTube + anysite (Twitter/
// Reddit/Instagram/LinkedIn) — stessa logica di ricerca/normalizzazione di
// sync-brand-mentions.mjs (vedi scripts/lib/social-search.mjs) — e
// sincronizza i contenuti trovati, con views/engagement reali, verso
// viral_trend_content.
//
// Variabili d'ambiente:
//   ANTHROPIC_API_KEY       richiesta, per la conversione hashtag -> keyword
//   YOUTUBE_API_KEY         richiesta se "youtube" è tra le PLATFORMS
//   ANYSITE_API_KEY         richiesta se una piattaforma anysite è tra le PLATFORMS
//   PLATFORMS               csv, default: "youtube,twitter,reddit,instagram,linkedin"
//   MAX_HASHTAGS            default: 5 — quanti hashtag TikTok in trend processare per run
//                            (ogni hashtag genera una ricerca per piattaforma: tenerlo
//                            basso limita il consumo di credit anysite)
//   MAX_RESULTS_PER_CALL    default: 25 (ogni risultato consuma quota/credit)
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//   LANGUAGE                default: "it"
//   REGION                  default: "IT"
//
// Eseguito da .github/workflows/sync-viral-trends.yml su schedule.

import Anthropic from "@anthropic-ai/sdk";
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

const TOP_HASHTAGS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/top-tiktok-hashtags";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";

const MAX_HASHTAGS = parseInt(process.env.MAX_HASHTAGS ?? "5", 10);
const PLATFORMS_TO_RUN = (process.env.PLATFORMS ?? "youtube,twitter,reddit,instagram,linkedin")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const MAX_RESULTS_PER_CALL = parseInt(process.env.MAX_RESULTS_PER_CALL ?? "25", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);
const LANGUAGE = process.env.LANGUAGE ?? "it";
const REGION = process.env.REGION ?? "IT";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
  console.error("Manca ANTHROPIC_API_KEY nell'ambiente.");
  process.exit(1);
}

const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (PLATFORMS_TO_RUN.includes("youtube") && !youtubeApiKey) {
  console.error("Manca YOUTUBE_API_KEY nell'ambiente (richiesta da PLATFORMS include youtube).");
  process.exit(1);
}

const anysiteApiKey = process.env.ANYSITE_API_KEY;
const ANYSITE_PLATFORMS = ["twitter", "reddit", "instagram", "linkedin"];
if (PLATFORMS_TO_RUN.some((p) => ANYSITE_PLATFORMS.includes(p)) && !anysiteApiKey) {
  console.error("Manca ANYSITE_API_KEY nell'ambiente (richiesta da PLATFORMS anysite).");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: anthropicApiKey });

async function fetchTopHashtags() {
  const res = await fetch(`${TOP_HASHTAGS_ENDPOINT}?limit=${MAX_HASHTAGS}`);
  if (!res.ok) {
    throw new Error(`top-tiktok-hashtags failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`top-tiktok-hashtags error: ${data.error}`);
  return data.hashtags ?? [];
}

// Converte ogni hashtag TikTok in una keyword/frase di ricerca leggibile
// (es. "#empirestatebuilding" -> "Empire State Building"), in un'unica
// chiamata batch invece di una per hashtag.
async function hashtagsToKeywords(hashtags) {
  if (hashtags.length === 0) return [];

  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system:
      "Converti hashtag TikTok in keyword di ricerca leggibili in linguaggio naturale, " +
      "utili per cercare lo stesso argomento su Twitter/Reddit/Instagram/LinkedIn/YouTube. " +
      'Esempio: "#empirestatebuilding" -> "Empire State Building". Mantieni acronimi noti ' +
      "invariati. Rispondi SOLO con un array JSON di oggetti {hashtag, keyword}, senza altro testo.",
    messages: [{ role: "user", content: JSON.stringify(hashtags) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Risposta Claude senza contenuto testuale.");

  const jsonText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Risposta Claude non è un array JSON.");
  return parsed.filter((p) => p && p.hashtag && p.keyword);
}

async function fetchContent(platform, keyword) {
  let items;

  if (platform === "youtube") {
    const results = await searchYouTube({
      apiKey: youtubeApiKey,
      keyword,
      region: REGION,
      language: LANGUAGE,
      maxResults: MAX_RESULTS_PER_CALL,
    });
    const videoIds = results.map((item) => item.id?.videoId).filter(Boolean);
    const statsByVideoId = await fetchVideoStatistics({ apiKey: youtubeApiKey, videoIds });
    items = results.map((item) => normalizeYouTubeResult({ keyword, item, statsByVideoId }));
  } else {
    const results = await searchAnysite({
      apiKey: anysiteApiKey,
      platform,
      keyword,
      language: LANGUAGE,
      maxResults: MAX_RESULTS_PER_CALL,
    });
    items = results.map((item) => normalizeAnysiteResult({ platform, keyword, item }));

    if (ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS.includes(platform)) {
      items = items.filter((m) => looksItalian(m.content));
    }
  }

  return items.filter((m) => containsKeyword(m.content, keyword));
}

async function sendToHook(contents, run) {
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, run }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync endpoint failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — Trend Virali ===");

const hashtags = await fetchTopHashtags();
console.log(`Hashtag TikTok in trend (top ${MAX_HASHTAGS}): ${hashtags.join(", ") || "(nessuno)"}`);

if (hashtags.length === 0) {
  console.log("Nessun hashtag disponibile, nulla da fare.");
  process.exit(0);
}

const mappings = await hashtagsToKeywords(hashtags);
console.log("Conversione hashtag -> keyword:");
for (const m of mappings) console.log(`  #${m.hashtag} -> "${m.keyword}"`);

console.log(`Piattaforme: ${PLATFORMS_TO_RUN.join(", ")}`);

let totalInserted = 0;
const summary = [];

for (const { hashtag, keyword } of mappings) {
  for (const platform of PLATFORMS_TO_RUN) {
    const startedAt = new Date().toISOString();
    console.log(`\n[${platform}] #${hashtag} -> "${keyword}"`);
    try {
      const contents = await fetchContent(platform, keyword);
      console.log(`  Trovati ${contents.length} contenuti`);

      const result = await sendToHook(
        contents.map((c) => ({ ...c, source_hashtag: hashtag })),
        {
          source_hashtag: hashtag,
          keyword_matched: keyword,
          platform,
          requests_used: 1,
          content_found: contents.length,
          status: "ok",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
        },
      );
      totalInserted += result.inserted ?? 0;
      summary.push({
        hashtag,
        keyword,
        platform,
        found: contents.length,
        inserted: result.inserted ?? 0,
      });
      console.log(`  Sincronizzati (nuovi o aggiornati): ${result.inserted ?? 0}`);
    } catch (err) {
      console.error(`  ERRORE: ${String(err)}`);
      summary.push({ hashtag, keyword, platform, error: String(err) });
      await sendToHook([], {
        source_hashtag: hashtag,
        keyword_matched: keyword,
        platform,
        requests_used: 1,
        content_found: 0,
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
    console.log(`  [${r.platform}] #${r.hashtag} -> "${r.keyword}": ERRORE — ${r.error}`);
  } else {
    console.log(
      `  [${r.platform}] #${r.hashtag} -> "${r.keyword}": ${r.found} trovati -> ${r.inserted} sincronizzati`,
    );
  }
}
console.log(`\nTotale contenuti sincronizzati (nuovi o aggiornati): ${totalInserted}`);
