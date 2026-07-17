// Discovery gratuita dei trend X (x.com/explore/tabs/trending), da account
// autenticato — vedi probe-x-trending-authenticated.mjs per come si è
// arrivati a questo approccio (anonimo bloccato dal login-wall; rettiwt-api
// non espone alcun endpoint "trend", ma i suoi stessi cookie funzionano in un
// browser Playwright vero).
//
// A differenza di TikTok/Google Trends, X non mostra qui alcun volume/
// conteggio utilizzabile per i trend normali (solo rank + categoria — un
// numero reale compare solo per le 3 card "Today's News", non per la lista
// trending) — per richiesta esplicita dell'utente questa fonte NON traccia
// crescita/volumi: si limita a registrare i trend in monitored_topics (con
// la categoria mostrata da X, es. "Politics") così che la pipeline già
// esistente (discover-instagram-hashtag-content.mjs) li cerchi su Instagram
// e applichi le stesse regole di viralità degli altri post.
//
// Richiede l'account X dedicato con la localizzazione dei trend impostata su
// Italia (impostazione lato account, fatta una volta sola da UI normale —
// vedi RETTIWT_API_KEY nei secrets).

import { chromium } from "playwright";
import { decodeCookieString, toPlaywrightCookies } from "./lib/x-auth-cookies.mjs";
import { keywordToHashtag } from "./lib/word-segment.mjs";

const TRENDING_URL = "https://x.com/explore/tabs/trending";
const MONITOR_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/monitor-topics";

// Stessa soglia già usata per le keyword Google Trends multi-parola
// (discover-instagram-hashtag-content.mjs): un hashtag derivato concatenando
// più di 2 parole ha un tasso di successo molto più basso sulla pagina
// hashtag Instagram.
const MAX_DERIVABLE_WORDS = 2;

const API_KEY = process.env.RETTIWT_API_KEY;
if (!API_KEY) {
  console.error("Manca RETTIWT_API_KEY nei secrets/env.");
  process.exit(1);
}

// Ogni elemento [data-testid="trend"] ha innerText nella forma
// "1\n·\nPolitics · Trending\nNomeDelTrend" (a volte con una riga finale in
// più "Trending with X", ignorata). La categoria è "Trending in Italy"/
// "Trending worldwide" quando X non assegna una categoria reale — in quel
// caso category resta null invece di salvare una stringa senza significato.
function parseTrendBlock(raw) {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rank = parseInt(lines[0], 10);
  const categoryLine = lines[2] ?? "";
  const name = lines[3] ?? "";
  if (!name || Number.isNaN(rank)) return null;

  const catMatch = categoryLine.match(/^(.+?)\s*·\s*Trending$/);
  const category = catMatch ? catMatch[1].trim() : null;

  return { rank, category, name };
}

// Converte un trend grezzo in {value, derivedHashtag}: se è già un hashtag o
// un nome a una sola parola, va bene usarlo direttamente come hashtag su
// Instagram (stesso trattamento di tiktok-hashtag). Se è una frase di 2
// parole, si deriva un hashtag concatenato (stessa tecnica di
// keywordToHashtag per Google Trends); oltre le 2 parole non si deriva nulla
// (discover-instagram-hashtag-content.mjs lo escluderà dalla ricerca via
// hashtag, resta comunque monitorato).
function toTopicFields(name) {
  const value = name.replace(/^#/, "").trim();
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 1) return { value, derivedHashtag: null };
  if (wordCount > MAX_DERIVABLE_WORDS) return { value, derivedHashtag: null };
  return { value, derivedHashtag: keywordToHashtag(value) };
}

async function registerTopics(topics) {
  const res = await fetch(MONITOR_TOPICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topics }),
  });
  if (!res.ok) throw new Error(`monitor-topics failed (${res.status}): ${await res.text()}`);
  return res.json();
}

console.log("=== TRENDZN — Discovery X Trending (autenticato) ===");

const cookieString = decodeCookieString(API_KEY);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "it-IT",
});
await context.addCookies(toPlaywrightCookies(cookieString));
const page = await context.newPage();

try {
  const response = await page
    .goto(TRENDING_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      console.error("Errore di navigazione:", e.message);
      return null;
    });
  if (!response) process.exit(1);

  await page.waitForTimeout(5000);

  if (/\/(login|i\/flow\/login|account\/access)/.test(page.url())) {
    console.error("Login wall: la sessione autenticata non ha funzionato (cookie scaduti?).");
    process.exit(1);
  }

  const rawBlocks = await page.$$eval('[data-testid="trend"]', (nodes) =>
    nodes.map((n) => n.innerText?.trim()).filter(Boolean),
  );

  const parsed = rawBlocks.map(parseTrendBlock).filter(Boolean);
  console.log(`Trend estratti dalla pagina: ${parsed.length}/${rawBlocks.length}`);

  const topics = parsed.map(({ rank, category, name }) => {
    const { value, derivedHashtag } = toTopicFields(name);
    console.log(
      `  #${rank} [${category ?? "senza categoria"}] ${name} -> hashtag: ${derivedHashtag ?? value}`,
    );
    return {
      topicType: "x-trending",
      value,
      derivedHashtag,
      derivedKeyword: null,
      category,
    };
  });

  if (topics.length === 0) {
    console.log("Nessun trend estratto, nulla da registrare.");
    process.exit(0);
  }

  const result = await registerTopics(topics);
  console.log(`\nRegistrati in monitored_topics: ${result.topics?.length ?? 0}/${topics.length}`);
} finally {
  await browser.close();
}

console.log("\n=== Fine ===");
