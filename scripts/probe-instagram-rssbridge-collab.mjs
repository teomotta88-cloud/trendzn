// Script diagnostico usa-e-getta: il probe precedente
// (probe-instagram-profile-feed.mjs) ha scoperto che Instagram reindirizza
// subito al login-wall una richiesta anonima diretta alla pagina profilo
// (/username/), quindi non possiamo scoprire i post di un account scrollando
// quella pagina. Qui proviamo la via alternativa già in produzione in questo
// repo per i Canali Inspo (vedi sync-canali-feed.mjs): usare RSS-Bridge come
// fonte della LISTA dei post di un account, e il rilevatore collab già
// validato per l'ANALISI di ciascun post trovato — RSS-Bridge fornisce gli
// URL, Playwright analizza ogni singolo URL esattamente come nei probe
// precedenti (che su singoli post hanno sempre funzionato, senza login-wall).
//
// La logica di fetch/rilevamento è in scripts/lib/ (instagram-rssbridge-feed.mjs,
// instagram-collab-detector.mjs) per essere riusabile dai worker di sync
// delle fasi successive senza duplicarla.
//
// Uso: node scripts/probe-instagram-rssbridge-collab.mjs <handle> [maxPosts]
// Richiede un'istanza RSS-Bridge raggiungibile su RSS_BRIDGE_BASE (default
// http://localhost:3000/ — il service container avviato dal workflow, stesso
// setup di sync-canali-feed.yml).

import { chromium } from "playwright";
import { fetchRecentPosts } from "./lib/instagram-rssbridge-feed.mjs";
import { detectCollaborators } from "./lib/instagram-collab-detector.mjs";

const handle = process.argv[2];
const maxPosts = Number(process.argv[3] || 10);
if (!handle) {
  console.error("Uso: node scripts/probe-instagram-rssbridge-collab.mjs <handle> [maxPosts]");
  process.exit(1);
}

console.log(`Interrogo RSS-Bridge per l'account "${handle}"...`);
const { posts, error } = await fetchRecentPosts(handle);

if (error) {
  console.error(`Errore RSS-Bridge: ${error}`);
  process.exit(1);
}

console.log(`\n=== RSS-Bridge ha restituito ${posts.length} post ===`);
for (const post of posts) {
  console.log(`- ${post.url} | autore: ${post.author} | data: ${post.publishedAt}`);
}

const dates = posts.map((p) => p.publishedAt).filter(Boolean).sort();
console.log(`\nPost più vecchio nel feed: ${dates[0] ?? "(nessuna data trovata)"}`);
console.log(`Post più recente nel feed: ${dates[dates.length - 1] ?? "(nessuna data trovata)"}`);

const postsToAnalyze = posts.slice(0, maxPosts);
console.log(`\n=== Analizzo ${postsToAnalyze.length} post per rilevare collab (max ${maxPosts}) ===`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

const results = [];
try {
  for (const post of postsToAnalyze) {
    const page = await context.newPage();
    try {
      await page.goto(post.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);

      const { collaborators, reason } = await detectCollaborators(page);
      if (reason) {
        results.push({ url: post.url, collaborators: null, verdict: reason });
        continue;
      }

      results.push({
        url: post.url,
        collaborators,
        verdict: collaborators.length >= 2 ? "COLLAB" : "singolo",
      });
    } catch (err) {
      results.push({ url: post.url, collaborators: null, verdict: `errore: ${String(err).slice(0, 150)}` });
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
