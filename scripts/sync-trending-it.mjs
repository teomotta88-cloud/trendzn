// Orchestratore: scopre contenuti TikTok in trend per l'Italia.
//
// Percorso primario: hashtag reali da TikTok Creative Center → scraping
// della pagina hashtag pubblica → sync su Supabase (via sync-tiktok-hashtag).
//
// Ripiego (solo se Creative Center non restituisce nulla): link social
// (Instagram/Facebook/TikTok/X/LinkedIn) citati nel feed Google Trends IT,
// inviati direttamente come trend "trend-real-time" (via submit-manual) —
// sono già URL di post reali, non serve scraping aggiuntivo.
//
// Variabili d'ambiente (opzionali):
//   MAX_HASHTAGS     quanti hashtag processare al massimo (default: 10)
//   MAX_POSTS_PER_TAG  max URL da raccogliere per hashtag (default: 12)
//   DELAY_BETWEEN_TAGS_MS  pausa in ms tra un hashtag e il successivo (default: 45000)
//
// Eseguito da .github/workflows/tiktok-trending-it.yml

import { discoverTrendingHashtagsWithMetadata, discoverSocialUrlsFromGoogleTrends } from "./discover-trending-hashtags.mjs";
import { scrapeHashtag } from "./scrape-tiktok-hashtag.mjs";

const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-tiktok-hashtag";
const SUBMIT_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/submit-manual";
const TRENDING_HASHTAGS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-trending-hashtags";

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

// Aggiorna la tabella "trend del giorno" mostrata prima del feed nella
// pagina TikTok Trending Italia. Best-effort: se fallisce non deve
// bloccare il resto del sync (video URL è la parte che conta di più).
async function syncTrendingHashtagsMetadata(metadata) {
  try {
    const res = await fetch(TRENDING_HASHTAGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: "IT", periodDays: 7, items: metadata }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Sync tabella hashtag fallito (${res.status}): ${body.slice(0, 200)}`);
      return;
    }
    const result = await res.json();
    console.log(`Tabella trend aggiornata: ${result.inserted ?? 0} hashtag salvati.`);
  } catch (err) {
    console.error(`Sync tabella hashtag fallito: ${String(err)}`);
  }
}

async function submitTrendUrl(item) {
  const res = await fetch(SUBMIT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      section: "trend-real-time",
      url: item.url,
      title: item.topic,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function syncFromCreativeCenter(hashtags) {
  let totalInserted = 0;
  const results = [];

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

  console.log("\n=== RIEPILOGO (Creative Center) ===");
  for (const r of results) {
    if (r.error) {
      console.log(`  #${r.tag}: ERRORE — ${r.error}`);
    } else {
      console.log(`  #${r.tag}: ${r.found} trovati → ${r.sent} inviati → ${r.inserted} inseriti`);
    }
  }
  console.log(`\nTotale nuovi video inseriti: ${totalInserted}`);
}

async function syncFromGoogleTrendsFallback() {
  let items;
  try {
    items = await discoverSocialUrlsFromGoogleTrends();
  } catch (err) {
    console.error(`Ripiego Google Trends fallito: ${String(err)}`);
    return;
  }

  if (items.length === 0) {
    console.log("Nessun link social trovato nel feed Google Trends, nessun ripiego disponibile.");
    return;
  }

  console.log(`\nInvio ${items.length} URL social trovati su Google Trends (sezione trend-real-time)…`);
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of items) {
    const { ok, status, body } = await submitTrendUrl(item);
    if (ok) {
      inserted++;
      console.log(`  [${item.platform}] ${item.url} → inserito`);
    } else if (status === 409) {
      duplicates++;
    } else {
      failed++;
      console.error(`  [${item.platform}] ${item.url} → errore: ${body.error ?? status}`);
    }
  }

  console.log(`\n=== RIEPILOGO (Google Trends) ===`);
  console.log(`  Inseriti: ${inserted} · Già presenti: ${duplicates} · Falliti: ${failed}`);
}

// --- Main ---
console.log("=== TRENDZN — TikTok Trending IT ===");

const { hashtags: allHashtags, metadata } = await discoverTrendingHashtagsWithMetadata();
const hashtags = allHashtags.slice(0, MAX_HASHTAGS);

if (metadata.length > 0) {
  await syncTrendingHashtagsMetadata(metadata);
}

if (hashtags.length > 0) {
  console.log(`\nHashtag da processare (${hashtags.length}): ${hashtags.join(", ")}`);
  await syncFromCreativeCenter(hashtags);
} else {
  console.log("\nNessun hashtag da TikTok Creative Center, provo il ripiego Google Trends…");
  await syncFromGoogleTrendsFallback();
}
