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
// Per ogni hashtag provato: naviga la pagina (con scroll, per raccogliere
// più contenuti di quanti ne mostri la prima schermata), estrae i link a
// post/carosello/Reel trovati, e per ciascuno recupera like/commenti e data
// di pubblicazione dalla stessa sessione Playwright (stessa tecnica di
// scripts/lib/instagram-public-metrics.mjs, riusata qui per non aprire un
// secondo browser) — un contenuto scoperto così arriva già con engagement
// reale al primo giro, non deve aspettare il prossimo ciclo di
// recheck-viral-engagement.mjs. Solo i contenuti pubblicati negli ultimi
// RECENCY_WINDOW_DAYS entrano nel monitoraggio (volume ed engagement
// dell'hashtag, vedi sotto) — un post vecchio ma ancora popolare nella
// griglia "popular" non deve contare come segnale di viralità attuale.
//
// Un hashtag "in trend su TikTok Italia" non implica che chi lo usa su
// Instagram scriva in italiano — la pagina hashtag mostra contenuti di
// chiunque, ovunque. Stessa euristica looksItalian() già usata dal percorso
// anysite (sync-viral-trends.mjs) applicata qui alla didascalia estratta
// dalla description (vedi extractCaption in instagram-public-metrics.mjs).
//
// L'engagement totale dei contenuti recenti trovati per un hashtag viene
// sommato e inviato a record-topic-volume.ts, che lo confronta con lo
// snapshot precedente per calcolare il tasso di crescita (Fase 6, vedi
// src/lib/topicGrowth.ts) — stesso meccanismo già usato per i volumi TikTok.
//
// Fallimenti (login wall, nessun risultato, hashtag non popolare) sono
// attesi e gestiti con skip silenzioso, stesso approccio già validato per
// recheck-viral-engagement.mjs — non bloccano il resto del giro.
//
// Variabili d'ambiente:
//   MAX_POSTS_PER_HASHTAG   default: 100 — quanti contenuti recuperare per hashtag
//                           (con scroll: la pagina ne mostra ~12 senza, il resto
//                           richiede caricamento progressivo, non garantito per
//                           ogni hashtag — è un tetto, non una garanzia)
//   RECENCY_WINDOW_DAYS     default: 7 — solo i contenuti pubblicati non oltre
//                           questa finestra entrano nel monitoraggio
//   DELAY_BETWEEN_CALLS_MS  default: 1500
//
// Eseguito da .github/workflows/discover-instagram-hashtag-content.yml su schedule.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";
import { looksItalian } from "./lib/social-search.mjs";

const LIST_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/list-monitored-topics";
const SYNC_CONTENT_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";
const RECORD_VOLUME_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/record-topic-volume";

const MAX_POSTS_PER_HASHTAG = parseInt(process.env.MAX_POSTS_PER_HASHTAG ?? "100", 10);
const RECENCY_WINDOW_DAYS = parseInt(process.env.RECENCY_WINDOW_DAYS ?? "7", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);

// Instagram blocca (redirect login/challenge su ogni pagina-post successiva)
// una sessione Playwright dopo troppe richieste di dettaglio consecutive —
// confermato su un run reale: 0 blocchi nei primi ~500 (10 hashtag), poi
// 100% bloccato dall'11° in poi. SHARD_COUNT/SHARD_INDEX permettono di
// dividere gli hashtag monitorati tra più job del workflow (vedi
// discover-instagram-hashtag-content.yml, matrix), ognuno con il proprio
// runner (quindi IP) e la propria sessione Playwright pulita — dimezzando
// (o dividendo per N) sia il numero di richieste per sessione sia il tempo
// totale del run, invece di farle tutte in una sessione unica.
const SHARD_COUNT = parseInt(process.env.SHARD_COUNT ?? "1", 10);
const SHARD_INDEX = parseInt(process.env.SHARD_INDEX ?? "0", 10);

// Nessun nuovo link da questi scroll consecutivi = pagina esaurita, non ha
// senso continuare a scorrere (né aspettarsi mai di arrivare a MAX_POSTS_PER_HASHTAG
// per hashtag con poco contenuto).
const MAX_STAGNANT_SCROLLS = 3;
const MAX_SCROLL_ROUNDS = 30;

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
  if (topic.topic_type === "x-trending") {
    // Un trend X a una parola (hashtag nativo o nome singolo, es. "Roggero")
    // è già utilizzabile direttamente come hashtag, nessun limite di parole
    // (stesso trattamento di tiktok-hashtag). Per le frasi di più parole vale
    // lo stesso ragionamento di google-trends: solo l'hashtag derivato da al
    // più MAX_GOOGLE_TRENDS_WORDS parole ha un tasso di successo accettabile
    // (vedi discover-x-trending.mjs, che calcola derived_hashtag solo in
    // quel caso).
    const wordCount = topic.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= 1) return topic.value;
    if (wordCount > MAX_GOOGLE_TRENDS_WORDS || !topic.derived_hashtag) return null;
    return topic.derived_hashtag;
  }
  if (topic.topic_type === "reddit-trending") {
    // Stesso trattamento di x-trending: un titolo a una parola è già un
    // hashtag utilizzabile, oltre le 2 parole (la maggioranza dei titoli
    // Reddit) solo l'hashtag derivato ha un tasso di successo accettabile —
    // vedi toTopicFields in discover-reddit-trending.mjs, che calcola
    // derived_hashtag con la stessa regola.
    const wordCount = topic.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= 1) return topic.value;
    if (wordCount > MAX_GOOGLE_TRENDS_WORDS || !topic.derived_hashtag) return null;
    return topic.derived_hashtag;
  }
  if (topic.topic_type === "youtube-trending") {
    // Stesso trattamento di reddit-trending/x-trending — vedi toTopicFields
    // in discover-youtube-trending.mjs.
    const wordCount = topic.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= 1) return topic.value;
    if (wordCount > MAX_GOOGLE_TRENDS_WORDS || !topic.derived_hashtag) return null;
    return topic.derived_hashtag;
  }
  // trending-audio: nessuna discovery ancora implementata (predisposizione, Fase 9).
  return null;
}

function extractExternalId(url) {
  return url.match(/\/(?:p|reel)\/([^/?]+)/)?.[1] ?? null;
}

// null (data sconosciuta) è trattato come "fuori finestra": il punto 2 della
// richiesta è "il monitoraggio è SOLO su quelli [pubblicati negli ultimi 7
// giorni]" — un contenuto di cui non sappiamo la data non può rispettare
// quel vincolo, va escluso piuttosto che incluso per errore.
function isWithinRecencyWindow(publishedAt) {
  if (!publishedAt) return false;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  return ageMs >= 0 && ageMs <= RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// Raccoglie fino a MAX_POSTS_PER_HASHTAG link a post/carosello/Reel dalla
// pagina hashtag, scorrendo finché ne arrivano di nuovi (o finché non si
// esaurisce la pagina, vedi MAX_STAGNANT_SCROLLS) — senza scroll la pagina
// ne mostra solo una dozzina.
async function findPostLinks(page, hashtag) {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch(() => null);
  if (!response) return { ok: false, reason: "nessuna risposta" };

  await page.waitForTimeout(4000);
  if (page.url().includes("/accounts/login")) {
    return { ok: false, reason: "login wall" };
  }

  const collected = new Set();
  let stagnantRounds = 0;

  for (
    let round = 0;
    round < MAX_SCROLL_ROUNDS && collected.size < MAX_POSTS_PER_HASHTAG;
    round++
  ) {
    const links = await page.$$eval("a[href]", (nodes) =>
      nodes
        .map((n) => n.getAttribute("href"))
        .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
    );

    const before = collected.size;
    for (const href of links) {
      collected.add(new URL(href, "https://www.instagram.com").toString().split("?")[0]);
    }

    if (collected.size === before) {
      stagnantRounds++;
      if (stagnantRounds >= MAX_STAGNANT_SCROLLS) break;
    } else {
      stagnantRounds = 0;
    }

    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1500);
  }

  if (collected.size === 0) return { ok: false, reason: "nessun link trovato" };

  return { ok: true, links: [...collected].slice(0, MAX_POSTS_PER_HASHTAG) };
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
        content: c.caption || null,
        published_at: c.publishedAt,
        source_hashtag: hashtag,
        keyword_matched: topic.derived_keyword ?? topic.value,
        discovery_source: topic.topic_type,
        topic_id: topic.id,
        engagement: c.likes + c.comments,
        reach: null,
        audio_name: c.audioName ?? null,
        audio_url: c.audioUrl ?? null,
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

const allAttempts = topics
  .map((topic) => ({ topic, hashtag: hashtagForTopic(topic) }))
  .filter((a) => a.hashtag !== null)
  // Ordine deterministico (l'API non garantisce un ordine stabile tra
  // chiamate separate, una per job): senza questo, due job con
  // SHARD_COUNT=2 potrebbero finire per processare hashtag sovrapposti o
  // saltarne alcuni se l'ordine cambia da una chiamata all'altra.
  .sort((a, b) => a.hashtag.localeCompare(b.hashtag));
console.log(
  `Hashtag da provare: ${allAttempts.length} (esclusi ${topics.length - allAttempts.length}: audio non ancora implementato o keyword Google Trends di più di ${MAX_GOOGLE_TRENDS_WORDS} parole)`,
);

const attempts =
  SHARD_COUNT > 1 ? allAttempts.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX) : allAttempts;
if (SHARD_COUNT > 1) {
  console.log(
    `Shard ${SHARD_INDEX + 1}/${SHARD_COUNT}: ${attempts.length} hashtag assegnati a questo job`,
  );
}

if (attempts.length === 0) {
  console.log("Nulla da provare.");
  process.exit(0);
}

const session = await openInstagramMetricsSession();
let succeeded = 0;
let failed = 0;
let totalContentSynced = 0;
// Conteggio globale dei motivi di fallimento su fetchMetricsDetailed — se
// "login-wall" domina verso la fine del run è un segnale di rate-limiting/
// blocco lato Instagram dopo troppe richieste consecutive dalla stessa
// sessione, non un problema di parsing del singolo post.
const failReasonCounts = {};

try {
  for (const { topic, hashtag } of attempts) {
    console.log(`\n[${topic.topic_type}] #${hashtag}`);
    const page = await session.context.newPage();
    let result;
    try {
      result = await findPostLinks(page, hashtag);
    } finally {
      await page.close();
    }

    if (!result.ok) {
      console.log(`  FALLITO (${result.reason})`);
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`  ${result.links.length} contenuti trovati, recupero engagement e data...`);
    const contents = [];
    let skippedOld = 0;
    let skippedNotItalian = 0;
    const hashtagFailReasons = {};
    for (const url of result.links) {
      const externalId = extractExternalId(url);
      if (!externalId) continue;
      const { metrics, reason } = await session.fetchMetricsDetailed(url);
      if (metrics) {
        if (!isWithinRecencyWindow(metrics.publishedAt)) {
          skippedOld++;
        } else if (!looksItalian(metrics.caption)) {
          skippedNotItalian++;
        } else {
          contents.push({
            url,
            externalId,
            likes: metrics.likes,
            comments: metrics.comments,
            publishedAt: metrics.publishedAt,
            caption: metrics.caption,
            audioName: metrics.audioName,
            audioUrl: metrics.audioUrl,
          });
        }
      } else if (reason) {
        hashtagFailReasons[reason] = (hashtagFailReasons[reason] ?? 0) + 1;
        failReasonCounts[reason] = (failReasonCounts[reason] ?? 0) + 1;
      }
      await sleep(DELAY_MS);
    }
    const unreachable = Object.values(hashtagFailReasons).reduce((a, b) => a + b, 0);
    if (unreachable > 0) {
      const breakdown = Object.entries(hashtagFailReasons)
        .map(([r, n]) => `${r}: ${n}`)
        .join(", ");
      console.log(`  Non raggiungibili: ${unreachable}/${result.links.length} (${breakdown})`);
    }

    // Questi due numeri (calcolati sul solo scrape di questo giro) sono solo
    // un fallback: record-topic-volume.ts, per instagram, ricalcola volume
    // ed engagement dall'aggregato di TUTTO ciò che conosciamo per questo
    // topic in viral_trend_content (accumulato via syncContent qui sopra +
    // tenuto aggiornato da recheck-viral-engagement.mjs) — necessario perché
    // la pagina hashtag non garantisce di mostrare "gli stessi post + quelli
    // nuovi" ad ogni giro, quindi il solo scrape di un run non è una base di
    // confronto stabile nel tempo.
    const totalEngagement = contents.reduce((sum, c) => sum + c.likes + c.comments, 0);
    await recordVolume(topic, contents.length, totalEngagement);

    try {
      const syncResult = await syncContent(topic, hashtag, contents);
      totalContentSynced += syncResult.inserted ?? 0;
      console.log(
        `  Nella finestra di ${RECENCY_WINDOW_DAYS}gg: ${contents.length}/${result.links.length} (${skippedOld} scartati per data vecchia/sconosciuta, ${skippedNotItalian} scartati per lingua non italiana) -> ${syncResult.inserted ?? 0} sincronizzati`,
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
const totalUnreachable = Object.values(failReasonCounts).reduce((a, b) => a + b, 0);
if (totalUnreachable > 0) {
  const breakdown = Object.entries(failReasonCounts)
    .map(([r, n]) => `${r}: ${n}`)
    .join(", ");
  console.log(`Post non raggiungibili nell'intero run: ${totalUnreachable} (${breakdown})`);
}
