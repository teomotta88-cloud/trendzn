// Discovery gratuita di contenuti Instagram via pagina hashtag
// (/explore/tags/<hashtag>/ -> /popular/<hashtag>/, server-rendered, nessun
// login) — complementare alla ricerca a pagamento via anysite
// (sync-viral-trends.mjs), non la sostituisce. Portata in produzione dopo
// aver verificato su un campione di hashtag reali (probe-instagram-hashtag-sample.mjs):
// 8/10 riusciti, con un pattern chiaro — gli hashtag TikTok (già hashtag
// reali) vanno sempre a buon fine, le keyword Google Trends multi-parola
// convertite in hashtag (es. "ryanair finestrino" -> #ryanairfinestrino)
// falliscono più spesso perché non sono hashtag realmente usati da nessuno.
// Per questo le keyword Google Trends di più di 2 parole vengono escluse a
// monte da questa tecnica (restano comunque cercate su Instagram tramite
// anysite, che non ha questo limite).
//
// Per ogni hashtag provato: naviga la pagina, estrae i link a reel reali
// trovati, e per ciascuno recupera anche like/commenti dalla stessa sessione
// Playwright (stessa tecnica di scripts/lib/instagram-public-metrics.mjs,
// riusata qui per non aprire un secondo browser) — un contenuto scoperto
// così arriva già con engagement reale al primo giro, non deve aspettare il
// prossimo ciclo di recheck-viral-engagement.mjs.
//
// Fallimenti (login wall, nessun risultato, hashtag non popolare) sono
// attesi e gestiti con skip silenzioso, stesso approccio già validato per
// recheck-viral-engagement.mjs — non bloccano il resto del giro.
//
// Variabili d'ambiente:
//   MAX_POSTS_PER_HASHTAG   default: 12 — quanti reel ricontrollare per hashtag (la
//                           pagina ne restituisce circa questo numero senza scroll)
//   DELAY_BETWEEN_CALLS_MS  default: 1500
//
// Eseguito da .github/workflows/discover-instagram-hashtag-content.yml su schedule.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";

const LIST_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/list-monitored-topics";
const SYNC_CONTENT_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";
const RECORD_VOLUME_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/record-topic-volume";

const MAX_POSTS_PER_HASHTAG = parseInt(process.env.MAX_POSTS_PER_HASHTAG ?? "12", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);

// Le keyword Google Trends multi-parola concatenate in un hashtag (vedi
// keywordToHashtag) hanno un tasso di successo molto più basso — confermato
// su campione reale, non un'ipotesi. Oltre le 2 parole non vale la pena
// nemmeno provare.
const MAX_GOOGLE_TRENDS_WORDS = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMonitoredTopics() {
  const res = await fetch(LIST_TOPICS_ENDPOINT);
  if (!res.ok) throw new Error(`list-monitored-topics failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`list-monitored-topics error: ${data.error}`);
  return data.topics ?? [];
}

// Seleziona quale hashtag provare per ciascun topic monitorato, o null se
// il topic va escluso da questa tecnica.
function hashtagForTopic(topic) {
  if (topic.topic_type === "tiktok-hashtag") {
    return topic.value;
  }
  if (topic.topic_type === "google-trends") {
    const wordCount = topic.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_GOOGLE_TRENDS_WORDS || !topic.derived_hashtag) return null;
    return topic.derived_hashtag;
  }
  // trending-audio: nessuna discovery ancora implementata (predisposizione, Fase 9).
  return null;
}

function extractExternalId(url) {
  return url.match(/\/(?:p|reel)\/([^/?]+)/)?.[1] ?? null;
}

async function findReelLinks(page, hashtag) {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch(() => null);
  if (!response) return { ok: false, reason: "nessuna risposta" };

  await page.waitForTimeout(4000);
  if (page.url().includes("/accounts/login")) {
    return { ok: false, reason: "login wall" };
  }

  const links = await page.$$eval("a[href]", (nodes) =>
    nodes
      .map((n) => n.getAttribute("href"))
      .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
  );
  const uniqueLinks = [...new Set(links)].map(
    (href) => new URL(href, "https://www.instagram.com").toString().split("?")[0],
  );
  if (uniqueLinks.length === 0) return { ok: false, reason: "nessun link trovato" };

  return { ok: true, links: uniqueLinks.slice(0, MAX_POSTS_PER_HASHTAG) };
}

async function syncContent(topic, hashtag, contents) {
  if (contents.length === 0) return { inserted: 0 };
  const res = await fetch(SYNC_CONTENT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: contents.map((c) => ({
        platform: "instagram",
        external_id: c.externalId,
        url: c.url,
        source_hashtag: hashtag,
        keyword_matched: topic.derived_keyword ?? topic.value,
        discovery_source: topic.topic_type,
        topic_id: topic.id,
        engagement: c.likes + c.comments,
        reach: null,
      })),
      run: {
        source_hashtag: hashtag,
        keyword_matched: topic.derived_keyword ?? topic.value,
        platform: "instagram",
        discovery_source: topic.topic_type,
        requests_used: 0,
        content_found: contents.length,
        status: "ok",
      },
    }),
  });
  if (!res.ok) throw new Error(`sync-viral-trends failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function recordVolume(topic, contentVolume, totalEngagement) {
  await fetch(RECORD_VOLUME_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicId: topic.id,
      platform: "instagram",
      contentVolume,
      isVolumeExact: false,
      totalEngagement,
    }),
  }).catch((err) => console.error(`  record-topic-volume fallito: ${String(err)}`));
}

// --- Main ---
console.log("=== TRENDZN — Discovery gratuita Instagram via pagina hashtag ===");

const topics = await fetchMonitoredTopics();
console.log(`Topic monitorati: ${topics.length}`);

const attempts = topics
  .map((topic) => ({ topic, hashtag: hashtagForTopic(topic) }))
  .filter((a) => a.hashtag !== null);
console.log(
  `Hashtag da provare: ${attempts.length} (esclusi ${topics.length - attempts.length}: audio non ancora implementato o keyword Google Trends di più di ${MAX_GOOGLE_TRENDS_WORDS} parole)`,
);

if (attempts.length === 0) {
  console.log("Nulla da provare.");
  process.exit(0);
}

const session = await openInstagramMetricsSession();
let succeeded = 0;
let failed = 0;
let totalContentSynced = 0;

try {
  for (const { topic, hashtag } of attempts) {
    console.log(`\n[${topic.topic_type}] #${hashtag}`);
    const page = await session.context.newPage();
    let result;
    try {
      result = await findReelLinks(page, hashtag);
    } finally {
      await page.close();
    }

    if (!result.ok) {
      console.log(`  FALLITO (${result.reason})`);
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`  ${result.links.length} reel trovati, recupero engagement...`);
    const contents = [];
    for (const url of result.links) {
      const externalId = extractExternalId(url);
      if (!externalId) continue;
      const metrics = await session.fetchMetrics(url);
      if (metrics) {
        contents.push({ url, externalId, likes: metrics.likes, comments: metrics.comments });
      }
      await sleep(DELAY_MS);
    }

    const totalEngagement = contents.reduce((sum, c) => sum + c.likes + c.comments, 0);
    await recordVolume(topic, result.links.length, totalEngagement);

    try {
      const syncResult = await syncContent(topic, hashtag, contents);
      totalContentSynced += syncResult.inserted ?? 0;
      console.log(
        `  Engagement recuperato per ${contents.length}/${result.links.length}, sincronizzati ${syncResult.inserted ?? 0}`,
      );
      succeeded++;
    } catch (err) {
      console.error(`  Sync fallita: ${String(err)}`);
      failed++;
    }
  }
} finally {
  await session.close();
}

console.log(
  `\n=== Riepilogo: ${succeeded}/${attempts.length} hashtag riusciti, ${failed} falliti, ${totalContentSynced} contenuti sincronizzati ===`,
);
