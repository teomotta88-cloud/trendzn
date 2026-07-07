// Scopre gli hashtag in trend su TikTok per l'Italia.
//
// Fonte primaria: TikTok Creative Center (pagina "Trending Hashtags",
// richiede login — vedi scripts/tiktok-cc-session.mjs). È la fonte reale
// di hashtag TikTok in trend, non un proxy indiretto come Google Trends.
//
// Se il login/estrazione fallisce (sessione scaduta, pagina cambiata),
// ripiega su Google Trends RSS Italia (pubblico, no auth) e poi su una
// lista hardcoded, così il job non si blocca mai del tutto.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createAuthenticatedContext, ensureLoggedIn, persistSession } from "./tiktok-cc-session.mjs";

// Google ha deprecato il vecchio endpoint /trends/trendingsearches/daily/rss
// (risponde 404) a favore di questo, sotto il nuovo prodotto "Trending Now".
// È comunque solo un ripiego se TikTok Creative Center fallisce: se anche
// questo smette di funzionare, si scende semplicemente alla lista fissa.
const GOOGLE_TRENDS_IT_URL = "https://trends.google.com/trending/rss?geo=IT";

const FALLBACK_HASHTAGS = [
  "italia", "viral", "fyp", "trend",
  "calcio", "food", "moda", "musica", "estate",
  "milano", "roma", "vacanze", "humor", "notizie",
];

function normalizeHashtag(raw) {
  return raw
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñçß]/g, "")
    .trim();
}

// Cerca ricorsivamente, dentro una risposta JSON, array di oggetti che
// somigliano a "voci di hashtag" (nome + eventuale rank/volume). Non ci
// affidiamo a un path fisso perché lo schema esatto dell'API interna di
// Creative Center non è documentato pubblicamente e può cambiare.
function extractHashtagsFromJson(value, out = new Set(), depth = 0) {
  if (depth > 6 || !value) return out;
  if (Array.isArray(value)) {
    for (const item of value) extractHashtagsFromJson(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    const nameKey = ["hashtag_name", "hashtagName", "name", "title"].find(
      (k) => typeof value[k] === "string" && value[k].length > 0,
    );
    if (nameKey) out.add(normalizeHashtag(value[nameKey]));
    for (const v of Object.values(value)) extractHashtagsFromJson(v, out, depth + 1);
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
  const found = new Set();
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
        extractHashtagsFromJson(json, found);
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
      // Fallback DOM: qualunque testo visibile a forma di hashtag nella pagina.
      const domHashtags = await page.$$eval("body *", (els) =>
        els
          .map((el) => el.textContent?.trim())
          .filter((t) => t && /^#[a-zA-Z0-9à-ü]{2,40}$/.test(t)),
      );
      for (const h of domHashtags) found.add(normalizeHashtag(h));
    }

    if (found.size === 0) {
      await saveDebugArtifacts(page, `tiktok-cc-empty-${Date.now()}`);
    }

    await persistSession(context);
    return [...found].filter((h) => h.length >= 2 && h.length <= 40);
  } catch (err) {
    console.error(`[discover] Creative Center fallito: ${String(err)}`);
    if (page) await saveDebugArtifacts(page, `tiktok-cc-error-${Date.now()}`);
    if (context) await persistSession(context).catch(() => {});
    return [];
  } finally {
    await browser.close();
  }
}

function topicToHashtag(title) {
  return normalizeHashtag(title.replace(/\s+/g, ""));
}

async function discoverFromGoogleTrends() {
  const res = await fetch(GOOGLE_TRENDS_IT_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TrendzBot/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Google Trends RSS: HTTP ${res.status}`);

  const xml = await res.text();

  const cdataMatches = [...xml.matchAll(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/g)];
  const cdataTitles = cdataMatches.map((m) => m[1].trim()).filter(Boolean);

  const plainMatches = [...xml.matchAll(/<title>([^<]+)<\/title>/g)];
  const plainTitles = plainMatches
    .map((m) => m[1].trim())
    .filter((t) => !t.toLowerCase().includes("google") && t.length > 1);

  const all = [...new Set([...cdataTitles, ...plainTitles])];

  const hashtags = all
    .map(topicToHashtag)
    .filter((t) => t.length >= 3 && t.length <= 40);

  return [...new Set(hashtags)];
}

export async function discoverTrendingHashtags() {
  console.error("[discover] Cerco trending hashtag da TikTok Creative Center…");
  try {
    const tags = await discoverFromCreativeCenter();
    if (tags.length >= 5) {
      console.error(`[discover] ${tags.length} hashtag da TikTok Creative Center`);
      return tags.slice(0, 20);
    }
    console.error(`[discover] Solo ${tags.length} hashtag da Creative Center — provo Google Trends`);
  } catch (err) {
    console.error(`[discover] Errore Creative Center: ${String(err)} — provo Google Trends`);
  }

  try {
    const tags = await discoverFromGoogleTrends();
    if (tags.length >= 5) {
      console.error(`[discover] ${tags.length} hashtag da Google Trends IT`);
      return tags.slice(0, 20);
    }
    console.error(`[discover] Solo ${tags.length} hashtag da Google Trends — uso fallback`);
    return [...new Set([...tags, ...FALLBACK_HASHTAGS])].slice(0, 15);
  } catch (err) {
    console.error(`[discover] Errore Google Trends: ${String(err)} — uso fallback`);
    return FALLBACK_HASHTAGS.slice(0, 15);
  }
}

// Esecuzione standalone: node scripts/discover-trending-hashtags.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const tags = await discoverTrendingHashtags();
  console.log(JSON.stringify(tags, null, 2));
  console.error(`\n${tags.length} hashtag trovati`);
}
