// Trend Virali — Fase "Dai Canali Inspo": due cose distinte in un solo script.
//
// 1. Viralità dei singoli post: i post Instagram già scoperti per i Canali
//    Inspo (raccolti da RSS-Bridge in trends.json, vedi sync-canali-feed.mjs)
//    non hanno mai engagement (RSS-Bridge non lo fornisce) — qui si recupera
//    like/commenti con la stessa tecnica gratuita già in uso per Trend Virali
//    (fetchMetricsDetailed, nessun login) e si sincronizzano in
//    viral_trend_content con discovery_source='canali-inspo', riusando
//    l'endpoint e le regole di viralità già esistenti (computePostVirality,
//    applicato lato server da sync-viral-trends.ts) — nessuna logica nuova,
//    solo una nuova fonte di post da dare in pasto alla pipeline esistente.
//
// 2. Trend cross-profilo: se 3+ profili DIVERSI pubblicano nello stesso
//    periodo un post sullo stesso argomento specifico, quell'argomento è "in
//    trend" nei Canali Inspo. Rilevato con un'UNICA chiamata OpenRouter che
//    raggruppa tutte le didascalie del giro (clusterCaptionsByTopic in
//    openrouter.mjs) — cruciale farlo in un'unica chiamata, non una per
//    didascalia, altrimenti due post sullo stesso argomento rischiano
//    etichette leggermente diverse che non si aggancerebbero mai. Due
//    controlli aggiuntivi lato codice (non fidarsi del solo LLM):
//      - il cluster deve contenere post di almeno MIN_CROSS_PROFILE_CHANNELS
//        canali DIVERSI (non lo stesso canale contato più volte)
//      - le didascalie del cluster devono essere davvero simili tra loro
//        (textSimilarity media >= MIN_CLUSTER_SIMILARITY) — scarta i casi in
//        cui il modello ha raggruppato sotto un'etichetta troppo generica
//
// Eseguito da .github/workflows/discover-canali-inspo-content.yml su schedule.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";
import { looksItalian } from "./lib/social-search.mjs";
import { textSimilarity } from "./lib/text-similarity.mjs";
import { clusterCaptionsByTopic } from "./lib/openrouter.mjs";
import { computeAudioFingerprint } from "./lib/audio-fingerprint.mjs";

const TRENDS_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/trends.json";
const SYNC_CONTENT_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-viral-trends";

const RECENCY_WINDOW_DAYS = parseInt(process.env.RECENCY_WINDOW_DAYS ?? "7", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);
const MIN_CROSS_PROFILE_CHANNELS = parseInt(process.env.MIN_CROSS_PROFILE_CHANNELS ?? "3", 10);
// Soglia di similarità testuale media nel cluster, sotto la quale si scarta
// l'etichetta proposta da OpenRouter perché troppo generica (verifica
// incrociata, non ci si fida del solo LLM) — tarata bassa perché didascalie
// sullo stesso evento reale spesso condividono solo poche parole chiave, non
// intere frasi.
const MIN_CLUSTER_SIMILARITY = parseFloat(process.env.MIN_CLUSTER_SIMILARITY ?? "0.12");

// Rilevamento "audio in trend" via fingerprint acustico (vedi
// lib/audio-fingerprint.mjs) — completa il match esatto su audio_url già
// fatto da sync-audio-trends.ts, per i casi in cui lo stesso audio è stato
// ricaricato con un URL diverso (audio "originale" ripubblicato). Calcolato
// QUI, inline, mentre l'URL del video CDN è ancora fresco (scade in fretta,
// non si può rimandare a un run successivo) — non su ogni Reel: scaricare
// un video intero è molto più pesante di una richiesta HTML, nella stessa
// sessione che già oggi può finire in login-wall dopo troppe richieste
// consecutive. MAX_FINGERPRINTS_PER_RUN tiene il costo aggiuntivo per giro
// limitato e prevedibile; nessuna preferenza per "audio isolati" (che
// ridurrebbe gli sprechi ma richiederebbe un'altra query prima di ogni
// tentativo): il tetto per-run basta da solo a limitare il rischio.
const MAX_FINGERPRINTS_PER_RUN = parseInt(process.env.MAX_FINGERPRINTS_PER_RUN ?? "20", 10);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || undefined;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POST_URL_RE = /\/(p|reel|reels|video|photo|watch|tv)\//i;

function isWithinRecencyWindow(dateStr) {
  if (!dateStr) return null;
  const ageMs = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ageMs)) return null;
  return ageMs >= 0 && ageMs <= RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function extractExternalId(url) {
  return url.match(/\/(?:p|reel)\/([^/?]+)/)?.[1] ?? null;
}

async function fetchCanaliInspo() {
  const res = await fetch(TRENDS_JSON_URL);
  if (!res.ok) throw new Error(`Lettura trends.json fallita: ${res.status}`);
  const data = await res.json();
  return data.canali_inspo ?? [];
}

// Un candidato per canale: solo URL Instagram dalla forma "post" (non il
// link al profilo, che sta nello stesso array accounts — vedi POST_URL_RE,
// stessa regex già usata in canali-inspo.$id.tsx per lo stesso scopo).
function buildCandidates(canali) {
  const candidates = [];
  for (const canale of canali) {
    for (const account of canale.accounts ?? []) {
      if (account.platform !== "instagram") continue;
      if (!POST_URL_RE.test(account.url)) continue;
      const externalId = extractExternalId(account.url);
      if (!externalId) continue;
      candidates.push({
        channelId: canale.id,
        channelName: canale.name,
        url: account.url,
        externalId,
        jsonCaption: account.caption ?? null,
        jsonDate: account.date ?? null,
      });
    }
  }
  // Dedup per URL: lo stesso post non deve comparire due volte se presente
  // più volte nell'array (può succedere per come RSS-Bridge accumula i dati).
  return [...new Map(candidates.map((c) => [c.url, c])).values()];
}

async function syncContents(contents) {
  if (contents.length === 0) return { inserted: 0 };
  const res = await fetch(SYNC_CONTENT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      run: {
        platform: "instagram",
        discovery_source: "canali-inspo",
        requests_used: 0,
        content_found: contents.length,
        status: "ok",
      },
    }),
  });
  if (!res.ok) throw new Error(`sync-viral-trends failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Media delle similarità a coppie tra le didascalie del cluster — verifica
// incrociata indipendente dal giudizio del modello (vedi commento in testa
// al file).
function averagePairwiseSimilarity(captions) {
  if (captions.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < captions.length; i++) {
    for (let j = i + 1; j < captions.length; j++) {
      sum += textSimilarity(captions[i], captions[j]);
      pairs++;
    }
  }
  return pairs > 0 ? sum / pairs : 0;
}

// --- Main ---
console.log("=== TRENDZN — Discovery Canali Inspo (viralità + trend cross-profilo) ===");

const canali = await fetchCanaliInspo();
console.log(`Canali Inspo: ${canali.length}`);

const allCandidates = buildCandidates(canali);
console.log(`Post Instagram candidati: ${allCandidates.length}`);

const preFiltered = allCandidates.filter((c) => isWithinRecencyWindow(c.jsonDate) !== false);
console.log(
  `Dopo pre-filtro data (da trends.json, quando nota): ${preFiltered.length} (esclusi ${allCandidates.length - preFiltered.length} chiaramente vecchi, senza nemmeno provare a fare fetch)`,
);

const session = await openInstagramMetricsSession();
const accepted = [];
let unreachable = 0;
let skippedOld = 0;
let skippedNotItalian = 0;
let fingerprintsComputed = 0;
let fingerprintsFailed = 0;

try {
  for (const candidate of preFiltered) {
    const page = await session.context.newPage();
    let metrics = null;
    let reason = null;
    try {
      ({ metrics, reason } = await session.fetchMetricsDetailed(candidate.url));
    } finally {
      await page.close();
    }
    await sleep(DELAY_MS);

    if (!metrics) {
      unreachable++;
      if (reason) console.log(`  [${candidate.channelName}] non raggiungibile (${reason})`);
      continue;
    }

    const publishedAt = metrics.publishedAt ?? candidate.jsonDate;
    if (isWithinRecencyWindow(publishedAt) === false) {
      skippedOld++;
      continue;
    }

    const caption = metrics.caption || candidate.jsonCaption || "";
    if (!looksItalian(caption)) {
      skippedNotItalian++;
      continue;
    }

    let audioFingerprint = null;
    if (metrics.audioUrl && metrics.videoUrl && fingerprintsComputed < MAX_FINGERPRINTS_PER_RUN) {
      try {
        audioFingerprint = await computeAudioFingerprint(metrics.videoUrl);
        fingerprintsComputed++;
        console.log(
          `  [${candidate.channelName}] fingerprint audio calcolato (${audioFingerprint.length} frame)`,
        );
      } catch (err) {
        fingerprintsFailed++;
        console.log(`  [${candidate.channelName}] fingerprint audio fallito (non bloccante): ${String(err)}`);
      }
    }

    accepted.push({
      channelId: candidate.channelId,
      channelName: candidate.channelName,
      url: candidate.url,
      externalId: candidate.externalId,
      caption,
      publishedAt,
      likes: metrics.likes,
      comments: metrics.comments,
      audioName: metrics.audioName,
      audioUrl: metrics.audioUrl,
      audioFingerprint,
    });
  }
} finally {
  await session.close();
}

console.log(
  `\nAccettati: ${accepted.length}/${preFiltered.length} (${unreachable} non raggiungibili, ${skippedOld} fuori finestra ${RECENCY_WINDOW_DAYS}gg, ${skippedNotItalian} non italiani) — fingerprint audio: ${fingerprintsComputed} calcolati, ${fingerprintsFailed} falliti`,
);

if (accepted.length === 0) {
  console.log("Nulla da sincronizzare.");
  process.exit(0);
}

// --- Trend cross-profilo ---
const crossProfileByUrl = new Map();
if (!GROQ_API_KEY && !OPENROUTER_API_KEY) {
  console.log("\nNé GROQ_API_KEY né OPENROUTER_API_KEY configurate: salto il rilevamento trend cross-profilo.");
} else {
  try {
    const clusters = await clusterCaptionsByTopic(
      accepted.map((a) => a.caption),
      {
        apiKey: OPENROUTER_API_KEY,
        groqApiKey: GROQ_API_KEY,
        ...(OPENROUTER_MODEL ? { model: OPENROUTER_MODEL } : {}),
      },
    );
    console.log(`\nCluster proposti dall'LLM: ${clusters.length}`);

    for (const cluster of clusters) {
      const posts = cluster.indices.map((i) => accepted[i]);
      const distinctChannels = new Set(posts.map((p) => p.channelId));
      const similarity = averagePairwiseSimilarity(posts.map((p) => p.caption));

      const enoughChannels = distinctChannels.size >= MIN_CROSS_PROFILE_CHANNELS;
      const enoughSimilarity = similarity >= MIN_CLUSTER_SIMILARITY;
      console.log(
        `  "${cluster.topic}": ${posts.length} post, ${distinctChannels.size} canali distinti, similarità media ${similarity.toFixed(2)} -> ${
          enoughChannels && enoughSimilarity ? "PROMOSSO a trend" : "scartato"
        }${!enoughChannels ? " (< " + MIN_CROSS_PROFILE_CHANNELS + " canali distinti)" : ""}${!enoughSimilarity ? " (similarità troppo bassa, probabile etichetta generica)" : ""}`,
      );

      if (enoughChannels && enoughSimilarity) {
        for (const post of posts) {
          crossProfileByUrl.set(post.url, {
            topic: cluster.topic,
            channelCount: distinctChannels.size,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Rilevamento trend cross-profilo fallito (non bloccante): ${String(err)}`);
  }
}

// --- Sync ---
const contents = accepted.map((a) => {
  const crossProfile = crossProfileByUrl.get(a.url);
  return {
    platform: "instagram",
    external_id: a.externalId,
    url: a.url,
    author: a.channelName,
    content: a.caption,
    published_at: a.publishedAt,
    source_hashtag: a.channelName,
    keyword_matched: crossProfile?.topic ?? a.channelName,
    discovery_source: "canali-inspo",
    engagement: a.likes + a.comments,
    reach: null,
    audio_name: a.audioName ?? null,
    audio_url: a.audioUrl ?? null,
    audio_fingerprint: a.audioFingerprint ?? null,
    ...(crossProfile
      ? {
          cross_profile_topic: crossProfile.topic,
          cross_profile_channel_count: crossProfile.channelCount,
        }
      : {}),
  };
});

const result = await syncContents(contents);
console.log(`\nSincronizzati: ${result.inserted ?? 0}/${contents.length}`);
console.log(`Post con trend cross-profilo: ${crossProfileByUrl.size}`);

console.log("\n=== Fine ===");
