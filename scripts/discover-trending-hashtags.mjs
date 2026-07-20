// Scopre contenuti in trend per l'Italia, in due modi distinti:
//
// - discoverTrendingHashtags(): fonte primaria, TikTok Creative Center
//   (pagina "Trending Hashtags", richiede login — vedi tiktok-cc-session.mjs).
//   Ritorna nomi di hashtag TikTok reali, da passare a scrapeHashtag().
//
// - discoverSocialUrlsFromGoogleTrends(): ripiego se Creative Center non
//   restituisce nulla. Legge il feed pubblico Google Trends Italia e ne
//   estrae direttamente i link a contenuti social (Instagram, Facebook,
//   TikTok, X, LinkedIn) citati come fonte di ogni tendenza — sono URL
//   di post reali, pronti da inviare così come sono. Niente più
//   conversione euristica "argomento di ricerca → hashtag inventato".

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createAuthenticatedContext, ensureLoggedIn, persistSession } from "./tiktok-cc-session.mjs";

const GOOGLE_TRENDS_IT_URL = "https://trends.google.com/trending/rss?geo=IT";

const SOCIAL_HOST_PATTERN =
  /(^|\.)(instagram\.com|facebook\.com|fb\.watch|tiktok\.com|x\.com|twitter\.com|linkedin\.com)$/i;

function normalizeHashtag(raw) {
  return raw
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñçß]/g, "")
    .trim();
}

function detectPlatformFromHost(hostname) {
  if (/(^|\.)instagram\.com$/i.test(hostname)) return "instagram";
  if (/(^|\.)(facebook\.com|fb\.watch)$/i.test(hostname)) return "facebook";
  if (/(^|\.)tiktok\.com$/i.test(hostname)) return "tiktok";
  if (/(^|\.)(x\.com|twitter\.com)$/i.test(hostname)) return "x";
  if (/(^|\.)linkedin\.com$/i.test(hostname)) return "linkedin";
  return "web";
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  return null;
}

function pickCategoryList(obj) {
  for (const k of ["industry_list", "industryList", "category", "categories", "label_list"]) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v
        .map((c) => (typeof c === "string" ? c : c?.value || c?.label || c?.name))
        .filter((c) => typeof c === "string" && c.length > 0);
    }
  }
  return [];
}

function pickTrendArray(obj) {
  for (const k of ["trend", "trend_list", "trendList", "sparkline"]) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number")) return v;
  }
  return null;
}

// Cerca ricorsivamente, dentro una risposta JSON, oggetti che somigliano a
// "voci di hashtag" (nome + rank/categoria/volumi/sparkline). Non ci
// affidiamo a un path fisso né a nomi di campo certi perché lo schema
// esatto dell'API interna di Creative Center non è documentato
// pubblicamente e può cambiare — per questo discoverFromCreativeCenter
// salva anche le risposte grezze in debug/, così i nomi dei campi qui
// sotto si possono affinare guardando dati reali invece di indovinare.
function extractHashtagObjectsFromJson(value, out = new Map(), depth = 0) {
  if (depth > 6 || !value) return out;
  if (Array.isArray(value)) {
    for (const item of value) extractHashtagObjectsFromJson(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    const nameKey = ["hashtag_name", "hashtagName", "name", "title"].find(
      (k) => typeof value[k] === "string" && value[k].length > 0,
    );
    if (nameKey) {
      const hashtag = normalizeHashtag(value[nameKey]);
      if (hashtag && !out.has(hashtag)) {
        out.set(hashtag, {
          hashtag,
          rank: pickNumber(value, ["rank", "ranking", "position"]),
          category: pickCategoryList(value),
          postCount: pickNumber(value, ["publish_cnt", "post_count", "postCount", "video_count", "videoCount"]),
          viewCount: pickNumber(value, ["video_views", "view_count", "viewCount", "views"]),
          trend: pickTrendArray(value),
          raw: value,
        });
      }
    }
    for (const v of Object.values(value)) extractHashtagObjectsFromJson(v, out, depth + 1);
  }
  return out;
}

async function saveDebugArtifacts(page, label) {
  try {
    mkdirSync("debug", { recursive: true });
    await page.screenshot({ path: `debug/${label}.png`, fullPage: true });
    writeFileSync(`debug/${label}.html`, await page.content());
    console.error(`[discover] Salvati artifact di debug in debug/${label}.png / .html`);
  } catch (err) {
    console.error(`[discover] Impossibile salvare artifact di debug: ${String(err)}`);
  }
}

async function discoverFromCreativeCenter() {
  const browser = await chromium.launch({ headless: true });
  const found = new Map();
  const capturedResponses = [];
  let context;
  let page;

  try {
    context = await createAuthenticatedContext(browser);
    page = await context.newPage();

    // Intercetta le risposte JSON della pagina mentre carica: è il modo
    // più robusto per leggere i dati reali (l'HTML/CSS di Creative Center
    // è generato da un bundle React con classi non stabili). Registrato
    // PRIMA della navigazione così cattura anche le richieste sparate
    // subito dopo il caricamento iniziale della pagina.
    page.on("response", async (response) => {
      const url = response.url();
      if (!/hashtag|trend/i.test(url)) return;
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("application/json")) return;
      try {
        const json = await response.json();
        capturedResponses.push({ url, json });
        extractHashtagObjectsFromJson(json, found);
      } catch {
        // risposta non JSON valido o già consumata, ignora
      }
    });

    await ensureLoggedIn(page);
    // Attesa dopo il caricamento (non "networkidle": Creative Center ha
    // polling/analytics continui che a volte non lasciano mai la rete
    // "inattiva") per dare tempo alle chiamate XHR della dashboard di
    // completarsi e finire nell'intercettore sopra.
    await page.waitForTimeout(8000);

    if (found.size === 0) {
      // Fallback DOM: qualunque testo visibile a forma di hashtag nella pagina
      // (nessun rank/categoria/volumi disponibili in questo caso).
      const domHashtags = await page.$$eval("body *", (els) =>
        els
          .map((el) => el.textContent?.trim())
          .filter((t) => t && /^#[a-zA-Z0-9à-ü]{2,40}$/.test(t)),
      );
      for (const h of domHashtags) {
        const hashtag = normalizeHashtag(h);
        if (hashtag && !found.has(hashtag)) {
          found.set(hashtag, { hashtag, rank: null, category: [], postCount: null, viewCount: null, trend: null });
        }
      }
    }

    // Sempre salvate (non solo quando vuoto): sono la fonte di verità per
    // affinare i nomi dei campi in extractHashtagObjectsFromJson senza
    // dover indovinare alla cieca.
    if (capturedResponses.length > 0) {
      try {
        mkdirSync("debug", { recursive: true });
        writeFileSync(`debug/tiktok-cc-responses-${Date.now()}.json`, JSON.stringify(capturedResponses, null, 2));
      } catch (err) {
        console.error(`[discover] Impossibile salvare le risposte grezze: ${String(err)}`);
      }
    }

    if (found.size === 0) {
      await saveDebugArtifacts(page, `tiktok-cc-empty-${Date.now()}`);
    } else if (capturedResponses.length === 0) {
      // Il ranking vero arriva SOLO dalle risposte JSON delle chiamate XHR
      // della dashboard (via extractHashtagObjectsFromJson) — se sono zero
      // ma found.size > 0, l'unica fonte è stato il fallback DOM (testo
      // generico a forma di hashtag, senza rank/volumi): sintomo di una
      // dashboard non pienamente caricata (sessione degradata, cambio di
      // struttura della pagina, account senza accesso alla vista completa)
      // anche se isLoggedIn() non l'ha rilevato (controlla solo che l'URL
      // non sia /login). Salviamo comunque uno screenshot per capire cosa
      // vede davvero la pagina, invece di continuare a indovinare dai soli
      // hashtag trovati.
      await saveDebugArtifacts(page, `tiktok-cc-no-json-responses-${Date.now()}`);
    }

    await persistSession(context);
    return [...found.values()]
      .filter((h) => h.hashtag.length >= 2 && h.hashtag.length <= 40)
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  } catch (err) {
    console.error(`[discover] Creative Center fallito: ${String(err)}`);
    if (page) await saveDebugArtifacts(page, `tiktok-cc-error-${Date.now()}`);
    if (context) await persistSession(context).catch(() => {});
    return [];
  } finally {
    await browser.close();
  }
}

// Ritorna sia i nomi hashtag (per lo scraping della pagina pubblica) sia
// i metadati completi (rank/categoria/volumi/sparkline, quando disponibili)
// per popolare la tabella "trend del giorno" mostrata prima del feed.
export async function discoverTrendingHashtagsWithMetadata() {
  console.error("[discover] Cerco trending hashtag da TikTok Creative Center…");
  const items = await discoverFromCreativeCenter();
  console.error(`[discover] ${items.length} hashtag da TikTok Creative Center`);
  const top = items.slice(0, 20);
  return { hashtags: top.map((h) => h.hashtag), metadata: top };
}

export async function discoverTrendingHashtags() {
  const { hashtags } = await discoverTrendingHashtagsWithMetadata();
  return hashtags;
}

// Estrae, da ogni voce del feed Google Trends, solo i link a contenuti
// social (non l'argomento di ricerca in sé): sono URL di post reali già
// pronti da inviare, non c'è nessuna conversione euristica di mezzo.
// Non ci affidiamo ai nomi esatti dei tag del feed (namespace ht:news_item*,
// che Google può cambiare) ma cerchiamo qualsiasi URL nel blocco di ogni
// tendenza e lo filtriamo per dominio: più robusto a variazioni di schema.
function extractSocialUrlsFromXml(xml) {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const results = [];
  const seen = new Set();

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const topic = titleMatch ? titleMatch[1].trim() : null;

    const rawUrls = block.match(urlPattern) || [];
    for (const raw of rawUrls) {
      const cleaned = raw.replace(/&amp;/g, "&").replace(/[).,;\]"']+$/, "");
      let parsed;
      try {
        parsed = new URL(cleaned);
      } catch {
        continue;
      }
      if (!SOCIAL_HOST_PATTERN.test(parsed.hostname)) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      results.push({ url: cleaned, topic, platform: detectPlatformFromHost(parsed.hostname) });
    }
  }

  return results;
}

export async function discoverSocialUrlsFromGoogleTrends() {
  console.error("[discover] Cerco link social nel feed Google Trends IT…");
  const res = await fetch(GOOGLE_TRENDS_IT_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TrendzBot/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Google Trends RSS: HTTP ${res.status}`);

  const xml = await res.text();
  const items = extractSocialUrlsFromXml(xml);
  console.error(`[discover] ${items.length} URL social trovati nel feed Google Trends`);
  return items;
}

// Esecuzione standalone: node scripts/discover-trending-hashtags.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const { hashtags, metadata } = await discoverTrendingHashtagsWithMetadata();
  console.log(JSON.stringify({ hashtags, metadata }, null, 2));
  console.error(`\n${hashtags.length} hashtag trovati`);

  if (hashtags.length === 0) {
    const items = await discoverSocialUrlsFromGoogleTrends();
    console.log(JSON.stringify({ googleTrendsSocialUrls: items }, null, 2));
    console.error(`${items.length} URL social trovati come ripiego`);
  }
}
