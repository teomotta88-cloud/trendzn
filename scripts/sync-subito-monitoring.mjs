// Monitora annunci Subito.it per una lista di keyword (pagina nascosta
// "monitoraggio-subito"). Per ogni keyword scarica la pagina di ricerca via
// Playwright (i dati sono server-rendered, niente API JSON separata) ed
// estrae titolo, prezzo, località e URL dei nuovi annunci trovati. La pagina
// di ricerca non riporta la data di pubblicazione né la foto, quindi per ogni
// annuncio nuovo (o già salvato ma senza questi campi) si apre anche la
// pagina di dettaglio, scrivendo il risultato su
// src/data/monitoraggio-subito.json su GitHub.

import { chromium } from "playwright";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/monitoraggio-subito.json";
const DEFAULT_REGION = "lombardia";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${token}`,
  Accept: "application/vnd.github.v3+json",
};

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    headers: ghHeaders,
  });

  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata monitoraggio-subito.json fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }

  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;

  const rawRes = await fetch(rawUrl, {
    headers: { "User-Agent": "subito-monitoring-sync", Accept: "application/json" },
  });

  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw monitoraggio-subito.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { keywords: [] };

  if (!Array.isArray(store.keywords)) store.keywords = [];

  return { store, sha };
}

async function writeStore(store, sha) {
  const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: sync monitoraggio-subito posts [trendzn-bot]",
      content,
      sha,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Scrittura monitoraggio-subito.json fallita: ${res.status} ${await res.text()}`,
    );
  }
}

function normalize(value) {
  return (value || "")
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("")
    .toLowerCase();
}

function matchesKeyword(title, keyword) {
  return normalize(title).includes(normalize(keyword));
}

function searchUrl(keyword, region) {
  return `https://www.subito.it/annunci-${region}/vendita/usato/?q=${encodeURIComponent(keyword)}`;
}

async function scrapeListings(page, keyword, region) {
  await page.goto(searchUrl(keyword, region), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

  const raw = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("article")).map((article) => {
      const link = article.querySelector('a[href*=".htm"]');
      const title = article.querySelector("h3")?.textContent?.trim() || null;
      const price = article.querySelector('[class*="price__"]')?.textContent?.trim() || null;
      const location = article.querySelector('[class*="location"]')?.textContent?.trim() || null;
      return { url: link?.href || null, title, price, location };
    });
  });

  return raw.filter((item) => item.url && item.title);
}

// Offset (in minuti) tra l'ora di Roma e UTC nell'istante indicato: Roma =
// UTC + offset. Calcolato via Intl invece che hardcoded per gestire ora
// legale/solare senza una libreria di date esterna.
function romeOffsetMinutes(reference) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(fmt.formatToParts(reference).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return (asUTC - reference.getTime()) / 60000;
}

// Subito.it mostra solo date relative ("Oggi alle 16:40", "Ieri alle 10:12",
// "3 giorni fa", ...). Interpretiamo in modo affidabile solo "oggi"/"ieri"
// (il caso che interessa per un monitoraggio dei più recenti); per gli altri
// formati teniamo comunque il testo grezzo mostrato da Subito.it.
function parsePublishedAt(label, now = new Date()) {
  if (!label) return null;

  const match = label.match(/^(oggi|ieri) alle (\d{1,2}):(\d{2})$/i);
  if (!match) return null;

  const [, day, hh, mm] = match;
  const offsetMin = romeOffsetMinutes(now);

  const romeFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const romeParts = Object.fromEntries(romeFmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayOffset = day.toLowerCase() === "ieri" ? -1 : 0;

  const asUTC = Date.UTC(
    Number(romeParts.year),
    Number(romeParts.month) - 1,
    Number(romeParts.day) + dayOffset,
    Number(hh),
    Number(mm),
    0,
  );

  return new Date(asUTC - offsetMin * 60000).toISOString();
}

async function fetchListingDetails(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  const { publishedAtLabel, imageUrl } = await page.evaluate(() => {
    const publishedAtLabel =
      document.querySelector('[class*="insertion-date"]')?.textContent?.trim() || null;
    const imageUrl = document.querySelector('meta[property="og:image"]')?.content || null;
    return { publishedAtLabel, imageUrl };
  });

  return { publishedAtLabel, imageUrl, publishedAt: parsePublishedAt(publishedAtLabel) };
}

// --- Main ---
const { store, sha } = await readStore();

const browser = await chromium.launch();
const context = await browser.newContext({ userAgent: UA, locale: "it-IT" });
const page = await context.newPage();

let modified = false;

for (const entry of store.keywords) {
  const region = entry.region || DEFAULT_REGION;
  console.log(`Scraping "${entry.keyword}" (${region})...`);

  if (!Array.isArray(entry.listings)) entry.listings = [];

  let items;
  try {
    items = await scrapeListings(page, entry.keyword, region);
  } catch (err) {
    console.error(`  errore scraping "${entry.keyword}": ${String(err)}`);
    continue;
  }

  const relevant = items.filter((item) => matchesKeyword(item.title, entry.keyword));
  const existingUrls = new Set(entry.listings.map((l) => l.url));

  let added = 0;
  for (const item of relevant) {
    if (existingUrls.has(item.url)) continue;

    entry.listings.push({
      url: item.url,
      title: item.title,
      price: item.price,
      location: item.location,
      firstSeenAt: new Date().toISOString(),
      publishedAt: null,
      publishedAtLabel: null,
      imageUrl: null,
    });

    existingUrls.add(item.url);
    added++;
  }

  if (added > 0) {
    modified = true;
    console.log(`  +${added} nuovi annunci (${entry.listings.length} totali)`);
  } else {
    console.log("  nessun nuovo annuncio");
  }

  const toEnrich = entry.listings.filter((l) => !l.imageUrl || (!l.publishedAt && !l.publishedAtLabel));

  for (const listing of toEnrich) {
    try {
      const details = await fetchListingDetails(page, listing.url);
      listing.publishedAtLabel = details.publishedAtLabel;
      listing.publishedAt = details.publishedAt;
      listing.imageUrl = details.imageUrl;
      modified = true;
    } catch (err) {
      console.error(`  errore dettaglio "${listing.url}": ${String(err)}`);
    }
  }

  entry.listings.sort(
    (a, b) => new Date(b.publishedAt || b.firstSeenAt) - new Date(a.publishedAt || a.firstSeenAt),
  );
}

await browser.close();

if (!modified) {
  console.log("Nessuna novità, monitoraggio-subito.json non modificato.");
  process.exit(0);
}

await writeStore(store, sha);
console.log("monitoraggio-subito.json aggiornato su GitHub.");
