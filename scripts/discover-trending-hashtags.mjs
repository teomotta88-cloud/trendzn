// Scopre gli hashtag in trend su TikTok per l'Italia via Playwright.
//
// Strategia:
//   1. Naviga al TikTok Creative Center (pubblico, niente login) e intercetta
//      la risposta API che carica la lista hashtag trending.
//   2. Se il Creative Center restituisce dati validi → usali.
//   3. Fallback: estrai hashtag dal DOM renderizzato della stessa pagina.
//   4. Fallback finale: lista hardcoded di hashtag IT sempre rilevanti.
//
// Restituisce: array di stringhe (nomi hashtag senza #), es. ["fypシ","italia","calcio"]

import { chromium } from "playwright";

const CREATIVE_CENTER_URL =
  "https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?locale=en&deviceType=pc&region=IT&period=7";

// Regex per intercettare la chiamata API interna del Creative Center
const HASHTAG_LIST_API_RE = /popular_trend\/hashtag\/list|trending.*hashtag|hashtag.*trend/i;

// Selettori DOM da provare se l'intercettazione API non funziona
const DOM_SELECTORS = [
  '[class*="hashtag"] [class*="name"]',
  '[class*="trend"] [class*="tag"]',
  'a[href*="/tag/"]',
  '[data-testid*="hashtag"]',
];

// Hashtag italiani sempre rilevanti come fallback di sicurezza
const FALLBACK_HASHTAGS = [
  "fypシ", "italia", "viral", "fyp", "trend",
  "calcio", "food", "moda", "musica", "estate",
  "milano", "roma", "vacanze", "estate2025", "humor",
];

async function discoverFromCreativeCenter() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-IT",
    timezoneId: "Europe/Rome",
  });

  // Imposta geolocalizzazione italiana
  await page.setExtraHTTPHeaders({
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
  });

  let apiHashtags = [];

  // Intercetta le risposte API del Creative Center
  page.on("response", async (response) => {
    if (!HASHTAG_LIST_API_RE.test(response.url())) return;
    try {
      const json = await response.json();
      // Struttura risposta Creative Center: { data: { list: [{ tag_name, ... }] } }
      const list =
        json?.data?.list ??
        json?.data?.hashtag_list ??
        json?.list ??
        json?.data ??
        [];
      const tags = (Array.isArray(list) ? list : [])
        .map((item) => item?.tag_name ?? item?.hashtag_name ?? item?.name ?? "")
        .filter(Boolean)
        .map((t) => t.replace(/^#/, "").trim().toLowerCase());
      if (tags.length > 0) {
        apiHashtags.push(...tags);
        console.error(`[discover] API intercettata: ${tags.length} hashtag`);
      }
    } catch {
      // risposta non JSON, ignora
    }
  });

  try {
    await page.goto(CREATIVE_CENTER_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Aspetta un po' per permettere all'app React di caricare i dati
    await page.waitForTimeout(3000);

    if (apiHashtags.length >= 5) {
      console.error(`[discover] ${apiHashtags.length} hashtag da API Creative Center`);
      return apiHashtags.slice(0, 20);
    }

    // Fallback DOM: prova i selettori CSS noti
    for (const sel of DOM_SELECTORS) {
      const elements = await page.$$(sel);
      if (elements.length === 0) continue;

      const texts = await Promise.all(
        elements.map((el) => el.textContent().catch(() => "")),
      );
      const tags = texts
        .map((t) => t?.replace(/^#/, "").trim().toLowerCase())
        .filter((t) => t && t.length >= 2 && t.length <= 50 && /^[a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñçß_]+$/i.test(t));

      if (tags.length >= 3) {
        console.error(`[discover] ${tags.length} hashtag da DOM (selettore: ${sel})`);
        return [...new Set(tags)].slice(0, 20);
      }
    }

    console.error("[discover] Nessun hashtag trovato nel DOM del Creative Center");
    return [];
  } catch (err) {
    console.error(`[discover] Errore navigazione Creative Center: ${String(err)}`);
    return [];
  } finally {
    await browser.close();
  }
}

export async function discoverTrendingHashtags() {
  console.error("[discover] Cerco hashtag trending IT dal Creative Center…");
  const fromCreativeCenter = await discoverFromCreativeCenter();

  if (fromCreativeCenter.length >= 5) {
    return fromCreativeCenter;
  }

  // Fallback alla lista hardcoded
  console.error(
    `[discover] Creative Center ha restituito solo ${fromCreativeCenter.length} hashtag — uso fallback hardcoded`,
  );
  const combined = [...new Set([...fromCreativeCenter, ...FALLBACK_HASHTAGS])];
  return combined.slice(0, 15);
}

// Esecuzione standalone: node scripts/discover-trending-hashtags.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const tags = await discoverTrendingHashtags();
  console.log(JSON.stringify(tags, null, 2));
  console.error(`\n${tags.length} hashtag trovati`);
}
