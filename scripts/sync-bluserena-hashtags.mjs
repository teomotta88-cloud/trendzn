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
// Tre tecniche completamente diverse, una per piattaforma:
//   - Instagram: scraping pubblico via Playwright della pagina hashtag
//     (nessun login), stessa tecnica già in produzione per la discovery Trend
//     Virali — vedi discover-instagram-hashtag-content.mjs, di cui questo
//     script riusa scripts/lib/instagram-public-metrics.mjs invece di
//     duplicarne la logica di parsing.
//   - TikTok: scripts/scrape-tiktok-hashtag.mjs (già in produzione per la
//     card "TikTok Trending", vedi sync-tiktok-hashtag.mjs) — riusato
//     direttamente. Limite noto di questa tecnica: solo url + views, nessuna
//     caption/data (la pagina hashtag di TikTok non le espone via DOM
//     pubblico in modo affidabile).
//   - X: rettiwt-api con l'account dedicato già in produzione per gli
//     account X di ASPI-monitoring (vedi sync-x-posts.mjs), qui con
//     tweet.search({ hashtags: [...] }) invece di { fromUsers: [...] }.
//
// Nessuna delle tre tecniche richiede credit anysite. Instagram e X restano
// "best effort" (login-wall/blocchi possibili, vedi i commenti nei rispettivi
// moduli riusati) — un fallimento su un singolo hashtag non blocca gli altri.

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

function addPosts(canale, platform, tag, posts) {
  let added = 0;
  for (const post of posts) {
    if (!post.url) continue;
    const exists = canale.accounts.some((a) => a.url === post.url);
    if (exists) continue;
    canale.accounts.push({
      platform,
      handle: tag,
      url: post.url,
      date: post.date ?? null,
      caption: post.caption ?? null,
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

// --- Instagram ---
if (byPlatform.instagram.length > 0) {
  console.log(`\n--- Instagram (${byPlatform.instagram.length} hashtag) ---`);
  const session = await openInstagramMetricsSession();
  try {
    for (const { canale, tag } of byPlatform.instagram) {
      console.log(`#${tag}`);
      const page = await session.context.newPage();
      let links = [];
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
          console.log("  FALLITO (login wall o nessuna risposta)");
        }
      } finally {
        await page.close();
      }

      const posts = [];
      for (const url of links) {
        const { metrics } = await session.fetchMetricsDetailed(url);
        if (metrics) {
          posts.push({ url, date: metrics.publishedAt, caption: metrics.caption });
        }
        await sleep(DELAY_MS);
      }

      const added = addPosts(canale, "instagram", tag, posts);
      if (added > 0) modified = true;
      console.log(`  ${links.length} link trovati, ${added} nuovi post aggiunti.`);
      await sleep(DELAY_MS);
    }
  } finally {
    await session.close();
  }
}

// --- TikTok ---
if (byPlatform.tiktok.length > 0) {
  console.log(`\n--- TikTok (${byPlatform.tiktok.length} hashtag) ---`);
  for (const { canale, tag } of byPlatform.tiktok) {
    console.log(`#${tag}`);
    let posts = [];
    try {
      posts = await scrapeTikTokHashtag(tag);
    } catch (err) {
      console.error(`  errore: ${String(err?.message || err)}`);
    }
    const added = addPosts(canale, "tiktok", tag, posts);
    if (added > 0) modified = true;
    console.log(`  ${posts.length} video trovati, ${added} nuovi post aggiunti.`);
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
        continue;
      }
      const posts = tweets
        .filter((t) => t?.url)
        .map((t) => ({
          url: t.url,
          date: t.createdAt || null,
          caption: t.fullText || null,
          views: t.viewCount ?? null,
        }));
      const added = addPosts(canale, "x", tag, posts);
      if (added > 0) modified = true;
      console.log(`  ${tweets.length} tweet trovati, ${added} nuovi post aggiunti.`);
    }
  }
}

if (!modified) {
  console.log("\nNessuna novità, bluserena-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store);
console.log("\nbluserena-monitoring.json aggiornato su GitHub.");
