// "Trend Virali": due fonti indipendenti di topic "attuali" per l'Italia,
// registrate nel ciclo di vita di monitoraggio (monitored_topics). La
// conversione hashtag->keyword serve solo per l'etichetta leggibile del topic:
//
//  1. hashtag TikTok in trend (già sincronizzati dalla pipeline
//     tiktok-hashtag), convertiti in keyword tramite un LLM gratuito su
//     Groq/OpenRouter (scripts/lib/openrouter.mjs) — con fallback automatico
//     alla segmentazione offline a dizionario inglese+italiano
//     (scripts/lib/word-segment.mjs) se nessuna delle due chiavi è
//     configurata o la chiamata fallisce.
//  2. ricerche in tendenza Google Trends per l'Italia (scripts/lib/google-trends.mjs)
//     — indipendente dal workflow hashtag TikTok, già in linguaggio naturale
//     (nessuna conversione hashtag->keyword necessaria). Fonte non ufficiale:
//     se fallisce si prosegue comunque solo con TikTok (vedi
//     fetchGoogleTrendsKeywords).
//
// Questo script NON cerca più contenuti a pagamento (anysite rimosso): il suo
// compito è la DISCOVERY dei topic e la registrazione nel ciclo di vita di
// monitoraggio (monitored_topics). I contenuti Instagram arrivano interamente
// dallo scraping gratuito della pagina hashtag
// (discover-instagram-hashtag-content.mjs), non più da una ricerca per
// keyword. Restano qui solo i video TikTok reali già raccolti dalla pipeline
// tiktok-hashtag per lo stesso hashtag (endpoint tiktok-hashtag-posts) — con
// le views se estratte durante lo scraping, senza engagement (non disponibile
// per quella fonte, vedi fetchTikTokContent). La conversione hashtag->keyword
// resta per l'etichetta leggibile del topic (derived_keyword), non è più sul
// percorso critico della ricerca contenuti.
//
// Variabili d'ambiente:
//   GROQ_API_KEY            opzionale — provato per primo (free tier più ampio), se assente si passa a OpenRouter
//   OPENROUTER_API_KEY      opzionale — se entrambe assenti si usa solo il fallback offline
//   OPENROUTER_MODEL        override manuale, comma-separated — bypassa la discovery dinamica dei modelli OpenRouter
//   MAX_HASHTAGS            default: 100 — quanti hashtag TikTok in trend monitorare per run (per rank)
//   MAX_TRENDS              default: 50 — quante ricerche Google Trends IT monitorare (per data più recente)
//   MAX_TIKTOK_POSTS        default: 10 — max video TikTok già raccolti da aggiungere per hashtag
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//
// Eseguito da .github/workflows/sync-viral-trends.yml su schedule.

import { hashtagToKeyword, keywordToHashtag } from "./lib/word-segment.mjs";
import { convertHashtagsToKeywords } from "./lib/openrouter.mjs";
import { fetchGoogleTrendsIT } from "./lib/google-trends.mjs";
import { sleep } from "./lib/social-search.mjs";

const TOP_HASHTAGS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/top-tiktok-hashtags";
const TIKTOK_HASHTAG_POSTS_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/tiktok-hashtag-posts";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";
const MONITOR_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/monitor-topics";

const MAX_HASHTAGS = parseInt(process.env.MAX_HASHTAGS ?? "100", 10);
const MAX_TRENDS = parseInt(process.env.MAX_TRENDS ?? "50", 10);
const MAX_TIKTOK_POSTS = parseInt(process.env.MAX_TIKTOK_POSTS ?? "10", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openrouterModel = process.env.OPENROUTER_MODEL;
const groqApiKey = process.env.GROQ_API_KEY;
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
  if (!groqApiKey && !openrouterApiKey) {
    console.log("Né GROQ_API_KEY né OPENROUTER_API_KEY configurate, uso la segmentazione offline.");
    return hashtagsToKeywordsOffline(hashtags);
  }

  try {
    return await convertHashtagsToKeywords(hashtags, {
      apiKey: openrouterApiKey,
      groqApiKey,
      model: openrouterModel,
    });
  } catch (err) {
    console.error(`Groq/OpenRouter falliti, ripiego sulla segmentazione offline: ${String(err)}`);
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
    // Ordina per data di tendenza più recente prima (pubDateMs), poi prende
    // le prime MAX_TRENDS — quelli senza data nota (pubDateMs null) vanno in
    // fondo. Il feed RSS è già grossomodo in quest'ordine, ma non è garantito.
    const ordered = [...trends].sort(
      (a, b) => (b.pubDateMs ?? -Infinity) - (a.pubDateMs ?? -Infinity),
    );
    return ordered.slice(0, MAX_TRENDS).map((t) => ({ hashtag: t.title, keyword: t.title }));
  } catch (err) {
    console.error(`Google Trends fallito, proseguo solo con gli hashtag TikTok: ${String(err)}`);
    return [];
  }
}

// Registra i topic in classifica di entrambe le fonti in monitored_topics
// (vedi src/routes/api/public/hooks/monitor-topics.ts): ogni run "rinnova"
// il monitoraggio dei topic ancora in classifica (last_seen_in_top5_at +
// monitoring_stops_at aggiornati), quelli usciti dalla classifica smettono di
// essere rinnovati e scadono da soli dopo 24h. Best-effort: se l'endpoint
// fallisce, il resto della pipeline deve continuare comunque (i contenuti
// verranno sincronizzati senza topic_id, recuperabile al prossimo run).
async function registerMonitoredTopics(tiktokMappings, trendsMappings) {
  const topics = [
    ...tiktokMappings.map((m) => ({
      topicType: "tiktok-hashtag",
      value: m.hashtag,
      derivedKeyword: m.keyword,
    })),
    ...trendsMappings.map((m) => ({
      topicType: "google-trends",
      value: m.keyword,
      derivedHashtag: keywordToHashtag(m.keyword),
    })),
  ];
  if (topics.length === 0) return new Map();

  try {
    const res = await fetch(MONITOR_TOPICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics }),
    });
    if (!res.ok) throw new Error(`monitor-topics failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`monitor-topics error: ${data.error}`);

    console.log(`Topic registrati per il monitoraggio: ${data.topics?.length ?? 0}`);
    return new Map((data.topics ?? []).map((t) => [`${t.topicType}:${t.value}`, t.id]));
  } catch (err) {
    console.error(
      `Registrazione monitored_topics fallita, proseguo senza topic_id: ${String(err)}`,
    );
    return new Map();
  }
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
        // Nessun is_viral qui: la regola di viralità (Fase 7, vedi
        // computePostVirality in src/lib/virality.ts) è basata su
        // engagement, sempre 0 per TikTok — sync-viral-trends.ts la
        // ricalcola comunque per ogni contenuto, un valore qui verrebbe
        // sovrascritto subito.
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

// Registra TUTTI i topic in classifica di entrambe le fonti nel ciclo di vita di
// monitoraggio (monitored_topics), prima del dedup qui sotto: il dedup
// serve solo a evitare una ricerca doppia su Instagram, non deve escludere
// un topic dal monitoraggio.
const topicIds = await registerMonitoredTopics(tiktokMappings, trendsMappings);

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

console.log(
  "Contenuti: solo video TikTok riusati (Instagram via discover-instagram-hashtag-content)",
);

let totalInserted = 0;
const summary = [];

async function syncSource(hashtag, keyword, platform, discoverySource, topicId, fetchFn) {
  const startedAt = new Date().toISOString();
  console.log(`\n[${platform}/${discoverySource}] #${hashtag} -> "${keyword}"`);
  try {
    const contents = await fetchFn();
    console.log(`  Trovati ${contents.length} contenuti`);

    const result = await sendToHook(
      contents.map((c) => ({
        ...c,
        source_hashtag: hashtag,
        discovery_source: discoverySource,
        topic_id: topicId ?? null,
      })),
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

// Il contenuto Instagram NON viene più cercato qui via anysite (rimosso):
// arriva dallo scraping gratuito della pagina hashtag
// (discover-instagram-hashtag-content.mjs). Qui restano solo i video TikTok
// reali già raccolti dalla pipeline tiktok-hashtag per lo stesso hashtag —
// esistono solo per un hashtag TikTok esatto, non per un topic Google Trends.
for (const { hashtag, keyword, discoverySource } of mappings) {
  if (discoverySource !== "tiktok-hashtag") continue;
  const topicId = topicIds.get(`${discoverySource}:${hashtag}`);
  await syncSource(hashtag, keyword, "tiktok", discoverySource, topicId, () =>
    fetchTikTokContent(hashtag, keyword),
  );
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
