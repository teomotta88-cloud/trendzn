// "Trend Virali": due fonti indipendenti di topic "attuali" per l'Italia,
// entrambe convertite in keyword di ricerca leggibili e cercate su Instagram
// (anysite):
//
//  1. hashtag TikTok in trend (già sincronizzati dalla pipeline
//     tiktok-hashtag), convertiti in keyword tramite un LLM gratuito su
//     OpenRouter (scripts/lib/openrouter.mjs) — con fallback automatico alla
//     segmentazione offline a dizionario inglese+italiano
//     (scripts/lib/word-segment.mjs) se OPENROUTER_API_KEY non è configurata
//     o la chiamata fallisce.
//  2. ricerche in tendenza Google Trends per l'Italia (scripts/lib/google-trends.mjs)
//     — indipendente dal workflow hashtag TikTok, già in linguaggio naturale
//     (nessuna conversione hashtag->keyword necessaria). Fonte non ufficiale:
//     se fallisce si prosegue comunque solo con TikTok (vedi
//     fetchGoogleTrendsKeywords).
//
// Ogni keyword (di entrambe le fonti) viene cercata su Instagram con
// searchAnysite() — stessa logica di ricerca/normalizzazione di
// sync-brand-mentions.mjs (vedi scripts/lib/social-search.mjs) — e i
// contenuti trovati, con views/engagement reali, sincronizzati verso
// viral_trend_content, taggati con discovery_source per sapere quale fonte
// li ha scoperti.
//
// Il feed "Trend Virali" deve contenere solo Instagram e TikTok: anysite non
// supporta la ricerca TikTok per keyword, quindi solo per gli hashtag TikTok
// (fonte 1, non per i topic Google Trends, che non sono hashtag TikTok)
// vengono aggiunti anche i video TikTok reali già raccolti dalla pipeline
// tiktok-hashtag per quello stesso hashtag (endpoint tiktok-hashtag-posts) —
// con le views se estratte durante lo scraping, ma senza engagement, non
// disponibile per quella fonte (vedi fetchTikTokContent).
//
// Variabili d'ambiente:
//   ANYSITE_API_KEY         richiesta (usata per la ricerca Instagram)
//   OPENROUTER_API_KEY      opzionale — se assente si usa solo il fallback offline
//   OPENROUTER_MODEL        default: vedi DEFAULT_MODEL in scripts/lib/openrouter.mjs
//   MAX_HASHTAGS            default: 5 — quanti hashtag TikTok in trend processare per run
//                            (ogni hashtag genera una ricerca per piattaforma: tenerlo
//                            basso limita il consumo di credit anysite)
//   MAX_TRENDS              default: 5 — quante ricerche Google Trends IT processare per run
//   MAX_RESULTS_PER_CALL    default: 30 — confermato con anysite: costa 1 credit ogni 30
//                            risultati, quindi chiederne fino a 30 non costa più di 25
//   MAX_TIKTOK_POSTS        default: 10 — max video TikTok già raccolti da aggiungere per hashtag
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//   LANGUAGE                default: "it"
//
// Eseguito da .github/workflows/sync-viral-trends.yml su schedule.

import { hashtagToKeyword } from "./lib/word-segment.mjs";
import { convertHashtagsToKeywords } from "./lib/openrouter.mjs";
import { fetchGoogleTrendsIT } from "./lib/google-trends.mjs";
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
const MAX_TRENDS = parseInt(process.env.MAX_TRENDS ?? "5", 10);
const MAX_RESULTS_PER_CALL = parseInt(process.env.MAX_RESULTS_PER_CALL ?? "30", 10);
const MAX_TIKTOK_POSTS = parseInt(process.env.MAX_TIKTOK_POSTS ?? "10", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);
const LANGUAGE = process.env.LANGUAGE ?? "it";
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openrouterModel = process.env.OPENROUTER_MODEL;

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

// Fallback offline: separa le parole attaccate a dizionario (inglese +
// italiano), nessuna chiamata di rete, nessun costo. Meno preciso di un LLM
// su nomi propri, acronimi, toponimi non a dizionario (es. "torvergata"),
// ma sempre disponibile.
function hashtagsToKeywordsOffline(hashtags) {
  return hashtags.map((hashtag) => ({ hashtag, keyword: hashtagToKeyword(hashtag) }));
}

// Prova prima OpenRouter (LLM gratuito, gestisce correttamente nomi propri
// e toponimi che un dizionario non può risolvere), poi ripiega sulla
// segmentazione offline se la chiave non è configurata o la chiamata
// fallisce (rate limit, modello ritirato, errore di rete, ecc.) — il resto
// della pipeline deve continuare a funzionare comunque.
async function hashtagsToKeywords(hashtags) {
  if (!openrouterApiKey) {
    console.log("OPENROUTER_API_KEY non configurata, uso la segmentazione offline.");
    return hashtagsToKeywordsOffline(hashtags);
  }

  try {
    return await convertHashtagsToKeywords(hashtags, {
      apiKey: openrouterApiKey,
      model: openrouterModel,
    });
  } catch (err) {
    console.error(`OpenRouter fallito, ripiego sulla segmentazione offline: ${String(err)}`);
    return hashtagsToKeywordsOffline(hashtags);
  }
}

// Fonte 2, indipendente dagli hashtag TikTok: ricerche in tendenza Google
// Trends per l'Italia, già in linguaggio naturale (nessuna conversione
// hashtag->keyword necessaria, a differenza della fonte 1). Endpoint non
// ufficiale: se fallisce (cambio di formato, rate limit, rete) il resto
// della pipeline deve continuare comunque solo con TikTok, non deve mai far
// fallire l'intero run.
async function fetchGoogleTrendsKeywords() {
  try {
    const trends = await fetchGoogleTrendsIT();
    return trends.slice(0, MAX_TRENDS).map((t) => ({ hashtag: t.title, keyword: t.title }));
  } catch (err) {
    console.error(`Google Trends fallito, proseguo solo con gli hashtag TikTok: ${String(err)}`);
    return [];
  }
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
// ricerca TikTok. Le views (quando estratte durante lo scraping, best
// effort — vedi scripts/scrape-tiktok-hashtag.mjs) diventano "reach";
// l'engagement (like/commenti) resta sempre 0, non disponibile per questa
// fonte gratuita.
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
        reach: post.views ?? null,
        is_viral: (post.views ?? 0) > 100_000,
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

const tiktokMappings = hashtags.length
  ? (await hashtagsToKeywords(hashtags)).map((m) => ({ ...m, discoverySource: "tiktok-hashtag" }))
  : [];
console.log("Conversione hashtag -> keyword:");
for (const m of tiktokMappings) console.log(`  #${m.hashtag} -> "${m.keyword}"`);

const trendsMappings = await fetchGoogleTrendsKeywords();
console.log(
  `Google Trends IT (top ${MAX_TRENDS}): ${trendsMappings.map((m) => m.keyword).join(", ") || "(nessuno)"}`,
);

// Se TikTok e Google Trends convergono sullo stesso argomento non ha senso
// cercarlo due volte su Instagram: tiene la keyword TikTok (già passata per
// la conversione hashtag->keyword) e scarta il duplicato da Google Trends.
const seenKeywords = new Set(tiktokMappings.map((m) => m.keyword.toLowerCase()));
const dedupedTrendsMappings = trendsMappings
  .filter((m) => !seenKeywords.has(m.keyword.toLowerCase()))
  .map((m) => ({ ...m, discoverySource: "google-trends" }));

const mappings = [...tiktokMappings, ...dedupedTrendsMappings];

if (mappings.length === 0) {
  console.log("Nessun topic disponibile da nessuna delle due fonti, nulla da fare.");
  process.exit(0);
}

console.log("Piattaforme: instagram, tiktok (solo per topic da hashtag TikTok)");

let totalInserted = 0;
const summary = [];

async function syncSource(hashtag, keyword, platform, discoverySource, fetchFn) {
  const startedAt = new Date().toISOString();
  console.log(`\n[${platform}/${discoverySource}] #${hashtag} -> "${keyword}"`);
  try {
    const contents = await fetchFn();
    console.log(`  Trovati ${contents.length} contenuti`);

    const result = await sendToHook(
      contents.map((c) => ({ ...c, source_hashtag: hashtag, discovery_source: discoverySource })),
      {
        source_hashtag: hashtag,
        keyword_matched: keyword,
        platform,
        discovery_source: discoverySource,
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
      discovery_source: discoverySource,
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

for (const { hashtag, keyword, discoverySource } of mappings) {
  await syncSource(hashtag, keyword, "instagram", discoverySource, () =>
    fetchInstagramContent(keyword),
  );
  // I video TikTok riusati (fonte 1) esistono solo per l'hashtag TikTok
  // esatto raccolto dalla pipeline tiktok-hashtag: un topic Google Trends
  // (fonte 2) non è un hashtag TikTok, quindi non ha video da riusare qui.
  if (discoverySource === "tiktok-hashtag") {
    await syncSource(hashtag, keyword, "tiktok", discoverySource, () =>
      fetchTikTokContent(hashtag, keyword),
    );
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
