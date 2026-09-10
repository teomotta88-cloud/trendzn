// Script diagnostico usa-e-getta (stesso spirito di probe-instagram-post.mjs e
// probe-instagram-collab.mjs): apre la pagina profilo pubblica di un account
// Instagram con Playwright (visitatore anonimo, nessun login) e misura DUE
// cose separate, sullo stesso profilo:
//
//   1. Quanti post della griglia si vedono in UNA visita, prima che scatti
//      il login-wall o lo scroll si esaurisca.
//   2. Se VISITE INDIPENDENTI (sessione anonima fresca ogni volta, come
//      farebbe un run schedulato ripetuto nel tempo) trovano campioni
//      diversi — e quindi sommandole si recupera più del tetto di una sola
//      visita — o se ripescano sempre esattamente gli stessi post.
//
// La domanda (2) è la stessa che ha già cambiato la strategia sullo scraping
// hashtag TikTok (vedi scrape-tiktok-hashtag-deep.mjs): lì passate multiple
// trovavano campioni diversi e sommarle serviva. Qui si misura se vale lo
// stesso per i profili Instagram, invece di darlo per scontato.
//
// Ogni visita usa un browser context NUOVO (cookie/localStorage azzerati):
// è la simulazione più fedele di run realmente separati nel tempo che si
// possa fare dentro un solo script, senza dover lanciare il workflow più
// volte a mano.
//
// Uso: node scripts/probe-instagram-profile-feed.mjs <url-profilo-instagram>
// Env: NUM_VISITE (default 3), MAX_SCROLLS (default 40)
//
// Nota ToS: come gli altri probe di questa famiglia, legge solo ciò che
// Instagram mostra pubblicamente a un visitatore anonimo — resta comunque una
// lettura automatizzata non prevista dai Termini di Servizio.

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/probe-instagram-profile-feed.mjs <url-profilo-instagram>");
  process.exit(1);
}

const NUM_VISITE = Number.parseInt(process.env.NUM_VISITE ?? "3", 10);
const MAX_SCROLLS = Number.parseInt(process.env.MAX_SCROLLS ?? "40", 10);
const STALL_LIMIT = 3;

// Le date sono opzionali sui thumbnail della griglia (Instagram le mette
// nell'alt text solo per alcuni tipi di contenuto, vedi output). Copriamo
// inglese e italiano, stesso approccio di instagram-public-metrics.mjs.
const ALT_DATE_PATTERN =
  /\bon\s+([a-zàèéìòù]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[a-zàèéìòù]+\s+\d{4})/i;

function isLoginWallUrl(pageUrl) {
  return /\/(accounts\/login|challenge)/.test(pageUrl);
}

async function collectGridPosts(page) {
  return page.$$eval('a[href^="/"]', (nodes) =>
    nodes
      .map((n) => {
        const img = n.querySelector("img");
        return {
          href: n.getAttribute("href"),
          alt: img ? img.getAttribute("alt") : null,
        };
      })
      .filter((n) => n.href && /^\/[A-Za-z0-9._]+\/(p|reel)\/[^/]+\/?$/.test(n.href)),
  );
}

// Una visita completa: browser context fresco (nessun cookie/localStorage
// ereditato dalle visite precedenti), scroll fino a stallo/login-wall/tetto,
// stessa diagnostica di prima (meta tag, script con dati strutturati, date
// leggibili) più il conteggio che qui interessa davvero.
async function visita(browser, indice) {
  console.log(`\n\n########## VISITA ${indice + 1}/${NUM_VISITE} (sessione anonima fresca) ##########`);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    console.log(`Navigo verso: ${url}`);
    const response = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch((e) => {
        console.log("Errore di navigazione:", e.message);
        return null;
      });
    console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
    console.log("URL finale:", page.url());

    if (isLoginWallUrl(page.url())) {
      console.log("BLOCCATO SUBITO: Instagram ha reindirizzato a login/challenge già sulla pagina profilo.");
      return { indice, hrefs: new Set(), stoppedReason: "login-wall-immediato", oldestDate: null };
    }

    await page.waitForTimeout(3000);

    const scriptBlobs = await page.$$eval("script", (nodes) =>
      nodes
        .map((n) => ({ type: n.getAttribute("type"), text: n.textContent || "" }))
        .filter(
          (s) =>
            s.type === "application/ld+json" ||
            /_sharedData|additionalDataLoaded|__NEXT_DATA__/.test(s.text.slice(0, 200)),
        )
        .map((s) => ({ type: s.type, length: s.text.length })),
    );
    if (scriptBlobs.length > 0) {
      console.log(`Script con dati strutturati trovati: ${JSON.stringify(scriptBlobs)}`);
    }

    let stallCount = 0;
    let lastCount = 0;
    let stoppedReason = "max-scrolls-reached";

    for (let i = 0; i < MAX_SCROLLS; i++) {
      if (isLoginWallUrl(page.url())) {
        stoppedReason = `login-wall-dopo-${i}-scroll`;
        break;
      }

      const posts = await collectGridPosts(page);
      const uniqueHrefs = new Set(posts.map((p) => p.href));

      if (uniqueHrefs.size === lastCount) {
        stallCount++;
        if (stallCount >= STALL_LIMIT) {
          stoppedReason = `stallo-dopo-${i}-scroll-nessuna-crescita`;
          break;
        }
      } else {
        stallCount = 0;
      }
      lastCount = uniqueHrefs.size;

      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1500);
    }

    const finalPosts = await collectGridPosts(page);
    const dedup = [...new Map(finalPosts.map((p) => [p.href, p])).values()];
    const hrefs = new Set(dedup.map((p) => p.href));

    console.log(`Motivo di stop: ${stoppedReason}`);
    console.log(`Post distinti trovati in questa visita: ${hrefs.size}`);
    console.log("Href trovati (tutti):");
    console.log(JSON.stringify([...hrefs], null, 2));

    const parsedDates = dedup
      .map((p) => {
        const m = p.alt?.match(ALT_DATE_PATTERN);
        return m ? new Date(m[1]) : null;
      })
      .filter((d) => d && !Number.isNaN(d.getTime()));
    const oldestDate = parsedDates.length > 0 ? new Date(Math.min(...parsedDates)) : null;
    if (oldestDate) {
      const giorniIndietro = Math.round((Date.now() - oldestDate.getTime()) / 86_400_000);
      console.log(
        `Post più vecchio con data leggibile: ${oldestDate.toISOString().slice(0, 10)} (~${giorniIndietro} giorni fa)`,
      );
    } else {
      console.log("Nessuna data leggibile trovata in questa visita.");
    }

    return { indice, hrefs, stoppedReason, oldestDate };
  } finally {
    await context.close().catch(() => {});
  }
}

// --- Main ---
console.log(`=== Sonda profondità profilo Instagram: ${url} ===`);
console.log(`Parametri: ${NUM_VISITE} visite indipendenti, max ${MAX_SCROLLS} scroll a visita\n`);

const browser = await chromium.launch({ headless: true });
const risultati = [];

try {
  for (let i = 0; i < NUM_VISITE; i++) {
    risultati.push(await visita(browser, i));
    if (i < NUM_VISITE - 1) await new Promise((r) => setTimeout(r, 3000));
  }
} finally {
  await browser.close();
}

console.log("\n\n==================== RIEPILOGO");
for (const r of risultati) {
  console.log(`  Visita ${r.indice + 1}: ${r.hrefs.size} post (stop: ${r.stoppedReason})`);
}

// La domanda che conta: sommare le visite recupera più post del tetto di
// una sola, o sono sempre lo stesso identico campione? Per ogni visita dopo
// la prima si conta quanti href NON erano già apparsi in nessuna visita
// precedente — è la stessa identica logica con cui è stato misurato, per
// TikTok, che passate multiple sulle pagine hashtag trovavano campioni
// diversi (vedi probe-tiktok-hashtag-piu-video.mjs).
const unione = new Set();
console.log("\n  Post nuovi rispetto alle visite precedenti:");
for (const r of risultati) {
  const nuovi = [...r.hrefs].filter((h) => !unione.has(h));
  console.log(
    `    Visita ${r.indice + 1}: ${nuovi.length} nuovi` +
      (r.indice === 0 ? " (prima visita, tutti nuovi per definizione)" : ` rispetto alle ${r.indice} visite precedenti`),
  );
  for (const h of r.hrefs) unione.add(h);
}

const mediaPerVisita = risultati.length
  ? Math.round(risultati.reduce((n, r) => n + r.hrefs.size, 0) / risultati.length)
  : 0;
console.log(`\n  Media post per visita: ${mediaPerVisita}`);
console.log(`  UNIONE di tutte le ${NUM_VISITE} visite: ${unione.size} post distinti`);
console.log(
  unione.size > Math.max(...risultati.map((r) => r.hrefs.size))
    ? "  --> Sommare più visite recupera PIÙ post del tetto di una singola visita: campioni diversi tra un run e l'altro."
    : "  --> Le visite hanno trovato lo STESSO identico insieme di post: sommarle non aiuta, il tetto è per-profilo, non per-visita.",
);
