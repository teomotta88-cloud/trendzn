// Verifica se sia possibile recuperare fino a 5 post di una pagina Facebook
// (limite osservato finora con www.facebook.com: affidabile solo il post più
// recente, vedi probe-facebook-page.mjs) usando due approcci alternativi:
//
// 1. RSS-Bridge (FacebookBridge) — già usato nel progetto per IG/TikTok via
//    lo stesso container docker, scrape ?_fb_noscript=1 su www.facebook.com,
//    supporta un parametro "limit". Selettori CSS nel bridge sembrano
//    datati (pagelet_timeline_main_column, classi hash tipo _585r): va
//    verificato se funziona ancora sulla Facebook attuale.
// 2. mbasic.facebook.com — versione HTML minimale, storicamente meno
//    soggetta a wall di login per contenuti pubblici. Testata sia con un
//    fetch semplice (se è davvero no-JS, niente browser necessario) sia con
//    Playwright come fallback.

import { chromium } from "playwright";

const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";
const PAGES = (process.env.PROBE_PAGES || "agenitalia.it,chilhavisto,AnsaNapoli,salviniofficial")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function testRssBridge(handle) {
  const url = `${RSS_BRIDGE_BASE}?action=display&bridge=Facebook&context=User&u=${encodeURIComponent(handle)}&limit=5&format=JSON`;
  console.log(`\n  [rss-bridge] GET ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    console.log(`    status: ${res.status}`);
    const text = await res.text();

    if (!res.ok) {
      console.log(`    body (errore): ${text.slice(0, 1500)}`);
      return;
    }

    const data = JSON.parse(text);
    const items = data.items ?? [];
    console.log(`    items trovati: ${items.length}`);
    items.slice(0, 5).forEach((item, i) => {
      const date = item.date_published || item.date_modified || null;
      const title = (item.title || "").replace(/\s+/g, " ").slice(0, 100);
      console.log(`      #${i + 1} url=${item.url} date=${date} title=${JSON.stringify(title)}`);
    });
  } catch (err) {
    console.log(`    errore: ${String(err)}`);
  }
}

async function testMbasicFetch(handle) {
  const url = `https://mbasic.facebook.com/${encodeURIComponent(handle)}`;
  console.log(`\n  [mbasic fetch] GET ${url}`);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
        "Accept-Language": "it-IT,it;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    console.log(`    status: ${res.status}  final url: ${res.url}`);

    const html = await res.text();
    console.log(`    html length: ${html.length}`);

    const looksLikeLoginWall =
      /accedi a facebook|log in to facebook/i.test(html) && /password/i.test(html);
    console.log(`    sembra login wall: ${looksLikeLoginWall}`);

    const storyLinkMatches = html.match(/story_fbid=\d+|\/story\.php\?story_fbid/g) || [];
    console.log(`    occorrenze link post (story_fbid): ${storyLinkMatches.length}`);

    console.log(`    snippet: ${html.replace(/\s+/g, " ").slice(0, 500)}`);
  } catch (err) {
    console.log(`    errore: ${String(err)}`);
  }
}

async function testMbasicPlaywright(browser, handle) {
  const url = `https://mbasic.facebook.com/${encodeURIComponent(handle)}`;
  console.log(`\n  [mbasic playwright] GET ${url}`);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    locale: "it-IT",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    const title = await page.title();
    const finalUrl = page.url();
    const storyLinkCount = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      return links.filter((a) =>
        /story_fbid=|\/story\.php|\/posts\//.test(a.getAttribute("href") || ""),
      ).length;
    });
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "");

    console.log(`    final url: ${finalUrl}`);
    console.log(`    title: ${JSON.stringify(title)}`);
    console.log(`    story-link count: ${storyLinkCount}`);
    console.log(`    body snippet: ${bodyText.replace(/\s+/g, " ")}`);
  } catch (err) {
    console.log(`    errore: ${String(err)}`);
  } finally {
    await context.close();
  }
}

console.log("=== Probe fonti alternative Facebook (fino a 5 post) ===");
console.log(`pagine testate: ${PAGES.join(", ")}`);

const browser = await chromium.launch({ headless: true });

try {
  for (const handle of PAGES) {
    console.log(`\n========== ${handle} ==========`);
    await testRssBridge(handle);
    await testMbasicFetch(handle);
    await testMbasicPlaywright(browser, handle);
  }
} finally {
  await browser.close();
}

console.log("\n=== Fine probe ===");
