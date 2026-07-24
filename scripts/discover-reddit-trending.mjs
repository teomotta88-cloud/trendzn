// Trend Virali: nuova fonte di discovery "reddit-trending" — post in
// crescita (/rising.json) su un elenco curato di subreddit italiani (non
// r/all globale: scelta esplicita per restare in italiano e non introdurre
// un problema di matching cross-lingua nella corroborazione cross-fonte
// (vedi Fase E) — a differenza di TikTok/Google Trends/X, che oggi arrivano
// già come classifiche ufficiali, qui la lista dei subreddit da guardare è
// curata a mano in trends.json (reddit_subreddits), stesso principio già
// usato per canali_inspo.
//
// Reddit dà due cose che le fonti attuali non danno:
// - un endpoint "rising" nativo (subreddit.rising.json): post che stanno
//   guadagnando trazione ORA, non i già-affermati di /top o /hot
// - numeri REALI (score, num_comments), non un campione come la pagina
//   hashtag di Instagram — is_volume_exact=true, stesso trattamento di
//   TikTok Creative Center
//
// Un post rising non è un hashtag: il "topic" è il titolo del post stesso
// (linguaggio naturale, come le keyword Google Trends) — value = titolo
// (troncato), derived_hashtag solo se il titolo è abbastanza corto da avere
// un tasso di successo accettabile sulla pagina hashtag Instagram (stessa
// soglia già usata per Google Trends/X, vedi MAX_DERIVABLE_WORDS).
//
// Cadenza oraria (vedi discover-reddit-trending.yml) — più frequente delle
// altre fonti perché il valore di Reddit qui è l'anticipo: un controllo
// ogni 4h come TikTok vanificherebbe il vantaggio.
//
// AUTENTICAZIONE OAuth (non più l'endpoint pubblico www.reddit.com/*.json):
// dal 2023 Reddit blocca con 403 sistematico le richieste anonime da IP
// datacenter/cloud (incluso GitHub Actions) sugli endpoint .json pubblici,
// indipendentemente da User-Agent o frequenza — verificato: 100% di
// fallimento su ogni singolo run dal primo giorno. oauth.reddit.com con un
// token app-only (client_credentials, nessun account utente richiesto) ha
// un profilo di accesso separato e non è soggetto allo stesso blocco IP.
// Serve creare un'app "script" su https://www.reddit.com/prefs/apps e
// impostare REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET come secret del repo.
//
// Eseguito da .github/workflows/discover-reddit-trending.yml su schedule.

import { keywordToHashtag } from "./lib/word-segment.mjs";

const TRENDS_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/trends.json";
const MONITOR_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/monitor-topics";
const RECORD_VOLUME_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/record-topic-volume";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_USER_AGENT = "trendzn-bot/1.0 (discovery trend virali, uso non commerciale)";

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
  console.error(
    "Mancano REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET nell'ambiente: crea un'app \"script\" su " +
      "https://www.reddit.com/prefs/apps e imposta i due secret nel repo GitHub.",
  );
  process.exit(1);
}

// Fallback se trends.json non ha ancora la chiave reddit_subreddits (es.
// primo deploy prima che qualcuno la popoli manualmente) — piccola lista di
// partenza, pensata per essere estesa a mano come canali_inspo.
const DEFAULT_SUBREDDITS = ["italy", "Italia", "ItalyInformatica"];

const POSTS_PER_SUBREDDIT = parseInt(process.env.POSTS_PER_SUBREDDIT ?? "15", 10);
const DELAY_BETWEEN_SUBREDDITS_MS = parseInt(process.env.DELAY_BETWEEN_SUBREDDITS_MS ?? "2000", 10);

// Sotto questo punteggio un post "rising" è ancora troppo rumore (Reddit
// mostra come rising anche post appena pubblicati con 1-2 upvote) — non
// vogliamo che ogni post nuovo generi un topic monitorato, solo quelli che
// stanno già guadagnando trazione reale.
const MIN_SCORE = parseInt(process.env.MIN_SCORE ?? "5", 10);

// Oltre questa età un post non è più "rising" nel senso che ci interessa
// (anticipo): anche se Reddit lo elenca ancora, non è più un segnale early.
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS ?? "48", 10);

// Stessa soglia già usata per le keyword Google Trends/i trend X multi-parola
// (discover-instagram-hashtag-content.mjs, discover-x-trending.mjs): un
// hashtag derivato oltre le 2 parole ha un tasso di successo troppo basso
// sulla pagina hashtag Instagram.
const MAX_DERIVABLE_WORDS = 2;
const MAX_TITLE_LENGTH = 140;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSubreddits() {
  try {
    const res = await fetch(TRENDS_JSON_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.reddit_subreddits) ? data.reddit_subreddits : null;
    if (list && list.length > 0) return list;
  } catch (err) {
    console.error(`Lettura reddit_subreddits da trends.json fallita, uso il default: ${String(err)}`);
  }
  return DEFAULT_SUBREDDITS;
}

function cleanTitle(title) {
  const collapsed = title.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TITLE_LENGTH ? collapsed.slice(0, MAX_TITLE_LENGTH).trim() : collapsed;
}

// Stessa logica di toTopicFields in discover-x-trending.mjs: un titolo a una
// sola parola è già usabile come hashtag, una frase di 2 parole viene
// concatenata, oltre le 2 non si deriva nulla (resta comunque monitorato per
// la corroborazione cross-fonte, solo non cercato via hashtag Instagram).
function toTopicFields(rawTitle) {
  const value = cleanTitle(rawTitle);
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 1) return { value, derivedHashtag: value ? keywordToHashtag(value) : null };
  if (wordCount > MAX_DERIVABLE_WORDS) return { value, derivedHashtag: null };
  return { value, derivedHashtag: keywordToHashtag(value) };
}

// Token app-only valido ~1h (Reddit lo dichiara in expires_in): ne basta uno
// per l'intero run, richiesto pigramente alla prima subreddit e riusato.
let cachedAccessToken = null;

async function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;

  const basicAuth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OAuth token Reddit fallito: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth token Reddit: risposta senza access_token");
  cachedAccessToken = data.access_token;
  return cachedAccessToken;
}

async function fetchRisingPosts(subreddit) {
  const token = await getAccessToken();
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/rising?limit=${POSTS_PER_SUBREDDIT}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`r/${subreddit}/rising fallito: ${res.status}`);
  const data = await res.json();
  return (data?.data?.children ?? []).map((c) => c.data).filter(Boolean);
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

async function recordSignal(topicId, { score, numComments }) {
  const res = await fetch(RECORD_VOLUME_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicId,
      platform: "reddit",
      // Reddit dà conteggi reali per il post, non un campione: stesso
      // trattamento di is_volume_exact=true di TikTok Creative Center.
      // num_comments come "volume" (quanti stanno partecipando),
      // score come "engagement" (quanto piace/risuona) — mappatura scelta
      // per coerenza con lo schema esistente (volume vs engagement), non
      // perché Reddit li chiami così.
      contentVolume: numComments,
      totalEngagement: score,
      isVolumeExact: true,
    }),
  });
  if (!res.ok) throw new Error(`record-topic-volume fallito (${res.status}): ${await res.text()}`);
}

console.log("=== TRENDZN — Discovery Reddit Trending (subreddit italiani) ===");

const subreddits = await fetchSubreddits();
console.log(`Subreddit monitorati (${subreddits.length}): ${subreddits.join(", ")}`);

let totalRegistered = 0;
let totalSkipped = 0;

for (let i = 0; i < subreddits.length; i++) {
  const subreddit = subreddits[i];
  console.log(`\n[${i + 1}/${subreddits.length}] r/${subreddit}`);

  try {
    const posts = await fetchRisingPosts(subreddit);
    console.log(`  ${posts.length} post rising trovati.`);

    for (const post of posts) {
      const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
      if (post.stickied || (post.score ?? 0) < MIN_SCORE || ageHours > MAX_AGE_HOURS) {
        totalSkipped++;
        continue;
      }

      const { value, derivedHashtag } = toTopicFields(post.title ?? "");
      if (!value) {
        totalSkipped++;
        continue;
      }

      // Velocity dalla creazione del post — utile soprattutto al primo
      // avvistamento, quando non esiste ancora uno snapshot nostro
      // precedente per calcolare un delta (vedi computeTopicGrowth in
      // src/lib/topicGrowth.ts, che richiede due nostri snapshot).
      const velocityPerHour = ageHours > 0.1 ? (post.score ?? 0) / ageHours : post.score ?? 0;

      console.log(
        `    "${value}" — score=${post.score} commenti=${post.num_comments} età=${ageHours.toFixed(1)}h velocity=${velocityPerHour.toFixed(1)}/h hashtag=${derivedHashtag ?? "—"}`,
      );

      try {
        const topicId = await registerTopic({
          topicType: "reddit-trending",
          value,
          derivedHashtag,
          derivedKeyword: null,
          category: `r/${subreddit}`,
        });
        if (!topicId) {
          totalSkipped++;
          continue;
        }
        await recordSignal(topicId, { score: post.score ?? 0, numComments: post.num_comments ?? 0 });
        totalRegistered++;
      } catch (err) {
        console.error(`    Errore registrazione "${value}": ${String(err)}`);
        totalSkipped++;
      }
    }
  } catch (err) {
    console.error(`  Errore r/${subreddit}: ${String(err)}`);
  }

  if (i < subreddits.length - 1) {
    await sleep(DELAY_BETWEEN_SUBREDDITS_MS);
  }
}

console.log(`\n=== Fine === Registrati: ${totalRegistered} · Scartati: ${totalSkipped}`);
