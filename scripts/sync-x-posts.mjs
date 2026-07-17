// Sync X (Twitter) per ASPI-monitoring: usa un account X dedicato tramite
// rettiwt-api (API key/cookie personale, non l'API ufficiale a pagamento).
// Libreria non ufficiale che modella le risposte GraphQL interne di X:
// fragile per design, si può rompere quando X cambia schema (vedi
// scripts/probe-x-account.mjs, usato per validare/diagnosticare la libreria
// prima di questo sync in produzione).
//
// Gli account X salvati in aspi-monitoring.json arrivano da un import
// generico e sono taggati platform: "web" (non "x"): li riconosciamo
// dall'host dell'URL, come sync-facebook-posts.mjs fa per Facebook.

import { Rettiwt } from "rettiwt-api";

const REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/aspi-monitoring.json";
const MAX_POSTS_PER_CHANNEL = 15;
const TWEETS_PER_ACCOUNT = 10;

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const rettiwtApiKey = process.env.RETTIWT_API_KEY;
if (!rettiwtApiKey) {
  console.error("Manca RETTIWT_API_KEY nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

const rettiwt = new Rettiwt({ apiKey: rettiwtApiKey });

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    headers: ghHeaders,
  });

  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata aspi-monitoring.json fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }

  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${TRENDS_PATH}?t=${Date.now()}`;

  const rawRes = await fetch(rawUrl, {
    headers: {
      "User-Agent": "aspi-monitoring-sync-x",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw aspi-monitoring.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];

  return { store, sha };
}

// Come sync-facebook-posts.mjs: il workflow di sync IG/TikTok scrive sullo
// stesso file; riproviamo su conflitto invece di fallire silenziosamente.
async function writeStore(store) {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: sync X posts [trendzn-bot]",
        content,
        sha,
      }),
    });

    if (res.ok) return;

    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`,
      );
      continue;
    }

    throw new Error(`Scrittura aspi-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }

  throw new Error("Troppi conflitti di scrittura su aspi-monitoring.json.");
}

function isPostUrl(url) {
  return /\/status\/\d+/.test(url);
}

function isXUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^mobile\./, "");
    return host === "x.com" || host === "twitter.com";
  } catch {
    return false;
  }
}

// Path riservati di X che non sono screen name di un account.
const RESERVED_PATHS = new Set([
  "i",
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "intent",
  "hashtag",
  "share",
]);

function extractScreenNameFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0];
    if (!segment || RESERVED_PATHS.has(segment.toLowerCase())) return null;
    return segment;
  } catch {
    return null;
  }
}

// Foto: URL diretto all'immagine. Video/gif: nessuna immagine ferma
// affidabile lato modello rettiwt (solo thumbnail per i video).
function bestMediaImage(tweet) {
  const media = tweet.media?.[0];
  if (!media) return null;
  if (media.type === "PHOTO") return media.url || null;
  return media.thumbnailUrl || null;
}

// Elimina i post X più vecchi oltre il limite, ordinando per data reale
// (non per ordine di inserimento: in un singolo run i tweet arrivano dal
// più recente al più vecchio, quindi l'ordine di push non è cronologico).
function trimToMax(canale, max) {
  const posts = canale.accounts
    .filter((a) => a.platform === "x" && isPostUrl(a.url))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  while (posts.length > max) {
    const oldest = posts.shift();
    canale.accounts = canale.accounts.filter((a) => a.url !== oldest.url);
  }
}

// --- Main ---
const { store } = await readStore();
const list = store.canali;

const xAccounts = [];
for (const canale of list) {
  for (const account of canale.accounts || []) {
    if (account.url && isXUrl(account.url) && !isPostUrl(account.url)) {
      const screenName = extractScreenNameFromUrl(account.url);
      if (screenName) {
        xAccounts.push({ canale, screenName, handle: account.handle || screenName });
      }
    }
  }
}

console.log(`Monitoro ${xAccounts.length} account X.`);

if (xAccounts.length === 0) {
  console.log("Nessun account X da monitorare, esco.");
  process.exit(0);
}

let modified = false;

for (const { canale, screenName, handle } of xAccounts) {
  console.log(`Controllo @${screenName}...`);

  let tweets = [];
  try {
    const result = await rettiwt.tweet.search({
      fromUsers: [screenName],
      count: TWEETS_PER_ACCOUNT,
    });
    tweets = result?.list ?? [];
  } catch (err) {
    console.error(`  errore su @${screenName}: ${String(err?.message || err)}`);
    continue;
  }

  console.log(`  trovati ${tweets.length} tweet.`);

  for (const tweet of tweets) {
    const url = tweet.url;
    if (!url) continue;

    const existing = canale.accounts.find((a) => a.url === url);
    if (existing) continue;

    canale.accounts.push({
      platform: "x",
      handle,
      url,
      date: tweet.createdAt || null,
      caption: tweet.fullText || null,
      imageUrl: bestMediaImage(tweet),
    });
    modified = true;
    console.log(`  nuovo post aggiunto: ${url}`);
  }

  trimToMax(canale, MAX_POSTS_PER_CHANNEL);
}

if (!modified) {
  console.log("Nessuna novità, aspi-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store);
console.log("aspi-monitoring.json aggiornato su GitHub.");
