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
    // pubDate = quando la ricerca è entrata in tendenza. Serve per ordinare
    // "per più recente" a valle (vedi fetchGoogleTrendsKeywords in
    // sync-viral-trends.mjs). Formato RFC-822 ("Sun, 13 Jul 2026 08:00:00
    // ...") parsabile da new Date(); pubDateMs è null se manca o non parsa,
    // così l'ordinamento può trattarlo come "meno recente".
    const pubDate = extractTag(block, "pubDate");
    const pubDateMs = pubDate ? Date.parse(pubDate) : NaN;
    items.push({
      title: decodeXmlEntities(title),
      approxTraffic: extractTag(block, "ht:approx_traffic"),
      pubDate: pubDate ?? null,
      pubDateMs: Number.isNaN(pubDateMs) ? null : pubDateMs,
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

// Magnitudine reale di una keyword già monitorata (Fase 4/D): l'RSS sopra dà
// solo "è nel top-25 sì/no", nessun numero. Qui si usa lo stesso flusso a due
// chiamate delle librerie non ufficiali stile pytrends (Google Trends non ha
// un endpoint pubblico diretto per l'interest-over-time):
//   1. /explore restituisce un token + i parametri esatti da rimandare al
//      passo 2, specifici per la combinazione keyword+geo+finestra richiesta
//      (il token non è riusabile per un'altra keyword).
//   2. /widgetdata/multiline, con quel token, restituisce la serie storica
//      vera (interest_over_time, indice relativo 0-100).
// Entrambe le risposte hanno un prefisso anti-hijacking ")]}'," da rimuovere
// prima del JSON.parse — stesso trucco usato da pytrends e da altre API
// interne Google.
//
// ATTENZIONE: stesso profilo di rischio dell'RSS sopra (endpoint interno non
// documentato, può cambiare senza preavviso) — il chiamante deve continuare
// a funzionare anche se questa funzione fallisce per una singola keyword
// (vedi discover-google-trends-interest.mjs, che logga e prosegue con le
// altre invece di interrompere il run).
const EXPLORE_URL = "https://trends.google.com/trends/api/explore";
const WIDGET_DATA_URL = "https://trends.google.com/trends/api/widgetdata/multiline";
const ANTI_HIJACK_PREFIX = ")]}',";

function stripAntiHijackPrefix(text) {
  return text.startsWith(ANTI_HIJACK_PREFIX) ? text.slice(ANTI_HIJACK_PREFIX.length) : text;
}

// Il chiamante (discover-google-trends-interest.mjs) deve distinguere un
// 429 (rate-limit, vale la pena ritentare con un'attesa più lunga) da un
// altro errore (keyword strana, risposta malformata: ritentare non serve) —
// da qui il "status" esposto sull'errore invece di un Error generico.
export class GoogleTrendsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GoogleTrendsError";
    this.status = status;
  }
}

export async function fetchInterestOverTime({ keyword, geo = "IT", timeRange = "now 7-d" } = {}) {
  const exploreReq = {
    comparisonItem: [{ keyword, geo, time: timeRange }],
    category: 0,
    property: "",
  };

  const exploreUrl = new URL(EXPLORE_URL);
  exploreUrl.searchParams.set("hl", "it");
  exploreUrl.searchParams.set("tz", "-60");
  exploreUrl.searchParams.set("req", JSON.stringify(exploreReq));

  const exploreRes = await fetch(exploreUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; trendzn-bot/1.0)" },
  });
  if (!exploreRes.ok) {
    throw new GoogleTrendsError(`Google Trends explore failed (${exploreRes.status})`, exploreRes.status);
  }
  const exploreData = JSON.parse(stripAntiHijackPrefix(await exploreRes.text()));

  const timeseriesWidget = (exploreData.widgets ?? []).find((w) => w.id === "TIMESERIES");
  if (!timeseriesWidget) {
    throw new Error("Google Trends: widget TIMESERIES non trovato nella risposta explore");
  }

  const widgetUrl = new URL(WIDGET_DATA_URL);
  widgetUrl.searchParams.set("hl", "it");
  widgetUrl.searchParams.set("tz", "-60");
  widgetUrl.searchParams.set("req", JSON.stringify(timeseriesWidget.request));
  widgetUrl.searchParams.set("token", timeseriesWidget.token);

  const widgetRes = await fetch(widgetUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; trendzn-bot/1.0)" },
  });
  if (!widgetRes.ok) {
    throw new GoogleTrendsError(`Google Trends widgetdata failed (${widgetRes.status})`, widgetRes.status);
  }
  const widgetData = JSON.parse(stripAntiHijackPrefix(await widgetRes.text()));

  const points = widgetData.default?.timelineData ?? [];
  return points.map((p) => ({
    // "time" è un timestamp unix in secondi, come stringa.
    timestampMs: Number(p.time) * 1000,
    // value è un array (un elemento per ogni comparisonItem: qui sempre 1
    // keyword sola, quindi sempre value[0]) — indice relativo 0-100.
    value: Array.isArray(p.value) ? (p.value[0] ?? null) : null,
  }));
}

// Ultimo punto noto della serie (il più recente) — quello che interessa per
// uno snapshot "adesso" in topic_metrics_history, non l'intera serie
// storica (vedi discover-google-trends-interest.mjs).
export function latestInterestValue(points) {
  if (!points || points.length === 0) return null;
  return points[points.length - 1]?.value ?? null;
}
