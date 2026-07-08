// Estrae gli URL (e, quando disponibile, il numero di views) dei post
// pubblici mostrati nella pagina hashtag di TikTok.
// Uso: node scrape-tiktok-hashtag.mjs <hashtag>
// Stampa su stdout un array JSON di {url, views}.
//
// Note:
// - TikTok carica i post via scroll infinito: lo script scrolla la pagina più volte
//   per far apparire più video prima di leggere il DOM.
// - Il markup di TikTok cambia spesso: se lo script smette di trovare link,
//   aggiorna VIDEO_LINK_SELECTOR ispezionando un link a un video sulla pagina hashtag.
// - Le views sono best-effort: proviamo prima i selettori data-e2e noti
//   (confermati per la pagina profilo utente da TikTokBridge.php di RSS-Bridge,
//   non ancora verificati su un run reale per la pagina hashtag — TikTok riusa
//   spesso lo stesso componente "card video" tra profilo/hashtag/ricerca, ma
//   va confermato), poi un fallback generico che cerca un testo tipo "129.5K"
//   tra i discendenti del link. Se nessuno funziona, views resta null: non
//   deve mai far fallire l'estrazione degli URL, che è la parte che conta di più.
// - Non usa cookie/token: legge solo ciò che è visibile pubblicamente nel DOM.

import { chromium } from "playwright";

const VIDEO_LINK_SELECTOR = 'a[href*="/video/"]';
const SCROLL_STEPS = 8;
const SCROLL_DELAY_MS = 1500;

// "129.5K" / "2,431" / "1.2M" -> numero.
function parseViewsText(text) {
  if (!text) return null;
  const match = text
    .trim()
    .replace(/,/g, "")
    .match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  if (suffix === "B") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

async function extractLinksWithViews(page) {
  return page.$$eval(VIDEO_LINK_SELECTOR, (links) => {
    const VIEW_PATTERN = /^[\d.,]+[KMB]?$/i;
    const CANDIDATE_SELECTORS = ['[data-e2e="video-views"]', '[data-e2e="common-Video-Count"]'];

    function findViewsText(anchor) {
      let container = anchor.closest("div") || anchor.parentElement;
      for (let i = 0; i < 4 && container; i++) {
        for (const sel of CANDIDATE_SELECTORS) {
          const el = container.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        container = container.parentElement;
      }
      const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (VIEW_PATTERN.test(text)) return text;
      }
      return null;
    }

    return links.map((a) => ({ href: a.getAttribute("href"), viewsText: findViewsText(a) }));
  });
}

export async function scrapeHashtag(tag) {
  const url = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    for (let i = 0; i < SCROLL_STEPS; i++) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(SCROLL_DELAY_MS);
    }

    const links = await extractLinksWithViews(page);

    const seen = new Set();
    const posts = [];
    for (const { href, viewsText } of links) {
      if (!href) continue;
      const fullUrl = href.startsWith("http") ? href : `https://www.tiktok.com${href}`;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      posts.push({ url: fullUrl, views: parseViewsText(viewsText) });
    }

    const withViews = posts.filter((p) => p.views != null).length;
    console.error(`  Views estratte per ${withViews}/${posts.length} video.`);

    return posts;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Uso: node scrape-tiktok-hashtag.mjs <hashtag>");
    process.exit(1);
  }
  const posts = await scrapeHashtag(tag);
  console.log(JSON.stringify(posts, null, 2));
  console.error(`\nTrovati ${posts.length} URL per #${tag}`);
}
