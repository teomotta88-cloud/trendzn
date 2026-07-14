// Script diagnostico usa-e-getta: X.com blocca l'accesso anonimo (il probe
// probe-x-trending.mjs ha confermato il redirect al login), quindi per la
// lista dei trend X in Italia + i volumi si punta a un aggregatore pubblico
// che ripubblica i trend senza login. Questo probe sonda i due candidati
// noti — getdaytrends.com/italy e trends24.in/italy — e stampa cosa espongono
// (nomi dei trend, eventuali volumi "N Tweet", struttura HTML) così da
// scegliere quale usare e con quali selettori costruire la pipeline. Nessuna
// pipeline lo consuma: serve solo a raccogliere dati reali prima di decidere.
//
// Uso: node scripts/probe-x-trends-aggregator.mjs
//
// Nessun login, nessuna chiave: sono siti pubblici server-rendered.

import { chromium } from "playwright";

const TARGETS = [
  { label: "getdaytrends.com/italy", url: "https://getdaytrends.com/italy/" },
  { label: "trends24.in/italy", url: "https://trends24.in/italy/" },
];

// Testo tipo "12.5K", "1,2 mila", "3.400 Tweet", "under 10K Tweets".
const VOLUME_RE = /([\d.,]+\s*(k|mila|mln|m|tweet|post)\b|under\s+[\d.,]+k)/gi;

async function probe(page, label, url) {
  console.log(`\n\n########## ${label} — ${url} ##########`);
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      console.log("Errore di navigazione:", e.message);
      return null;
    });
  console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
  await page.waitForTimeout(3000);
  console.log("URL finale:", page.url());
  console.log("Titolo:", await page.title().catch(() => "(n/d)"));

  // Prova diversi selettori plausibili per la lista trend, così vediamo quale
  // rende e con che testo. Non sappiamo la struttura esatta: li proviamo tutti
  // e stampiamo i primi elementi non vuoti di ciascuno.
  const selectors = [
    "ol li a",
    "ol li",
    ".trend-card li",
    ".trend-card__list li",
    ".trend-name",
    "[class*='trend'] a",
    "table tr",
    "a[href*='twitter.com/search']",
    "a[href*='x.com/search']",
  ];
  for (const sel of selectors) {
    const texts = await page
      .$$eval(sel, (nodes) =>
        nodes
          .map((n) => n.textContent?.trim())
          .filter(Boolean)
          .slice(0, 15),
      )
      .catch(() => []);
    if (texts.length > 0) {
      console.log(`\n--- selettore "${sel}": ${texts.length} elementi (primi 15) ---`);
      console.log(JSON.stringify(texts, null, 2));
    }
  }

  // Cerca esplicitamente numeri di volume nel testo visibile.
  const bodyText = await page.innerText("body").catch(() => "");
  const volumes = [...bodyText.matchAll(VOLUME_RE)].map((m) => m[0]).slice(0, 30);
  console.log(`\n--- occorrenze di volume ("N Tweet"/"N K"/"N mila"): ${volumes.length} ---`);
  console.log(JSON.stringify(volumes, null, 2));

  console.log("\n--- primi 2000 caratteri del testo visibile ---");
  console.log(bodyText.slice(0, 2000));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "it-IT",
});

try {
  for (const t of TARGETS) {
    await probe(page, t.label, t.url);
  }
} finally {
  await browser.close();
}
