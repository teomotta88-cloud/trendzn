// Script diagnostico usa-e-getta: misura quanto indietro nel tempo riesce
// davvero ad arrivare lo scroll sulla pagina hashtag di TikTok
// (/tag/<hashtag>), per decidere se è una fonte utilizzabile (anche solo
// parzialmente) per il backfill storico 2025 richiesto dal confronto YoY di
// Bluserena-monitoring. Nessuna scrittura su store: solo output in console.
//
// A differenza di scripts/scrape-tiktok-hashtag.mjs (tarato per "prendi i
// video recenti ogni giro", SCROLL_STEPS=8 fisso), qui lo scroll è molto più
// profondo e configurabile. La data di ogni video si ricava GRATIS dall'ID
// nell'URL (stessa tecnica, proven, già usata in sync-bluserena-hashtags.mjs
// — nessuna richiesta di rete aggiuntiva), quindi qui si può calcolare la
// data per OGNI video trovato, non solo per un campione come nel probe
// equivalente per Instagram.
//
// Uso: node scripts/probe-tiktok-hashtag-depth.mjs <hashtag>
// Env opzionali:
//   MAX_SCROLL_ROUNDS (default 150)
//   STAGNANT_ROUNDS_TO_STOP (default 6)

import { chromium } from "playwright";

const tag = process.argv[2];
if (!tag) {
  console.error("Uso: node scripts/probe-tiktok-hashtag-depth.mjs <hashtag>");
  process.exit(1);
}

const MAX_SCROLL_ROUNDS = parseInt(process.env.MAX_SCROLL_ROUNDS ?? "150", 10);
const STAGNANT_ROUNDS_TO_STOP = parseInt(process.env.STAGNANT_ROUNDS_TO_STOP ?? "6", 10);
const SCROLL_WAIT_MS = 1500;

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Stessa tecnica di tiktokDateFromVideoId in sync-bluserena-hashtags.mjs:
// i primi 32 bit dell'ID video (snowflake) sono un timestamp Unix in secondi.
function dateFromVideoId(url) {
  const videoId = url.match(/\/video\/(\d+)/)?.[1];
  if (!videoId) return null;
  try {
    const id = BigInt(videoId);
    const timestampSeconds = Number(id >> 32n);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null;
    const date = new Date(timestampSeconds * 1000);
    const min = new Date("2016-01-01T00:00:00.000Z").getTime();
    const max = Date.now() + 24 * 60 * 60 * 1000;
    if (date.getTime() < min || date.getTime() > max) return null;
    return date;
  } catch {
    return null;
  }
}

console.log(`=== Probe profondità hashtag TikTok: #${tag} ===`);
console.log(
  `Scroll fino a ${MAX_SCROLL_ROUNDS} round (stop dopo ${STAGNANT_ROUNDS_TO_STOP} round consecutivi senza novità)\n`,
);

const url = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ userAgent: REAL_CHROME_UA });

const collected = new Set();
let stagnantRounds = 0;
let stoppedAtRound = MAX_SCROLL_ROUNDS;

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const hrefs = await page.$$eval('a[href*="/video/"]', (nodes) =>
      nodes.map((n) => n.getAttribute("href")).filter(Boolean),
    );
    const before = collected.size;
    for (const href of hrefs) {
      collected.add(href.startsWith("http") ? href : `https://www.tiktok.com${href}`);
    }

    if (collected.size === before) {
      stagnantRounds++;
      if (stagnantRounds >= STAGNANT_ROUNDS_TO_STOP) {
        stoppedAtRound = round;
        break;
      }
    } else {
      stagnantRounds = 0;
    }

    if (round % 10 === 0) console.log(`  round ${round}: ${collected.size} video unici finora`);

    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(SCROLL_WAIT_MS);
  }
} finally {
  await browser.close();
}

console.log(`\nScroll terminato al round ${stoppedAtRound}. Video unici trovati: ${collected.size}`);

if (collected.size === 0) {
  process.exit(0);
}

const dated = [];
let noDate = 0;
for (const videoUrl of collected) {
  const date = dateFromVideoId(videoUrl);
  if (date) dated.push(date);
  else noDate++;
}

if (dated.length === 0) {
  console.log("\nNessuna data ricavabile dagli URL trovati (formato inatteso?).");
  process.exit(0);
}

dated.sort((a, b) => a.getTime() - b.getTime());
const oldest = dated[0];
const newest = dated[dated.length - 1];

const byMonth = new Map();
for (const d of dated) {
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
}

console.log("\n=== Risultato ===");
console.log(`Date ricavate: ${dated.length}/${collected.size} (${noDate} senza data valida)`);
console.log(`Video più vecchio: ${oldest.toISOString().slice(0, 10)}`);
console.log(`Video più recente: ${newest.toISOString().slice(0, 10)}`);
console.log("Distribuzione per mese:");
for (const [month, count] of [...byMonth.entries()].sort()) {
  console.log(`  ${month}: ${count}`);
}
