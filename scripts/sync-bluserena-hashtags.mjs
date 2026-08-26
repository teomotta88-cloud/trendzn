// Monitoraggio delle PAGINE HASHTAG (Instagram, TikTok, X) aggiunte alla
// pagina "Bluserena-monitoring" — complementare a sync-bluserena-monitoring.mjs,
// che copre solo i PROFILI IG/TikTok. Stesso store (bluserena-monitoring.json,
// chiave "canali"): un hashtag aggiunto tramite "Aggiungi"/import Excel vive
// come un canale normale (id/name/urls/accounts), riconosciuto qui in base
// alla FORMA dell'URL (nessun campo extra nello store) — stesso criterio già
// usato lato UI in bluserena-monitoring.index.tsx/.$id.tsx:
//   Instagram: instagram.com/explore/tags/<tag>/
//   TikTok:    tiktok.com/tag/<tag>  (o /tags/<tag>)
//   X:         x.com/hashtag/<tag>   (o twitter.com)
//
// Per ogni post si cerca di recuperare: data di pubblicazione, utente che
// l'ha pubblicato, caption, geotag (se presente). Copertura reale per
// piattaforma (dettagli e affidabilità nei commenti delle rispettive
// sezioni più sotto):
//   - Instagram: tutti e quattro. Data/autore/caption confermati (stessa
//     tecnica già in produzione per la discovery Trend Virali, vedi
//     discover-instagram-hashtag-content.mjs — questo script riusa
//     scripts/lib/instagram-public-metrics.mjs invece di duplicarne il
//     parsing). Il geotag è stato aggiunto qui per la prima volta e NON è
//     stato verificato su un post geotaggato reale.
//   - TikTok: autore e data derivati dall'URL/ID del video (100% affidabili,
//     confermato su un run reale su #bluserena il 26/08/2026). La caption
//     via meta tag della pagina video era risultata sempre null sullo stesso
//     run (15/15): causa individuata nello User-Agent headless di default,
//     che TikTok riconosce servendo una pagina di login al posto del video
//     (vedi REAL_CHROME_UA più sotto) — fix applicato, in attesa di
//     riverifica su un nuovo run reale. Il geotag non è disponibile con
//     questa tecnica: resta sempre null.
//   - X: data/autore/caption confermati (rettiwt-api, stesso account già in
//     produzione per gli account X di ASPI-monitoring, vedi sync-x-posts.mjs,
//     qui con tweet.search({ hashtags: [...] }) invece di
//     { fromUsers: [...] }). Il geotag non è mai stato verificato come
//     campo disponibile nel modello Tweet di rettiwt-api: resta sempre null.
//
// Nessuna delle tre tecniche richiede credit anysite. Instagram e X restano
// "best effort" anche per i dati confermati (login-wall/blocchi possibili,
// vedi i commenti nei rispettivi moduli riusati) — un fallimento su un
// singolo hashtag o un singolo post non blocca gli altri.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";
import { scrapeHashtag as scrapeTikTokHashtag } from "./scrape-tiktok-hashtag.mjs";
import { Rettiwt } from "rettiwt-api";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;
const MAX_POSTS_PER_CHANNEL = 15;
// Instagram: la stessa soglia empirica documentata in
// discover-instagram-hashtag-content.mjs (~10 hashtag/sessione prima del
// login-wall) — qui gli hashtag sono curati a mano da un utente, non decine
// come nella discovery automatica, quindi nessuno sharding: se in futuro se
// ne aggiungono molti, questo limite andrà rivisto insieme al cron.
const MAX_POSTS_PER_INSTAGRAM_HASHTAG = parseInt(
  process.env.MAX_POSTS_PER_INSTAGRAM_HASHTAG ?? "30",
  10,
);
const TWEETS_PER_HASHTAG = parseInt(process.env.TWEETS_PER_HASHTAG ?? "10", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    headers: ghHeaders,
  });
  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata bluserena-monitoring.json fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }
  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;
  const rawRes = await fetch(rawUrl, {
    headers: {
      "User-Agent": "bluserena-hashtags-sync",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw bluserena-monitoring.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];
  return { store, sha };
}

// Come sync-x-posts.mjs: più script scrivono sullo stesso file
// (sync-bluserena-monitoring.mjs in parallelo), quindi rileggiamo e
// riproviamo su conflitto invece di fallire silenziosamente.
async function writeStore(store) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: sync hashtag Bluserena [trendzn-bot]",
        content,
        sha,
      }),
    });

    if (res.ok) return;

    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`,
      );
      continue;
    }

    throw new Error(
      `Scrittura bluserena-monitoring.json fallita: ${res.status} ${await res.text()}`,
    );
  }

  throw new Error("Troppi conflitti di scrittura su bluserena-monitoring.json.");
}

// Stesso criterio usato lato UI (bluserena-monitoring.index.tsx/.$id.tsx):
// riconosce una pagina hashtag dalla FORMA del path, nessun campo extra nello
// store.
function hashtagInfo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/$/, "");

  const igMatch = /^\/explore\/tags\/([^/]+)$/.exec(path);
  if (/instagram\.com$/.test(host) && igMatch) {
    return { platform: "instagram", tag: decodeURIComponent(igMatch[1]) };
  }

  const ttMatch = /^\/tags?\/([^/]+)$/.exec(path);
  if (/tiktok\.com$/.test(host) && ttMatch) {
    return { platform: "tiktok", tag: decodeURIComponent(ttMatch[1]) };
  }

  const xMatch = /^\/hashtag\/([^/]+)$/.exec(path);
  if (/^(x\.com|twitter\.com)$/.test(host) && xMatch) {
    return { platform: "x", tag: decodeURIComponent(xMatch[1]) };
  }

  return null;
}

// Tiene solo gli MAX_POSTS_PER_CHANNEL post più recenti di QUESTA piattaforma
// nel canale, buttando i più vecchi — stesso approccio di trimToMax in
// sync-x-posts.mjs, generalizzato: qui un canale hashtag ha post di UNA sola
// piattaforma (quella dell'hashtag), ma il filtro per platform evita di
// toccare eventuali altri account se il canale venisse riusato in futuro.
function trimToMax(canale, platform, max) {
  const posts = canale.accounts
    .filter((a) => a.platform === platform)
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  while (posts.length > max) {
    const oldest = posts.shift();
    canale.accounts = canale.accounts.filter((a) => a.url !== oldest.url);
  }
}

// handle = utente che ha pubblicato il singolo post (non l'hashtag: un
// hashtag raggruppa post di autori diversi) — fallback al tag SOLO se
// l'autore non è stato recuperabile, per non lasciare mai handle vuoto.
function addPosts(canale, platform, tag, posts) {
  let added = 0;
  for (const post of posts) {
    if (!post.url) continue;
    const exists = canale.accounts.some((a) => a.url === post.url);
    if (exists) continue;
    canale.accounts.push({
      platform,
      handle: post.author || tag,
      url: post.url,
      date: post.date ?? null,
      caption: post.caption ?? null,
      location: post.location ?? null,
      views: post.views ?? null,
    });
    added++;
  }
  if (added > 0) trimToMax(canale, platform, MAX_POSTS_PER_CHANNEL);
  return added;
}

// --- Main ---
console.log("=== TRENDZN — Sync hashtag Bluserena-monitoring ===");

const { store } = await readStore();
const list = store.canali;

const hashtagChannels = [];
for (const canale of list) {
  const info = hashtagInfo(canale.urls?.[0] ?? "");
  if (info) hashtagChannels.push({ canale, ...info });
}

const byPlatform = {
  instagram: hashtagChannels.filter((h) => h.platform === "instagram"),
  tiktok: hashtagChannels.filter((h) => h.platform === "tiktok"),
  x: hashtagChannels.filter((h) => h.platform === "x"),
};

console.log(
  `Hashtag da monitorare: ${hashtagChannels.length} (Instagram: ${byPlatform.instagram.length}, TikTok: ${byPlatform.tiktok.length}, X: ${byPlatform.x.length})`,
);

if (hashtagChannels.length === 0) {
  console.log("Nessun hashtag configurato, esco.");
  process.exit(0);
}

let modified = false;

// Riepilogo di fine run per hashtag: i singoli console.log per hashtag sono
// facili da perdere nei log di GitHub Actions se un login-wall o un errore
// falliscono silenziosamente per un solo hashtag in mezzo a molti altri.
const runSummary = [];

// --- Instagram ---
if (byPlatform.instagram.length > 0) {
  console.log(`\n--- Instagram (${byPlatform.instagram.length} hashtag) ---`);
  const session = await openInstagramMetricsSession();
  try {
    for (const { canale, tag } of byPlatform.instagram) {
      console.log(`#${tag}`);
      const page = await session.context.newPage();
      let links = [];
      let failed = false;
      try {
        const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
        const response = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => null);

        if (response && !page.url().includes("/accounts/login")) {
          await page.waitForTimeout(4000);
          const collected = new Set();
          let stagnantRounds = 0;
          for (let round = 0; round < 15 && collected.size < MAX_POSTS_PER_INSTAGRAM_HASHTAG; round++) {
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
              if (stagnantRounds >= 3) break;
            } else {
              stagnantRounds = 0;
            }
            await page.mouse.wheel(0, 3000);
            await page.waitForTimeout(1500);
          }
          links = [...collected].slice(0, MAX_POSTS_PER_INSTAGRAM_HASHTAG);
        } else {
          failed = true;
          console.log("  FALLITO (login wall o nessuna risposta)");
        }
      } finally {
        await page.close();
      }

      const posts = [];
      for (const url of links) {
        const { metrics } = await session.fetchMetricsDetailed(url);
        if (metrics) {
          posts.push({
            url,
            date: metrics.publishedAt,
            caption: metrics.caption,
            author: metrics.author,
            location: metrics.location,
          });
        }
        await sleep(DELAY_MS);
      }

      const added = addPosts(canale, "instagram", tag, posts);
      if (added > 0) modified = true;
      console.log(`  ${links.length} link trovati, ${added} nuovi post aggiunti.`);
      runSummary.push({ platform: "instagram", tag, found: links.length, added, failed });
      await sleep(DELAY_MS);
    }
  } finally {
    await session.close();
  }
}

// --- TikTok ---
// scrapeTikTokHashtag() dà solo url + views (limite noto della pagina
// hashtag, vedi scrape-tiktok-hashtag.mjs). Da lì recuperiamo comunque
// gratis, senza richieste extra:
//   - autore: già nell'URL del video (tiktok.com/@utente/video/<id>)
//   - data: già codificata nell'ID del video (stessa tecnica, proven, già
//     usata in sync-bluserena-monitoring.mjs per i post TikTok da RSS-Bridge)
// La caption resta l'unico dato che richiede una richiesta aggiuntiva: si
// prova a leggerla dal meta tag og:description della pagina del singolo
// video (convenzione web comune). Su un run reale su #bluserena era sempre
// null (15/15): la pagina newPage() senza User-Agent esplicito riceveva la
// schermata di login di TikTok al posto del video. Fix: stesso
// REAL_CHROME_UA già usato con successo in scrape-tiktok-hashtag.mjs — da
// riconfermare con un nuovo run reale, resta comunque un fallback a null se
// il meta tag non fosse presente per altri motivi.
function tiktokAuthorFromUrl(url) {
  return url.match(/\/@([^/]+)\/video\//)?.[1] ?? null;
}

function tiktokDateFromVideoId(url) {
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
    return date.toISOString();
  } catch {
    return null;
  }
}

// Senza uno User-Agent "da browser vero" esplicito, Playwright usa lo UA di
// default headless: TikTok lo riconosce e serve una pagina di login al posto
// del video (verificato: con lo UA di default la caption risultava sempre
// null su 15/15 post reali). Stesso UA già usato con successo per la pagina
// hashtag in scrape-tiktok-hashtag.mjs.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function tiktokCaption(browser, url) {
  const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    return await page
      .$eval('meta[property="og:description"], meta[name="description"]', (el) =>
        el.getAttribute("content"),
      )
      .catch(() => null);
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

if (byPlatform.tiktok.length > 0) {
  console.log(`\n--- TikTok (${byPlatform.tiktok.length} hashtag) ---`);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { canale, tag } of byPlatform.tiktok) {
      console.log(`#${tag}`);
      let found = [];
      let failed = false;
      try {
        found = await scrapeTikTokHashtag(tag);
      } catch (err) {
        failed = true;
        console.error(`  errore: ${String(err?.message || err)}`);
      }

      const posts = [];
      for (const { url, views } of found) {
        const caption = await tiktokCaption(browser, url);
        posts.push({
          url,
          author: tiktokAuthorFromUrl(url),
          date: tiktokDateFromVideoId(url),
          caption,
          views: views ?? null,
        });
        await sleep(DELAY_MS);
      }

      const added = addPosts(canale, "tiktok", tag, posts);
      if (added > 0) modified = true;
      console.log(`  ${found.length} video trovati, ${added} nuovi post aggiunti.`);
      runSummary.push({ platform: "tiktok", tag, found: found.length, added, failed });
    }
  } finally {
    await browser.close();
  }
}

// --- X ---
if (byPlatform.x.length > 0) {
  console.log(`\n--- X (${byPlatform.x.length} hashtag) ---`);
  const rettiwtApiKey = process.env.RETTIWT_API_KEY;
  if (!rettiwtApiKey) {
    console.error("  Manca RETTIWT_API_KEY nell'ambiente, salto gli hashtag X.");
  } else {
    const rettiwt = new Rettiwt({ apiKey: rettiwtApiKey });
    for (const { canale, tag } of byPlatform.x) {
      console.log(`#${tag}`);
      let tweets = [];
      try {
        const result = await rettiwt.tweet.search(
          { hashtags: [tag], language: "it", top: false },
          TWEETS_PER_HASHTAG,
        );
        tweets = result?.list ?? [];
      } catch (err) {
        console.error(`  errore: ${String(err?.message || err)}`);
        runSummary.push({ platform: "x", tag, found: 0, added: 0, failed: true });
        continue;
      }
      // author: tweet.tweetBy.userName, campo verificato leggendo
      // node_modules/rettiwt-api/dist/models/data/Tweet.d.ts (vedi
      // probe-x-hashtag-search-rettiwt.mjs). location resta sempre null:
      // rettiwt-api non espone un campo di geolocalizzazione confermato sul
      // modello Tweet — da verificare con un probe dedicato prima di
      // provare a leggerlo, non un'omissione distratta.
      const posts = tweets
        .filter((t) => t?.url)
        .map((t) => ({
          url: t.url,
          date: t.createdAt || null,
          caption: t.fullText || null,
          author: t.tweetBy?.userName || null,
          location: null,
          views: t.viewCount ?? null,
        }));
      const added = addPosts(canale, "x", tag, posts);
      if (added > 0) modified = true;
      console.log(`  ${tweets.length} tweet trovati, ${added} nuovi post aggiunti.`);
      runSummary.push({ platform: "x", tag, found: tweets.length, added, failed: false });
    }
  }
}

// --- Riepilogo ---
if (runSummary.length > 0) {
  console.log("\n=== Riepilogo run ===");
  for (const r of runSummary) {
    const status = r.failed ? "FALLITO" : "ok";
    console.log(
      `  [${status}] ${r.platform} #${r.tag}: ${r.found} trovati, ${r.added} nuovi post`,
    );
  }
  const failedCount = runSummary.filter((r) => r.failed).length;
  if (failedCount > 0) {
    console.log(`\n${failedCount}/${runSummary.length} hashtag falliti in questo run.`);
  }
}

if (!modified) {
  console.log("\nNessuna novità, bluserena-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store);
console.log("\nbluserena-monitoring.json aggiornato su GitHub.");
