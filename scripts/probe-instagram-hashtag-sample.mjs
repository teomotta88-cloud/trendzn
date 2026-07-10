// Script diagnostico usa-e-getta: stima il tasso di successo reale della
// discovery gratuita via pagina hashtag Instagram (/explore/tags/<tag>/ ->
// /popular/<tag>/, vedi probe-instagram-hashtags.mjs) su un campione di
// hashtag REALI — i top-5 hashtag TikTok in trend e i top-5 topic Google
// Trends (convertiti in hashtag) attualmente prodotti dalla pipeline, non
// hashtag scelti a caso. Su un primo test con 3 hashtag arbitrari 1/3 è
// fallito con login wall e nessuna struttura URL alternativa ha funzionato
// (vedi probe-instagram-hashtag-fallback.mjs) — serve capire se il tasso di
// fallimento è simile sugli hashtag che il sistema genererebbe davvero,
// prima di decidere se costruire la pipeline di produzione.
//
// Uso: node scripts/probe-instagram-hashtag-sample.mjs
//
// Nota: nessun cookie/sessione di login.

import { chromium } from "playwright";
import { fetchGoogleTrendsIT } from "./lib/google-trends.mjs";
import { keywordToHashtag } from "./lib/word-segment.mjs";

const TOP_HASHTAGS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/top-tiktok-hashtags";
const MAX_PER_SOURCE = 5;

async function fetchTikTokHashtags() {
  try {
    const res = await fetch(`${TOP_HASHTAGS_ENDPOINT}?limit=${MAX_PER_SOURCE}`);
    if (!res.ok) throw new Error(`top-tiktok-hashtags failed (${res.status})`);
    const data = await res.json();
    if (!data.ok) throw new Error(`top-tiktok-hashtags error: ${data.error}`);
    return (data.hashtags ?? []).map((tag) => ({
      source: "tiktok-hashtag",
      label: `#${tag}`,
      tag,
    }));
  } catch (err) {
    console.error(`Impossibile leggere i top hashtag TikTok: ${String(err)}`);
    return [];
  }
}

async function fetchGoogleTrendsHashtags() {
  try {
    const trends = await fetchGoogleTrendsIT();
    return trends.slice(0, MAX_PER_SOURCE).map((t) => {
      const tag = keywordToHashtag(t.title);
      return { source: "google-trends", label: `"${t.title}" -> #${tag}`, tag };
    });
  } catch (err) {
    console.error(`Impossibile leggere Google Trends: ${String(err)}`);
    return [];
  }
}

async function probeHashtag(context, tag) {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  const page = await context.newPage();
  try {
    const response = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch((e) => {
        console.log(`  Errore di navigazione: ${e.message}`);
        return null;
      });
    if (!response) return { ok: false, reason: "nessuna risposta" };

    await page.waitForTimeout(4000);
    const finalUrl = page.url();

    if (finalUrl.includes("/accounts/login")) {
      return { ok: false, reason: "login wall" };
    }

    const postLinks = await page.$$eval("a[href]", (nodes) =>
      nodes
        .map((n) => n.getAttribute("href"))
        .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
    );
    const count = [...new Set(postLinks)].length;
    if (count === 0) return { ok: false, reason: "nessun link trovato (esito inatteso)" };

    return { ok: true, count };
  } finally {
    await page.close();
  }
}

// --- Main ---
console.log("=== Probe hashtag Instagram su campione reale ===\n");

const items = [...(await fetchTikTokHashtags()), ...(await fetchGoogleTrendsHashtags())];
console.log(
  `Campione: ${items.length} hashtag (${MAX_PER_SOURCE} TikTok + ${MAX_PER_SOURCE} Google Trends)\n`,
);

if (items.length === 0) {
  console.log("Nessun hashtag da testare.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

const results = [];
try {
  for (const item of items) {
    process.stdout.write(`[${item.source}] ${item.label} ... `);
    const result = await probeHashtag(context, item.tag);
    results.push({ ...item, ...result });
    console.log(result.ok ? `OK (${result.count} reel trovati)` : `FALLITO (${result.reason})`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
} finally {
  await browser.close();
}

const successes = results.filter((r) => r.ok).length;
console.log(`\n=== Riepilogo: ${successes}/${results.length} riusciti ===`);
for (const r of results) {
  console.log(
    `  ${r.ok ? "OK" : "FALLITO"} [${r.source}] ${r.label}${r.ok ? ` (${r.count})` : ` — ${r.reason}`}`,
  );
}
