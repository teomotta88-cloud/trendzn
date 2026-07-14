// Copia di sync-canali-feed.mjs per la pagina "ASPI-monitoring": monitora gli
// account social elencati in src/data/aspi-monitoring.json (una sola lista,
// "canali") via RSS-Bridge e scrive i nuovi post trovati nello stesso file su
// GitHub. Store INDIPENDENTE da trends.json così i due workflow di sync non si
// pestano i piedi sulla stessa risorsa GitHub.
//
// Solo Instagram e TikTok vengono monitorati.

const REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/aspi-monitoring.json";
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
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    headers: ghHeaders,
  });
  if (!res.ok) {
    throw new Error(`Lettura aspi-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const store = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { store, sha: data.sha };
}

async function writeStore(store, sha) {
  const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: sync ASPI-monitoring posts [trendzn-bot]",
      content,
      sha,
    }),
  });

  if (!res.ok) {
    throw new Error(`Scrittura aspi-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }
}

function normalizeHandle(handle) {
  return handle?.startsWith("@") ? handle.slice(1) : handle;
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

    // Guardrail: evita date assurde se TikTok cambia formato o l'ID non è valido.
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

// "content_html" contiene la caption integrale; "title" arriva troncato.
function fullCaption(item) {
  const html = item.content_html || "";
  const text = html
    .replace(/<br\s*\/?/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

// Normalizza handle e prova a valorizzare le date mancanti dei TikTok già salvati.
let modified = false;

for (const canale of list) {
  for (const account of canale.accounts || []) {
    if (account.handle) account.handle = normalizeHandle(account.handle);

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

// Handle univoci Instagram/TikTok da monitorare.
const handles = list
  .flatMap((c) => c.accounts || [])
  .filter((a) => a.platform === "instagram" || a.platform === "tiktok")
  .filter((a, i, arr) => arr.findIndex((x) => x.handle === a.handle) === i)
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

  canale.accounts.push({
    platform: postPlatform,
    handle,
    url,
    date,
    caption,
    views: postPlatform === "tiktok" ? extractTikTokViews(item) : null,
  });

  const posts = canale.accounts.filter((a) => isPostUrl(a.url));
  if (posts.length > MAX_POSTS_PER_CHANNEL) {
    canale.accounts = canale.accounts.filter((a) => a.url !== posts[0].url);
  }

  modified = true;
}

if (!modified) {
  console.log("Nessuna novità, aspi-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store, sha);
console.log("aspi-monitoring.json aggiornato su GitHub.");
