// Script diagnostico usa-e-getta: misura quanto indietro nel tempo riesce
// davvero ad arrivare lo scroll sulla pagina hashtag di Instagram
// (/explore/tags/<hashtag>/), per decidere se è una fonte utilizzabile
// (anche solo parzialmente) per il backfill storico 2025 richiesto dal
// confronto YoY di Bluserena-monitoring. Nessuna scrittura su store: solo
// output in console.
//
// A differenza della sync di produzione (sync-bluserena-hashtags.mjs, tarata
// per "prendi i post recenti ogni 3 ore", si ferma dopo 15 round o 3 round
// stagnanti), qui si spinge lo scroll molto più a fondo per vedere il limite
// reale della griglia "popular" di Instagram — che (vedi nota in
// discover-instagram-hashtag-content.mjs) NON è un archivio cronologico, ma
// un mix di post recenti e post vecchi-ma-ancora-popolari: anche uno scroll
// molto profondo può restituire un campione parziale e non rappresentativo
// di "tutto ciò che è stato pubblicato" in un dato periodo.
//
// Uso: node scripts/probe-instagram-hashtag-depth.mjs <hashtag>
// Env opzionali:
//   MAX_SCROLL_ROUNDS (default 150)
//   STAGNANT_ROUNDS_TO_STOP (default 6)
//   DATE_SAMPLE_SIZE (default 60) — la data si recupera solo per un campione
//     distribuito uniformemente sui link trovati, non su tutti: ogni
//     richiesta è una nuova pagina Instagram, con relativo rischio di
//     login-wall (vedi instagram-public-metrics.mjs). Un campione uniforme
//     sull'intero elenco copre meglio l'intervallo temporale di un campione
//     preso solo dai primi post trovati.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";

const tag = process.argv[2];
if (!tag) {
  console.error("Uso: node scripts/probe-instagram-hashtag-depth.mjs <hashtag>");
  process.exit(1);
}

const MAX_SCROLL_ROUNDS = parseInt(process.env.MAX_SCROLL_ROUNDS ?? "150", 10);
const STAGNANT_ROUNDS_TO_STOP = parseInt(process.env.STAGNANT_ROUNDS_TO_STOP ?? "6", 10);
const DATE_SAMPLE_SIZE = parseInt(process.env.DATE_SAMPLE_SIZE ?? "60", 10);
const SCROLL_WAIT_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log(`=== Probe profondità hashtag Instagram: #${tag} ===`);
console.log(
  `Scroll fino a ${MAX_SCROLL_ROUNDS} round (stop dopo ${STAGNANT_ROUNDS_TO_STOP} round consecutivi senza novità)\n`,
);

const session = await openInstagramMetricsSession();
const page = await session.context.newPage();

const collected = new Set();
let stagnantRounds = 0;
let stoppedAtRound = MAX_SCROLL_ROUNDS;

try {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch(() => null);

  if (!response || page.url().includes("/accounts/login")) {
    console.log("FALLITO: login wall o nessuna risposta alla prima richiesta.");
    await page.close();
    await session.close();
    process.exit(1);
  }

  await page.waitForTimeout(4000);

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const found = await page.$$eval("a[href]", (nodes) =>
      nodes
        .map((n) => n.getAttribute("href"))
        .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
    );
    const before = collected.size;
    for (const href of found) {
      collected.add(new URL(href, "https://www.instagram.com").toString().split("?")[0]);
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

    if (round % 10 === 0) console.log(`  round ${round}: ${collected.size} post unici finora`);

    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(SCROLL_WAIT_MS);
  }
} finally {
  await page.close();
}

console.log(`\nScroll terminato al round ${stoppedAtRound}. Post unici trovati: ${collected.size}`);

if (collected.size === 0) {
  await session.close();
  process.exit(0);
}

const links = [...collected];
const sampleSize = Math.min(DATE_SAMPLE_SIZE, links.length);
const step = links.length / sampleSize;
const sample = Array.from({ length: sampleSize }, (_, i) => links[Math.floor(i * step)]);

console.log(`Recupero la data di pubblicazione per un campione di ${sample.length}/${links.length} post...\n`);

const dates = [];
let fetchFailures = 0;
for (const sampleUrl of sample) {
  const { metrics, reason } = await session.fetchMetricsDetailed(sampleUrl);
  if (metrics?.publishedAt) {
    dates.push(new Date(metrics.publishedAt));
  } else {
    fetchFailures++;
    if (reason === "login-wall") {
      console.log("  Login wall incontrato durante il campionamento, interrompo qui.");
      break;
    }
  }
  await sleep(1000);
}

await session.close();

if (dates.length === 0) {
  console.log("\nNessuna data recuperata dal campione (tutti i tentativi falliti).");
  process.exit(0);
}

dates.sort((a, b) => a.getTime() - b.getTime());
const oldest = dates[0];
const newest = dates[dates.length - 1];

const byMonth = new Map();
for (const d of dates) {
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
}

console.log("=== Risultato ===");
console.log(`Date recuperate: ${dates.length}/${sample.length} (${fetchFailures} falliti)`);
console.log(`Post più vecchio nel campione: ${oldest.toISOString().slice(0, 10)}`);
console.log(`Post più recente nel campione: ${newest.toISOString().slice(0, 10)}`);
console.log("Distribuzione per mese:");
for (const [month, count] of [...byMonth.entries()].sort()) {
  console.log(`  ${month}: ${count}`);
}
