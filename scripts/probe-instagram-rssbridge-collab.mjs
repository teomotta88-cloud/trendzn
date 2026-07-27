// Script diagnostico usa-e-getta: il probe precedente
// (probe-instagram-profile-feed.mjs) ha scoperto che Instagram reindirizza
// subito al login-wall una richiesta anonima diretta alla pagina profilo
// (/username/), quindi non possiamo scoprire i post di un account scrollando
// quella pagina. Qui proviamo la via alternativa già in produzione in questo
// repo per i Canali Inspo (vedi sync-canali-feed.mjs): usare RSS-Bridge come
// fonte della LISTA dei post di un account, e il rilevatore collab già
// validato (vedi probe-instagram-collab.mjs) per l'ANALISI di ciascun post
// trovato — RSS-Bridge fornisce gli URL, Playwright analizza ogni singolo
// URL esattamente come nei probe precedenti (che su singoli post hanno
// sempre funzionato, senza login-wall).
//
// Uso: node scripts/probe-instagram-rssbridge-collab.mjs <handle> [maxPosts]
// Richiede un'istanza RSS-Bridge raggiungibile su RSS_BRIDGE_BASE (default
// http://localhost:3000/ — il service container avviato dal workflow, stesso
// setup di sync-canali-feed.yml).

import { chromium } from "playwright";

// trim + rimozione di un eventuale "@": un handle con spazi/simboli attorno
// (facile da introdurre incollando l'input in workflow_dispatch) altrimenti
// finisce url-encoded dentro la query RSS-Bridge (es. "factanza " ->
// "u=factanza%20") e la richiesta fallisce silenziosamente, senza errore
// esplicito — solo un item fittizio senza post reali.
const handle = process.argv[2]?.trim().replace(/^@/, "");
const maxPosts = Number(process.argv[3] || 10);
if (!handle) {
  console.error("Uso: node scripts/probe-instagram-rssbridge-collab.mjs <handle> [maxPosts]");
  process.exit(1);
}

const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";

function rssBridgeUrl(h) {
  return `${RSS_BRIDGE_BASE}?action=display&bridge=Instagram&context=Username&u=${h}&format=JSON`;
}

function isPostUrl(url) {
  return /\/p\/|\/reel\/|\/reels\//.test(url || "");
}

console.log(`Interrogo RSS-Bridge per l'account "${handle}"...`);
const feedUrl = rssBridgeUrl(handle);
const res = await fetch(feedUrl, { signal: AbortSignal.timeout(20000) }).catch((e) => {
  console.error("Errore chiamata RSS-Bridge:", e.message);
  return null;
});

if (!res || !res.ok) {
  console.error(`RSS-Bridge ha risposto ${res ? res.status : "(nessuna risposta)"}`);
  if (res) console.error(await res.text().catch(() => "(corpo non leggibile)"));
  process.exit(1);
}

const data = await res.json();
const items = data.items ?? [];
console.log(`\n=== RSS-Bridge ha restituito ${items.length} item ===`);
for (const item of items) {
  console.log(`- ${item.url} | autore: ${item.author?.name} | data: ${item.date_modified || item.date_published}`);
}

const dates = items.map((i) => i.date_modified || i.date_published).filter(Boolean).sort();
console.log(`\nPost più vecchio nel feed: ${dates[0] ?? "(nessuna data trovata)"}`);
console.log(`Post più recente nel feed: ${dates[dates.length - 1] ?? "(nessuna data trovata)"}`);

const postItems = items.filter((i) => isPostUrl(i.url)).slice(0, maxPosts);
console.log(`\n=== Analizzo ${postItems.length} post per rilevare collab (max ${maxPosts}) ===`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

const results = [];
try {
  for (const item of postItems) {
    const page = await context.newPage();
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (/\/(accounts\/login|challenge)/.test(page.url())) {
        results.push({ url: item.url, collaborators: null, verdict: "login-wall" });
        continue;
      }
      await page.waitForTimeout(2500);

      // Stessa euristica validata in probe-instagram-collab.mjs: link a
      // profilo entro i primi ~600px della pagina.
      const profileLinks = await page.$$eval('a[href^="/"]', (nodes) =>
        nodes
          .map((n) => {
            const rect = n.getBoundingClientRect();
            return { href: n.getAttribute("href"), top: Math.round(rect.top) };
          })
          .filter((n) => n.href && /^\/[A-Za-z0-9._]+\/?$/.test(n.href)),
      );
      const seen = new Set();
      const dedup = profileLinks.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
      const topProfiles = dedup.filter((p) => p.top < 600 && p.top > -50);

      results.push({
        url: item.url,
        collaborators: topProfiles.map((p) => p.href.replace(/\//g, "")),
        verdict: topProfiles.length >= 2 ? "COLLAB" : "singolo",
      });
    } catch (err) {
      results.push({ url: item.url, collaborators: null, verdict: `errore: ${String(err).slice(0, 150)}` });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log("\n=== Risultati rilevamento collab ===");
console.log(JSON.stringify(results, null, 2));

const collabCount = results.filter((r) => r.verdict === "COLLAB").length;
console.log(`\n${collabCount}/${results.length} post analizzati risultano in collab.`);
