// Monitoraggio delle PAGINE HASHTAG (Instagram, TikTok, X) aggiunte alla
// pagina "Bluserena-monitoring" — complementare a sync-bluserena-monitoring.mjs,
// che copre solo i PROFILI IG/TikTok. La LISTA degli hashtag da monitorare
// resta configurata in bluserena-monitoring.json (chiave "canali", stesso
// store dei profili, riconosciuti dalla forma dell'URL — vedi hashtagInfo
// sotto), ma i POST scoperti ora vivono in Supabase
// (bluserena_hashtag_posts, tabella dedicata) invece che nel JSON: un file
// git non supporta retry persistente per-post, query/filtri, o
// aggiornamenti senza commit — necessari per il workflow definitivo
// (backfill, retry su login-wall, sentiment/topic via LLM in una fase
// successiva).
//
//   Instagram: instagram.com/explore/tags/<tag>/
//   TikTok:    tiktok.com/tag/<tag>  (o /tags/<tag>)
//   X:         x.com/hashtag/<tag>   (o twitter.com)
//
// Due passate, entrambe alimentano/consumano Supabase invece del JSON:
//
//   Passata A (scoperta): trova gli URL dei post recenti sulla pagina
//   hashtag e li registra come candidati (detail_status 'pending', tranne X
//   che ha già tutto — vedi sotto). Al PRIMO giro per un hashtag (nessun
//   canale.backfilledAt in bluserena-monitoring.json) scrolla/cerca più a
//   fondo per risalire fino a ~2 settimane indietro; ai giri successivi
//   fa uno scan leggero (solo i post più recenti). "Fino a 2 settimane" è
//   best-effort (più scroll/più risultati richiesti), non una garanzia:
//   nessuna delle tre pagine hashtag espone una data prima di aprire il
//   singolo post, quindi non si può sapere IN ANTICIPO quanto scrollare.
//
//   Passata B (dettaglio/retry): legge da
//   list-bluserena-hashtag-pending.ts i post ancora da controllare —
//   scoperti in QUESTO giro o falliti (login-wall ecc.) in un giro
//   precedente, non fa differenza, la coda è la stessa. Per ciascuno riusa
//   le tecniche già verificate in questa sessione: scripts/lib/
//   instagram-public-metrics.mjs (Instagram, autore/data/caption/geotag
//   dalla description) e la struttura JSON __UNIVERSAL_DATA_FOR_REHYDRATION__
//   (TikTok, confermata con scripts/probe-tiktok-video-json.mjs su un video
//   reale geotaggato). Un fallimento (es. login-wall, confermato reale per
//   entrambe le piattaforme) marca il post 'failed': la PROSSIMA run lo
//   rilegge automaticamente dalla stessa coda e riprova — è il fallback
//   "riprova in una run successiva" richiesto esplicitamente, niente di più
//   complesso di questo.
//
//   X fa eccezione: rettiwt-api restituisce autore/data/caption/views in
//   un'unica chiamata di ricerca per hashtag, quindi Passata A e B
//   coincidono (detail_status 'ok' subito, mai in coda per Passata B). Il
//   geotag resta sempre null: nessun campo confermato nel modello Tweet di
//   rettiwt-api.
//
// Nessuna delle tre tecniche richiede credit anysite. Tutte restano "best
// effort" (login-wall/blocchi possibili su Instagram e TikTok) — un
// fallimento su un singolo hashtag o un singolo post non blocca gli altri.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";
import { scrapeHashtag as scrapeTikTokHashtag } from "./scrape-tiktok-hashtag.mjs";
import { Rettiwt } from "rettiwt-api";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;

const SYNC_POSTS_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/sync-bluserena-hashtag-posts";
const LIST_PENDING_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/list-bluserena-hashtag-pending";

const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);
const PENDING_LIMIT_PER_PLATFORM = parseInt(process.env.PENDING_LIMIT_PER_PLATFORM ?? "100", 10);

// Backfill (primo giro di un hashtag) vs incrementale (giri successivi):
// stessa soglia empirica di discover-instagram-hashtag-content.mjs per il
// login-wall Instagram (~10 hashtag/sessione, ~500 richieste) applicata qui
// al numero di post per singolo hashtag invece che al numero di hashtag —
// valori scelti per restare ben sotto quella soglia anche al backfill.
const INCREMENTAL_INSTAGRAM_MAX_POSTS = 30;
const BACKFILL_INSTAGRAM_MAX_POSTS = 150;
const INCREMENTAL_INSTAGRAM_SCROLL_ROUNDS = 15;
const BACKFILL_INSTAGRAM_SCROLL_ROUNDS = 60;
const BACKFILL_TIKTOK_SCROLL_STEPS = 30;
const INCREMENTAL_TWEETS_PER_HASHTAG = 10;
const BACKFILL_TWEETS_PER_HASHTAG = 100;

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

// Scrive SOLO il flag backfilledAt sui canali passati (id -> timestamp): a
// differenza dei post, ora su Supabase, questo resta nel JSON perché è
// config del canale, non un dato scoperto. Stesso pattern retry-on-conflict
// degli altri script di sync su questo file.
async function markBackfilled(canaleIds) {
  if (canaleIds.size === 0) return;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { store, sha } = await readStore();
    const now = new Date().toISOString();
    let changed = false;
    for (const canale of store.canali) {
      if (canaleIds.has(canale.id) && !canale.backfilledAt) {
        canale.backfilledAt = now;
        changed = true;
      }
    }
    if (!changed) return;

    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: segna backfill hashtag Bluserena completato [trendzn-bot]",
        content,
        sha,
      }),
    });

    if (res.ok) return;
    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto su bluserena-monitoring.json (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo...`,
      );
      continue;
    }
    console.error(`Scrittura backfilledAt fallita: ${res.status} ${await res.text()}`);
    return;
  }
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

async function sendPosts(posts) {
  if (posts.length === 0) return;
  try {
    const res = await fetch(SYNC_POSTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts }),
    });
    if (!res.ok) {
      console.error(`  sync-bluserena-hashtag-posts fallito (${res.status}): ${await res.text()}`);
      return;
    }
    const data = await res.json();
    console.log(`  ${posts.length} record inviati (${data.upserted ?? "?"} upsert).`);
  } catch (err) {
    console.error(`  sync-bluserena-hashtag-posts errore: ${String(err)}`);
  }
}

async function fetchPending(platform) {
  try {
    const res = await fetch(
      `${LIST_PENDING_ENDPOINT}?platform=${encodeURIComponent(platform)}&limit=${PENDING_LIMIT_PER_PLATFORM}`,
    );
    if (!res.ok) {
      console.error(
        `  list-bluserena-hashtag-pending fallito (${res.status}): ${await res.text()}`,
      );
      return [];
    }
    const data = await res.json();
    return data.posts ?? [];
  } catch (err) {
    console.error(`  list-bluserena-hashtag-pending errore: ${String(err)}`);
    return [];
  }
}

// --- TikTok: autore/data/caption/geotag dal blob JSON della pagina video ---
// CONFERMATO su un video reale geotaggato con
// scripts/probe-tiktok-video-json.mjs (24/08/2026,
// https://www.tiktok.com/@iannacconefamilyofficia/video/7676876746549103905):
//   itemStruct.author.uniqueId, itemStruct.createTime (secondi Unix),
//   itemStruct.desc (caption), itemStruct.poi.name/.city (geotag).
// Login-wall confermato anch'esso reale nello stesso probe (pagina "Log in |
// TikTok" al posto del video) — rilevato esplicitamente sotto.
function tiktokAuthorFromUrl(url) {
  return url.match(/\/@([^/]+)\/video\//)?.[1] ?? null;
}

// Fallback SOLO se la pagina video non è raggiungibile (login-wall) e quindi
// non c'è nessun itemStruct.createTime da leggere: approssimato di pochi
// secondi rispetto al reale (verificato nel probe), comunque preferibile a
// nessuna data.
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

async function tiktokVideoDetails(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const title = await page.title().catch(() => "");
    if (/log in/i.test(title)) {
      return { caption: null, date: null, author: null, location: null, reason: "login-wall" };
    }

    const raw = await page
      .$eval("#__UNIVERSAL_DATA_FOR_REHYDRATION__", (el) => el.textContent)
      .catch(() => null);
    if (!raw) {
      return { caption: null, date: null, author: null, location: null, reason: "no-json" };
    }

    let itemStruct;
    try {
      const data = JSON.parse(raw);
      itemStruct = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct ?? null;
    } catch {
      itemStruct = null;
    }
    if (!itemStruct) {
      return { caption: null, date: null, author: null, location: null, reason: "no-itemStruct" };
    }

    const author = itemStruct.author?.uniqueId ?? null;
    const date =
      typeof itemStruct.createTime === "number"
        ? new Date(itemStruct.createTime * 1000).toISOString()
        : null;
    const caption = itemStruct.desc || null;

    const poi = itemStruct.poi;
    const location = poi?.name ? [poi.name, poi.city].filter(Boolean).join(" · ") : null;

    return { caption, date, author, location, reason: null };
  } catch (err) {
    return {
      caption: null,
      date: null,
      author: null,
      location: null,
      reason: `error:${String(err)}`,
    };
  } finally {
    await page.close();
  }
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

const backfilledIds = new Set();

// ========== Passata A: scoperta ==========

if (byPlatform.instagram.length > 0) {
  console.log(`\n--- Instagram: scoperta (${byPlatform.instagram.length} hashtag) ---`);
  const session = await openInstagramMetricsSession();
  try {
    for (const { canale, tag } of byPlatform.instagram) {
      const isBackfill = !canale.backfilledAt;
      const maxPosts = isBackfill ? BACKFILL_INSTAGRAM_MAX_POSTS : INCREMENTAL_INSTAGRAM_MAX_POSTS;
      const maxRounds = isBackfill
        ? BACKFILL_INSTAGRAM_SCROLL_ROUNDS
        : INCREMENTAL_INSTAGRAM_SCROLL_ROUNDS;
      console.log(`#${tag}${isBackfill ? " (backfill)" : ""}`);

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
          for (let round = 0; round < maxRounds && collected.size < maxPosts; round++) {
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
          links = [...collected].slice(0, maxPosts);
        } else {
          console.log("  FALLITO (login wall o nessuna risposta)");
        }
      } finally {
        await page.close();
      }

      if (links.length > 0) {
        await sendPosts(
          links.map((url) => ({ hashtagUrl: canale.urls[0], platform: "instagram", tag, url })),
        );
      }
      if (isBackfill) backfilledIds.add(canale.id);
      await sleep(DELAY_MS);
    }
  } finally {
    await session.close();
  }
}

if (byPlatform.tiktok.length > 0) {
  console.log(`\n--- TikTok: scoperta (${byPlatform.tiktok.length} hashtag) ---`);
  for (const { canale, tag } of byPlatform.tiktok) {
    const isBackfill = !canale.backfilledAt;
    console.log(`#${tag}${isBackfill ? " (backfill)" : ""}`);
    let found = [];
    try {
      found = isBackfill
        ? await scrapeTikTokHashtag(tag, { scrollSteps: BACKFILL_TIKTOK_SCROLL_STEPS })
        : await scrapeTikTokHashtag(tag);
    } catch (err) {
      console.error(`  errore: ${String(err?.message || err)}`);
    }
    if (found.length > 0) {
      await sendPosts(
        found.map(({ url, views }) => ({
          hashtagUrl: canale.urls[0],
          platform: "tiktok",
          tag,
          url,
          views: views ?? null,
        })),
      );
    }
    if (isBackfill) backfilledIds.add(canale.id);
  }
}

if (byPlatform.x.length > 0) {
  console.log(`\n--- X: scoperta + dettaglio (${byPlatform.x.length} hashtag) ---`);
  const rettiwtApiKey = process.env.RETTIWT_API_KEY;
  if (!rettiwtApiKey) {
    console.error("  Manca RETTIWT_API_KEY nell'ambiente, salto gli hashtag X.");
  } else {
    const rettiwt = new Rettiwt({ apiKey: rettiwtApiKey });
    for (const { canale, tag } of byPlatform.x) {
      const isBackfill = !canale.backfilledAt;
      const count = isBackfill ? BACKFILL_TWEETS_PER_HASHTAG : INCREMENTAL_TWEETS_PER_HASHTAG;
      console.log(`#${tag}${isBackfill ? " (backfill)" : ""}`);

      let tweets = [];
      try {
        const result = await rettiwt.tweet.search(
          { hashtags: [tag], language: "it", top: false },
          count,
        );
        tweets = result?.list ?? [];
      } catch (err) {
        console.error(`  errore: ${String(err?.message || err)}`);
        continue;
      }

      // author: tweet.tweetBy.userName, campo verificato leggendo
      // node_modules/rettiwt-api/dist/models/data/Tweet.d.ts (vedi
      // probe-x-hashtag-search-rettiwt.mjs). Niente Passata B per X: qui
      // arriva già tutto quello che si può ottenere in un colpo solo.
      const posts = tweets
        .filter((t) => t?.url)
        .map((t) => ({
          hashtagUrl: canale.urls[0],
          platform: "x",
          tag,
          url: t.url,
          publishedAt: t.createdAt || null,
          caption: t.fullText || null,
          author: t.tweetBy?.userName || null,
          location: null,
          views: t.viewCount ?? null,
          detailStatus: "ok",
        }));
      if (posts.length > 0) await sendPosts(posts);
      if (isBackfill) backfilledIds.add(canale.id);
    }
  }
}

await markBackfilled(backfilledIds);

// ========== Passata B: dettaglio/retry (Instagram + TikTok) ==========

const igPending = byPlatform.instagram.length > 0 ? await fetchPending("instagram") : [];
if (igPending.length > 0) {
  console.log(`\n--- Instagram: dettaglio di ${igPending.length} post in coda ---`);
  const session = await openInstagramMetricsSession();
  const results = [];
  try {
    for (const p of igPending) {
      const { metrics, reason } = await session.fetchMetricsDetailed(p.url);
      if (metrics) {
        results.push({
          hashtagUrl: p.hashtag_url,
          platform: "instagram",
          tag: p.tag,
          url: p.url,
          author: metrics.author,
          publishedAt: metrics.publishedAt,
          caption: metrics.caption,
          location: metrics.location,
          detailStatus: "ok",
        });
      } else {
        results.push({
          hashtagUrl: p.hashtag_url,
          platform: "instagram",
          tag: p.tag,
          url: p.url,
          detailStatus: "failed",
          detailFailReason: reason,
        });
      }
      await sleep(DELAY_MS);
    }
  } finally {
    await session.close();
  }
  const failed = results.filter((r) => r.detailStatus === "failed").length;
  console.log(
    `  ${results.length - failed}/${results.length} completati, ${failed} in coda per il prossimo giro.`,
  );
  await sendPosts(results);
}

const ttPending = byPlatform.tiktok.length > 0 ? await fetchPending("tiktok") : [];
if (ttPending.length > 0) {
  console.log(`\n--- TikTok: dettaglio di ${ttPending.length} video in coda ---`);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const p of ttPending) {
      const details = await tiktokVideoDetails(browser, p.url);
      if (details.reason) {
        results.push({
          hashtagUrl: p.hashtag_url,
          platform: "tiktok",
          tag: p.tag,
          url: p.url,
          author: details.author ?? tiktokAuthorFromUrl(p.url),
          publishedAt: details.date ?? tiktokDateFromVideoId(p.url),
          detailStatus: "failed",
          detailFailReason: details.reason,
        });
      } else {
        results.push({
          hashtagUrl: p.hashtag_url,
          platform: "tiktok",
          tag: p.tag,
          url: p.url,
          author: details.author,
          publishedAt: details.date,
          caption: details.caption,
          location: details.location,
          detailStatus: "ok",
        });
      }
      await sleep(DELAY_MS);
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => r.detailStatus === "failed").length;
  console.log(
    `  ${results.length - failed}/${results.length} completati, ${failed} in coda per il prossimo giro.`,
  );
  await sendPosts(results);
}

console.log("\n=== Fine ===");
