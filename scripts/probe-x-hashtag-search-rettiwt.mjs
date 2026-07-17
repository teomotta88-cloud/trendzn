// Script diagnostico usa-e-getta: verifica se rettiwt-api (già in produzione
// per ASPI-monitoring, vedi sync-x-posts.mjs) può essere usata anche per
// Trend Virali — non per SCOPRIRE quali topic sono di tendenza (la libreria
// non espone nessun servizio "trend": ispezionando node_modules/rettiwt-api
// non esiste altro oltre a dm/list/space/tweet/user, la lista dei trend resta
// compito dell'aggregatore pubblico, vedi probe-x-trends-aggregator.mjs), ma
// per ARRICCHIRE un trend già noto con post reali e il loro engagement
// (like, retweet, reply, quote, views) — cosa che né lo scraping anonimo né
// l'aggregatore possono dare.
//
// tweet.search() supporta un filtro per hashtag ({ hashtags: [...] }) e per
// parole chiave ({ includeWords: [...] }), con { top: true } per i risultati
// più rilevanti invece dei più recenti — utile perché i topic di Trend
// Virali arrivano sia come hashtag TikTok sia come frasi Google Trends.
//
// Uso:
//   node scripts/probe-x-hashtag-search-rettiwt.mjs [hashtag1,hashtag2,...]
//
// Richiede RETTIWT_API_KEY nell'ambiente (stesso account X dedicato già
// usato da ASPI-monitoring).

import { createRequire } from "module";
import { Rettiwt } from "rettiwt-api";

const require = createRequire(import.meta.url);
const rettiwtVersion = require("rettiwt-api/package.json").version;

const API_KEY = process.env.RETTIWT_API_KEY;

// Hashtag scelti solo per verificare il MECCANISMO (hanno quasi certamente
// volume italiano tutti i giorni), non perché "in trend" oggi — la lista dei
// trend reali arriva dall'aggregatore (probe-x-trends-aggregator.mjs), qui si
// vuole solo sapere se, DATO un hashtag/keyword, si riescono a recuperare
// post reali con engagement.
const DEFAULT_HASHTAGS = "juventus,inter,roma";
const hashtags = (process.argv[2] || DEFAULT_HASHTAGS)
  .split(",")
  .map((h) => h.trim().replace(/^#/, ""))
  .filter(Boolean);

console.log("=== Probe X hashtag/keyword search (rettiwt-api) ===");
console.log(`rettiwt-api versione installata: ${rettiwtVersion}`);
console.log(`hashtag/keyword da testare: ${hashtags.join(", ")}`);
console.log(`API_KEY presente: ${API_KEY ? `sì (${API_KEY.length} char)` : "NO"}`);

if (!API_KEY) {
  console.error("Manca RETTIWT_API_KEY nei secrets/env.");
  process.exit(1);
}

const rettiwt = new Rettiwt({ apiKey: API_KEY });

function printError(label, err) {
  console.log(`\n[${label}] FALLITO:`);
  console.log("  name:", err?.name || null);
  console.log("  message:", err?.message || String(err));
  console.log("  code:", err?.code || null);
  console.log("  status:", err?.status || null);
  if (err?.data) {
    try {
      console.log("  data:", JSON.stringify(err.data, null, 2).slice(0, 1500));
    } catch {
      console.log("  data:", err.data);
    }
  }
}

// Campi verificati leggendo direttamente node_modules/rettiwt-api/dist/models/data/Tweet.d.ts
// (7.1.2): Tweet.url e Tweet.tweetBy.userName esistono già come proprietà
// dirette, non serve ricostruirli a mano né indovinare nomi alternativi.
function summarizeTweet(tweet, index) {
  console.log(`\n  #${index + 1}`);
  console.log("  id:", tweet?.id ?? null);
  console.log("  url:", tweet?.url ?? null);
  console.log("  autore:", tweet?.tweetBy?.userName ?? null);
  console.log("  data:", tweet?.createdAt ?? null);
  console.log(
    "  testo:",
    tweet?.fullText ? String(tweet.fullText).replace(/\s+/g, " ").slice(0, 220) : null,
  );
  console.log("  metriche:", {
    likes: tweet?.likeCount ?? null,
    reposts: tweet?.retweetCount ?? null,
    replies: tweet?.replyCount ?? null,
    quotes: tweet?.quoteCount ?? null,
    views: tweet?.viewCount ?? null,
    bookmarks: tweet?.bookmarkCount ?? null,
  });
}

async function tryCall(label, fn) {
  try {
    const result = await fn();
    console.log(`\n[${label}] OK`);
    const list = result?.list ?? (Array.isArray(result) ? result : null);
    if (list) {
      console.log(`  risultati: ${list.length}`);
      list.slice(0, 8).forEach(summarizeTweet);
      const withMetrics = list.filter((t) => (t?.likeCount ?? null) != null);
      console.log(
        `  con metriche leggibili (likeCount non null): ${withMetrics.length}/${list.length}`,
      );
    } else {
      console.log("  risultato inatteso, chiavi:", result ? Object.keys(result) : null);
      console.log("  preview:", JSON.stringify(result, null, 2).slice(0, 1500));
    }
    return result;
  } catch (err) {
    printError(label, err);
    return null;
  }
}

for (const h of hashtags) {
  await tryCall(`search hashtag #${h} (top)`, () =>
    rettiwt.tweet.search({ hashtags: [h], language: "it", top: true }, 10),
  );
  await tryCall(`search hashtag #${h} (latest)`, () =>
    rettiwt.tweet.search({ hashtags: [h], language: "it", top: false }, 10),
  );
}

// Un topic Google Trends arriva come frase ("Empire State Building"), non
// come hashtag: verifica separata su includeWords per lo stesso motivo.
await tryCall("search keyword libera (includeWords, top)", () =>
  rettiwt.tweet.search(
    { includeWords: hashtags[0] ? [hashtags[0]] : ["Italia"], language: "it", top: true },
    10,
  ),
);

console.log("\n=== Fine probe ===");
