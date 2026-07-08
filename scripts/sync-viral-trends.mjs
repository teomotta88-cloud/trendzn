// "Trend Virali": prende gli hashtag TikTok in trend (già sincronizzati
// dalla pipeline tiktok-hashtag), li converte in keyword di ricerca
// leggibili separando le parole attaccate (es. "#empirestatebuilding" ->
// "Empire State Building") tramite segmentazione offline a dizionario
// inglese+italiano (nessuna chiamata LLM/API — vedi scripts/lib/word-segment.mjs),
// poi cerca quella keyword su Instagram (anysite) — stessa logica di
// ricerca/normalizzazione di sync-brand-mentions.mjs (vedi
// scripts/lib/social-search.mjs) — e sincronizza i contenuti trovati, con
// views/engagement reali, verso viral_trend_content.
//
// Il feed "Trend Virali" deve contenere solo Instagram e TikTok: anysite non
// supporta la ricerca TikTok per keyword, quindi per ogni hashtag vengono
// aggiunti anche i video TikTok reali già raccolti dalla pipeline
// tiktok-hashtag per quello stesso hashtag (endpoint tiktok-hashtag-posts) —
// senza però nessuna metrica di engagement/views, non disponibile per quella
// fonte (vedi fetchTikTokContent).
//
// Variabili d'ambiente:
//   ANYSITE_API_KEY         richiesta (usata per la ricerca Instagram)
//   MAX_HASHTAGS            default: 5 — quanti hashtag TikTok in trend processare per run
//                            (ogni hashtag genera una ricerca per piattaforma: tenerlo
//                            basso limita il consumo di credit anysite)
//   MAX_RESULTS_PER_CALL    default: 25 (ogni risultato consuma quota/credit)
//   MAX_TIKTOK_POSTS        default: 10 — max video TikTok già raccolti da aggiungere per hashtag
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//   LANGUAGE                default: "it"
//
// Eseguito da .github/workflows/sync-viral-trends.yml su schedule.

import { hashtagToKeyword } from "./lib/word-segment.mjs";
import {
  ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS,
  containsKeyword,
  looksItalian,
  normalizeAnysiteResult,
  searchAnysite,
  sleep,
} from "./lib/social-search.mjs";

const TOP_HASHTAGS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/top-tiktok-hashtags";
const TIKTOK_HASHTAG_POSTS_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/tiktok-hashtag-posts";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";

const MAX_HASHTAGS = parseInt(process.env.MAX_HASHTAGS ?? "5", 10);
const MAX_RESULTS_PER_CALL = parseInt(process.env.MAX_RESULTS_PER_CALL ?? "25", 10);
const MAX_TIKTOK_POSTS = parseInt(process.env.MAX_TIKTOK_POSTS ?? "10", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);
const LANGUAGE = process.env.LANGUAGE ?? "it";

const anysiteApiKey = process.env.ANYSITE_API_KEY;
if (!anysiteApiKey) {
  console.error("Manca ANYSITE_API_KEY nell'ambiente (richiesta per la ricerca Instagram).");
  process.exit(1);
}

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
// separando le parole attaccate (es. "empirestatebuilding" -> "Empire State
// Building") tramite segmentazione offline a dizionario inglese+italiano —
// nessuna chiamata LLM/API, nessun costo. Meno preciso di un LLM su nomi
// propri, acronimi, toponimi o parole non presenti nei due dizionari (es.
// "torvergata"), ma sufficiente per costruire una query di ricerca testuale.
function hashtagsToKeywords(hashtags) {
  return hashtags.map((hashtag) => ({ hashtag, keyword: hashtagToKeyword(hashtag) }));
}

async function fetchInstagramContent(keyword) {
  const results = await searchAnysite({
    apiKey: anysiteApiKey,
    platform: "instagram",
    keyword,
    language: LANGUAGE,
    maxResults: MAX_RESULTS_PER_CALL,
  });
  let items = results.map((item) =>
    normalizeAnysiteResult({ platform: "instagram", keyword, item }),
  );

  if (ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS.includes("instagram")) {
    items = items.filter((m) => looksItalian(m.content));
  }

  return items.filter((m) => containsKeyword(m.content, keyword));
}

// Gli ID dei video TikTok sono "snowflake" (stesso schema usato in
// sync-tiktok-hashtag.ts): i 32 bit più significativi codificano il
// timestamp Unix (secondi) di creazione del post.
function extractTikTokId(url) {
  return url.match(/\/video\/(\d+)/)?.[1] ?? null;
}

// Aggiunge al feed i video TikTok reali già raccolti dalla pipeline
// tiktok-hashtag per questo stesso hashtag — anysite non supporta la
// ricerca TikTok, quindi qui non c'è nessuna metrica engagement/views (a
// differenza di normalizeAnysiteResult), solo url e data del post.
async function fetchTikTokContent(hashtag, keyword) {
  const res = await fetch(
    `${TIKTOK_HASHTAG_POSTS_ENDPOINT}?hashtag=${encodeURIComponent(hashtag)}&limit=${MAX_TIKTOK_POSTS}`,
  );
  if (!res.ok) throw new Error(`tiktok-hashtag-posts failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`tiktok-hashtag-posts error: ${data.error}`);

  return (data.posts ?? [])
    .map((post) => {
      const id = extractTikTokId(post.url);
      if (!id) return null;
      return {
        platform: "tiktok",
        external_id: id,
        url: post.url,
        author: null,
        content: null,
        published_at: post.publishedAt ?? null,
        keyword_matched: keyword,
        engagement: 0,
        reach: null,
        is_viral: false,
        raw: null,
      };
    })
    .filter(Boolean);
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

const mappings = hashtagsToKeywords(hashtags);
console.log("Conversione hashtag -> keyword:");
for (const m of mappings) console.log(`  #${m.hashtag} -> "${m.keyword}"`);

console.log("Piattaforme: instagram, tiktok");

let totalInserted = 0;
const summary = [];

async function syncSource(hashtag, keyword, platform, fetchFn) {
  const startedAt = new Date().toISOString();
  console.log(`\n[${platform}] #${hashtag} -> "${keyword}"`);
  try {
    const contents = await fetchFn();
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

for (const { hashtag, keyword } of mappings) {
  await syncSource(hashtag, keyword, "instagram", () => fetchInstagramContent(keyword));
  await syncSource(hashtag, keyword, "tiktok", () => fetchTikTokContent(hashtag, keyword));
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
