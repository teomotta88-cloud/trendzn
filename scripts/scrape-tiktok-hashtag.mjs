// Estrae gli URL dei post pubblici mostrati nella pagina hashtag di TikTok.
// Uso: node scrape-tiktok-hashtag.mjs <hashtag>
// Stampa su stdout un array JSON di URL.
//
// Note:
// - TikTok carica i post via scroll infinito: lo script scrolla la pagina più volte
//   per far apparire più video prima di leggere il DOM.
// - Il markup di TikTok cambia spesso: se lo script smette di trovare link,
//   aggiorna VIDEO_LINK_SELECTOR ispezionando un link a un video sulla pagina hashtag.
// - Non usa cookie/token: legge solo ciò che è visibile pubblicamente nel DOM.

import { chromium } from "playwright";

const VIDEO_LINK_SELECTOR = 'a[href*="/video/"]';
const SCROLL_STEPS = 8;
const SCROLL_DELAY_MS = 1500;

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

    const hrefs = await page.$$eval(VIDEO_LINK_SELECTOR, (els) =>
      els.map((el) => el.getAttribute("href")).filter(Boolean),
    );

    return Array.from(
      new Set(hrefs.map((h) => (h.startsWith("http") ? h : `https://www.tiktok.com${h}`))),
    );
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
  const urls = await scrapeHashtag(tag);
  console.log(JSON.stringify(urls, null, 2));
  console.error(`\nTrovati ${urls.length} URL per #${tag}`);
}
