// Copia di sync-canali-feed.mjs per la pagina "Bluserena-monitoring": monitora gli
// account social elencati in src/data/bluserena-monitoring.json (una sola lista,
// "canali") via RSS-Bridge e scrive i nuovi post trovati nello stesso file su
// GitHub. Store INDIPENDENTE da trends.json così i due workflow di sync non si
// pestano i piedi sulla stessa risorsa GitHub.
//
// Solo Instagram e TikTok vengono monitorati.

const REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/bluserena-monitoring.json";
const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";
const MAX_POSTS_PER_CHANNEL = 15;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${token}`,
  Accept: "application/vnd.github.v3+json",
};

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
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
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${TRENDS_PATH}?t=${Date.now()}`;

  const rawRes = await fetch(rawUrl, {
    headers: {
      "User-Agent": "bluserena-monitoring-sync",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw bluserena-monitoring.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();

  if (!raw.trim()) {
    return { store: { canali: [] }, sha };
  }

  const store = JSON.parse(raw);

  if (!store || typeof store !== "object") {
    return { store: { canali: [] }, sha };
  }

  if (!Array.isArray(store.canali)) {
    store.canali = [];
  }

  return { store, sha };
}

async function writeStore(store, sha) {
  const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: sync Bluserena-monitoring posts [trendzn-bot]",
      content,
      sha,
    }),
  });

  if (!res.ok) {
    throw new Error(`Scrittura bluserena-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }
}

function normalizeHandle(handle) {
  return handle?.startsWith("@") ? handle.slice(1) : handle;
}

// Un canale "hashtag" (Instagram /explore/tags/<tag>/, TikTok /tag(s)/<tag>,
// X /hashtag/<tag> — aggiungibile da bluserena-monitoring.index.tsx) viene
// creato con la STESSA struttura di un canale-profilo: urls[0] = la pagina
// stessa, accounts[0] = { platform, handle, url } con lo stesso URL come
// "seed". Senza questo controllo, il ciclo qui sotto lo scambierebbe per un
// profilo IG/TikTok chiamato come l'hashtag (es. #travel -> utente "travel")
// e lo monitorerebbe con RSS-Bridge Username invece che lasciarlo a
// sync-bluserena-hashtags.mjs, che lo gestisce con la tecnica corretta.
function isHashtagUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    if (/instagram\.com$/.test(host)) return /^\/explore\/tags\/[^/]+$/.test(path);
    if (/tiktok\.com$/.test(host)) return /^\/tags?\/[^/]+$/.test(path);
    if (/^(x\.com|twitter\.com)$/.test(host)) return /^\/hashtag\/[^/]+$/.test(path);
    return false;
  } catch {
    return false;
  }
}

function isPostUrl(url) {
  return /\/p\/|\/reel\/|\/reels\/|\/video\/|\/photo\/|\/watch/.test(url);
}

function detectPlatform(url) {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

function extractTikTokVideoId(url) {
  const match = url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/);
  return match?.[1] || null;
}

function dateFromTikTokVideoId(url) {
  const videoId = extractTikTokVideoId(url);
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

function getItemDate(item, url, platform) {
  return (
    item.date_modified ||
    item.date_published ||
    item.published ||
    item.updated ||
    (platform === "tiktok" ? dateFromTikTokVideoId(url) : null) ||
    null
  );
}

function absolutizeUrl(url, baseUrl) {
  if (!url) return null;

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function decodeHtmlEntities(value) {
  if (!value || typeof value !== "string") return "";

  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanImageUrl(url) {
  if (!url || typeof url !== "string") return null;

  const cleaned = decodeHtmlEntities(url).trim();

  if (!/^https?:\/\//i.test(cleaned)) return null;

  return cleaned;
}

function extractImageFromHtml(html, baseUrl) {
  if (!html || typeof html !== "string") return null;

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const imageUrl = cleanImageUrl(absolutizeUrl(match?.[1], baseUrl));
    if (imageUrl) return imageUrl;
  }

  return null;
}

function extractImageFromItem(item, pageUrl) {
  const candidates = [
    item.image,
    item.image_url,
    item.thumbnail,
    item.thumbnail_url,
    item.media_url,
    item.media?.url,
    item.media?.thumbnail,
    item.enclosure?.url,
  ];

  if (Array.isArray(item.enclosures)) {
    for (const enclosure of item.enclosures) {
      candidates.push(enclosure?.url);
    }
  }

  if (Array.isArray(item.attachments)) {
    for (const attachment of item.attachments) {
      candidates.push(attachment?.url);
    }
  }

  for (const candidate of candidates) {
    const imageUrl = cleanImageUrl(absolutizeUrl(candidate, pageUrl));
    if (imageUrl) return imageUrl;
  }

  return extractImageFromHtml(item.content_html || item.summary || item.content || "", pageUrl);
}

async function fetchPagePreviewImage(pageUrl) {
  if (!pageUrl) return null;

  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    return extractImageFromHtml(html, pageUrl);
  } catch {
    return null;
  }
}

async function getPostImageUrl(item, pageUrl) {
  const fromItem = extractImageFromItem(item, pageUrl);
  if (fromItem) return fromItem;

  return await fetchPagePreviewImage(pageUrl);
}

// "content_html" contiene la caption integrale; "title" arriva troncato.
function fullCaption(item) {
  const html = item.content_html || "";

  const text = decodeHtmlEntities(html)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text || (item.title || "").trim() || null;
}

function rssBridgeUrl(platform, handle) {
  return platform === "instagram"
    ? `${RSS_BRIDGE_BASE}?action=display&bridge=Instagram&context=Username&u=${handle}&format=JSON`
    : `${RSS_BRIDGE_BASE}?action=display&bridge=TikTok&context=By+user&username=${handle}&format=JSON`;
}

function parseCompactNumber(str) {
  const match = str
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

function extractTikTokViews(item) {
  const match = (item.content_html || "").match(/([\d.,]+\s*[KMB]?)\s*views/i);
  return match ? parseCompactNumber(match[1]) : null;
}

async function fetchFeed(platform, handle) {
  const url = rssBridgeUrl(platform, handle);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      console.error(`Feed ${platform}/${handle} fallito: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.items ?? [];
  } catch (err) {
    console.error(`Feed ${platform}/${handle} errore: ${String(err)}`);
    return [];
  }
}

// --- Main ---
const { store, sha } = await readStore();
if (!Array.isArray(store.canali)) store.canali = [];

const list = store.canali;
let modified = false;

// Normalizza handle, date TikTok mancanti e campo imageUrl sui post già salvati.
for (const canale of list) {
  for (const account of canale.accounts || []) {
    if (account.handle) account.handle = normalizeHandle(account.handle);

    if (account.imageUrl === undefined && isPostUrl(account.url || "")) {
      account.imageUrl = null;
      modified = true;
    }

    const platform = account.platform || detectPlatform(account.url || "");
    if (platform === "tiktok" && isPostUrl(account.url || "") && !account.date) {
      const inferredDate = dateFromTikTokVideoId(account.url);
      if (inferredDate) {
        account.date = inferredDate;
        modified = true;
      }
    }
  }
}

// Handle univoci Instagram/TikTok da monitorare — esclusi i canali-hashtag
// (vedi isHashtagUrl), gestiti da sync-bluserena-hashtags.mjs.
const handles = list
  .filter((c) => !isHashtagUrl(c.urls?.[0] ?? ""))
  .flatMap((c) => c.accounts || [])
  .filter((a) => a.platform === "instagram" || a.platform === "tiktok")
  .filter((a) => a.handle)
  .filter((a, i, arr) => arr.findIndex((x) => x.handle === a.handle && x.platform === a.platform) === i)
  .map((a) => ({ handle: normalizeHandle(a.handle), platform: a.platform }));

console.log(`Monitoro ${handles.length} account.`);

const allItems = [];
for (const { handle, platform } of handles) {
  const items = await fetchFeed(platform, handle);
  allItems.push(...items);
}

console.log(`Trovati ${allItems.length} item totali nei feed.`);

for (const item of allItems) {
  const url = (item.url || item.id || "").trim();
  if (!url || !isPostUrl(url)) continue;

  const postPlatform = detectPlatform(url);
  const handle = normalizeHandle(item.author?.name || "") || null;

  const canale = list.find((c) => c.accounts?.some((a) => a.handle === handle));
  if (!canale) continue;

  const existing = canale.accounts.find((a) => a.url === url);

  if (existing) {
    if (!existing.caption) {
      const caption = fullCaption(item);
      if (caption) {
        existing.caption = caption;
        modified = true;
      }
    }

    if (existing.imageUrl === undefined) {
      existing.imageUrl = null;
      modified = true;
    }

    if (!existing.imageUrl) {
      const imageUrl = await getPostImageUrl(item, url);
      if (imageUrl) {
        existing.imageUrl = imageUrl;
        modified = true;
      }
    }

    if (!existing.date) {
      const date = getItemDate(item, url, existing.platform || postPlatform);
      if (date) {
        existing.date = date;
        modified = true;
      }
    }

    if (existing.views == null && existing.platform === "tiktok") {
      const views = extractTikTokViews(item);
      if (views != null) {
        existing.views = views;
        modified = true;
      }
    }

    continue;
  }

  const date = getItemDate(item, url, postPlatform);
  const caption = fullCaption(item);
  const imageUrl = await getPostImageUrl(item, url);

  canale.accounts.push({
    platform: postPlatform,
    handle,
    url,
    date,
    caption,
    imageUrl,
    views: postPlatform === "tiktok" ? extractTikTokViews(item) : null,
  });

  const posts = canale.accounts.filter((a) => isPostUrl(a.url));
  if (posts.length > MAX_POSTS_PER_CHANNEL) {
    canale.accounts = canale.accounts.filter((a) => a.url !== posts[0].url);
  }

  modified = true;
}

if (!modified) {
  console.log("Nessuna novità, bluserena-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store, sha);
console.log("bluserena-monitoring.json aggiornato su GitHub.");
