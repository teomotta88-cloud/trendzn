// Orchestratore: scopre gli hashtag in trend per l'Italia e per ognuno
// esegue lo scraper TikTok, poi invia i nuovi URL all'endpoint Lovable.
//
// Variabili d'ambiente (opzionali):
//   MAX_HASHTAGS     quanti hashtag processare al massimo (default: 10)
//   MAX_POSTS_PER_TAG  max URL da raccogliere per hashtag (default: 12)
//   DELAY_BETWEEN_TAGS_MS  pausa in ms tra un hashtag e il successivo (default: 45000)
//
// Eseguito da .github/workflows/tiktok-trending-it.yml

import { discoverTrendingHashtags } from "./discover-trending-hashtags.mjs";
import { scrapeHashtag } from "./scrape-tiktok-hashtag.mjs";

const SYNC_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/sync-tiktok-hashtag";

const MAX_HASHTAGS = parseInt(process.env.MAX_HASHTAGS ?? "10", 10);
const MAX_POSTS_PER_TAG = parseInt(process.env.MAX_POSTS_PER_TAG ?? "12", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_TAGS_MS ?? "45000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncUrls(urls, hashtag) {
  if (urls.length === 0) return { inserted: 0 };
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, hashtag }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync endpoint failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — TikTok Trending IT ===");

// Step 1: scopri hashtag
const allHashtags = await discoverTrendingHashtags();
const hashtags = allHashtags.slice(0, MAX_HASHTAGS);
console.log(`\nHashtag da processare (${hashtags.length}): ${hashtags.join(", ")}`);

let totalInserted = 0;
const results = [];

// Step 2: per ogni hashtag, scraping + sync
for (let i = 0; i < hashtags.length; i++) {
  const tag = hashtags[i];
  console.log(`\n[${i + 1}/${hashtags.length}] #${tag}`);

  try {
    const urls = await scrapeHashtag(tag);
    const trimmed = urls.slice(0, MAX_POSTS_PER_TAG);
    console.log(`  Trovati ${urls.length} URL → invio ${trimmed.length}`);

    if (trimmed.length > 0) {
      const result = await syncUrls(trimmed, tag);
      totalInserted += result.inserted ?? 0;
      results.push({ tag, found: urls.length, sent: trimmed.length, inserted: result.inserted ?? 0 });
      console.log(`  Inseriti: ${result.inserted ?? 0}`);
    } else {
      results.push({ tag, found: 0, sent: 0, inserted: 0 });
    }
  } catch (err) {
    console.error(`  ERRORE per #${tag}: ${String(err)}`);
    results.push({ tag, error: String(err) });
  }

  // Pausa tra hashtag per non sovraccaricare TikTok (salta dopo l'ultimo)
  if (i < hashtags.length - 1) {
    console.log(`  Attesa ${DELAY_MS / 1000}s…`);
    await sleep(DELAY_MS);
  }
}

// Riepilogo
console.log("\n=== RIEPILOGO ===");
for (const r of results) {
  if (r.error) {
    console.log(`  #${r.tag}: ERRORE — ${r.error}`);
  } else {
    console.log(`  #${r.tag}: ${r.found} trovati → ${r.sent} inviati → ${r.inserted} inseriti`);
  }
}
console.log(`\nTotale nuovi video inseriti: ${totalInserted}`);
