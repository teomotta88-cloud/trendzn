// Scoperta di topic "attuali" per l'Italia indipendente dal flusso
// TikTok-hashtag: Google Trends non ha una API ufficiale, ma pubblica da anni
// un feed RSS pubblico delle ricerche in tendenza per paese (stessa fonte
// usata da librerie come pytrends) — nessuna autenticazione, nessun costo,
// nessuna chiave da configurare. Restituisce già frasi leggibili in linguaggio
// naturale (es. "Milan Napoli biglietti"): a differenza degli hashtag TikTok
// non serve alcuna conversione hashtag->keyword (OpenRouter/word-segment.mjs).
//
// ATTENZIONE: endpoint non documentato ufficialmente, può cambiare o rompersi
// senza preavviso — stesso profilo di rischio già accettato in questo
// progetto per il login/scraping di TikTok Creative Center (vedi
// discover-trending-hashtags.mjs). Il chiamante deve continuare a funzionare
// anche se questa fonte fallisce (vedi fetchGoogleTrendsKeywords in
// sync-viral-trends.mjs).
//
// Il primo run reale (2026-07-08) ha dato 404 su questo path: era quello
// vecchio (/trends/trendingsearches/daily/rss), dismesso col redesign di
// Google Trends che ha sostituito le pagine sotto /trends/trendingsearches
// con /trending. Il path RSS attuale è /trending/rss (stesso parametro
// "geo") — non verificabile in modo definitivo da questo ambiente (rete
// verso google.com bloccata anche per query dirette), va confermato dal
// prossimo run reale del workflow.
const TRENDS_RSS_URL = "https://trends.google.com/trending/rss";

export async function fetchGoogleTrendsIT({ geo = "IT" } = {}) {
  const url = new URL(TRENDS_RSS_URL);
  url.searchParams.set("geo", geo);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; trendzn-bot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Google Trends RSS failed (${res.status})`);
  }
  return parseTrendsRss(await res.text());
}

function parseTrendsRss(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    if (!title) continue;
    items.push({
      title: decodeXmlEntities(title),
      approxTraffic: extractTag(block, "ht:approx_traffic"),
    });
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
  return re.exec(block)?.[1]?.trim() ?? null;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
