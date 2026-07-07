// Replica del workflow n8n "Trendzn Sync": monitora gli account social
// elencati in trends.json (canali_inspo, influencer_profiles, canali_cliente)
// via RSS-Bridge e scrive i nuovi post trovati in trends.json su GitHub.
//
// Variabili d'ambiente:
//   GITHUB_TOKEN     richiesta, token con permesso "contents: write" sul repo
//   RSS_BRIDGE_BASE  opzionale, URL base dell'istanza RSS-Bridge da interrogare
//                    (default: RSS-Bridge lanciato come service container dal
//                    workflow stesso, così non serve più un'istanza esterna
//                    sempre accesa da pagare — vedi .github/workflows/sync-canali-feed.yml)
//
// Eseguito da .github/workflows/sync-canali-feed.yml su schedule (ogni 3h)
// o manualmente via workflow_dispatch.

const REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";
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

async function readTrendsJson() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    headers: ghHeaders,
  });
  if (!res.ok) throw new Error(`Lettura trends.json fallita: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const trends = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { trends, sha: data.sha };
}

async function writeTrendsJson(trends, sha) {
  const content = Buffer.from(JSON.stringify(trends, null, 2)).toString("base64");
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: sync social posts [trendzn-bot]",
      content,
      sha,
    }),
  });
  if (!res.ok) throw new Error(`Scrittura trends.json fallita: ${res.status} ${await res.text()}`);
}

function normalizeHandle(handle) {
  return handle?.startsWith("@") ? handle.slice(1) : handle;
}

function isPostUrl(url) {
  return /\/p\/|\/reel\/|\/reels\/|\/video\/|\/watch/.test(url);
}

function detectPlatform(url) {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

// "title" arriva troncato da RSS-Bridge; "content_html" contiene la caption
// integrale (dopo i tag <video>/<img> dell'anteprima media), quindi va preferito.
function fullCaption(item) {
  const html = item.content_html || "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, (entity) => {
      const map = {
        "&agrave;": "à", "&aacute;": "á", "&acirc;": "â", "&atilde;": "ã", "&auml;": "ä", "&aring;": "å",
        "&egrave;": "è", "&eacute;": "é", "&ecirc;": "ê", "&euml;": "ë",
        "&igrave;": "ì", "&iacute;": "í", "&icirc;": "î", "&iuml;": "ï",
        "&ograve;": "ò", "&oacute;": "ó", "&ocirc;": "ô", "&otilde;": "õ", "&ouml;": "ö",
        "&ugrave;": "ù", "&uacute;": "ú", "&ucirc;": "û", "&uuml;": "ü",
        "&ntilde;": "ñ", "&ccedil;": "ç", "&szlig;": "ß",
        "&Agrave;": "À", "&Aacute;": "Á", "&Egrave;": "È", "&Eacute;": "É",
        "&Igrave;": "Ì", "&Iacute;": "Í", "&Ograve;": "Ò", "&Oacute;": "Ó",
        "&Ugrave;": "Ù", "&Uacute;": "Ú",
      };
      return map[entity] ?? entity;
    })
    .trim();
  return text || (item.title || "").trim() || null;
}

function rssBridgeUrl(platform, handle) {
  return platform === "instagram"
    ? `${RSS_BRIDGE_BASE}?action=display&bridge=Instagram&context=Username&u=${handle}&format=JSON`
    : `${RSS_BRIDGE_BASE}?action=display&bridge=TikTok&context=By+user&username=${handle}&format=JSON`;
}

// DIAGNOSTICA TEMPORANEA: stampa il primo item grezzo per piattaforma per
// verificare se RSS-Bridge espone metriche di engagement (like/commenti/view)
// che al momento vengono scartate da fullCaption()/il resto dello script.
// Da rimuovere una volta verificato.
const loggedRawItem = new Set();

async function fetchFeed(platform, handle) {
  const url = rssBridgeUrl(platform, handle);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Feed ${platform}/${handle} fallito: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const items = data.items ?? [];
    if (items.length > 0 && !loggedRawItem.has(platform)) {
      loggedRawItem.add(platform);
      console.log(`[diagnostica] item grezzo ${platform} (${handle}):`, JSON.stringify(items[0], null, 2));
    }
    return items;
  } catch (err) {
    console.error(`Feed ${platform}/${handle} errore: ${String(err)}`);
    return [];
  }
}

const { trends, sha } = await readTrendsJson();

if (!Array.isArray(trends.influencer_profiles)) trends.influencer_profiles = [];
if (!Array.isArray(trends.canali_cliente)) trends.canali_cliente = [];

const lists = [trends.canali_inspo, trends.influencer_profiles, trends.canali_cliente];

// Normalizza handle (rimuovi @) per tutte le liste
for (const list of lists) {
  for (const canale of list) {
    for (const account of canale.accounts) {
      if (account.handle) account.handle = normalizeHandle(account.handle);
    }
  }
}

// Genera la lista univoca di handle Instagram/TikTok da monitorare
const handles = lists
  .flatMap((list) => list.flatMap((c) => c.accounts))
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

let modified = false;

for (const list of lists) {
  for (const item of allItems) {
    const url = (item.url || item.id || "").trim();
    if (!url || !isPostUrl(url)) continue;

    const handle = normalizeHandle(item.author?.name || "") || null;

    const canale = list.find((c) => c.accounts.some((a) => a.handle === handle));
    if (!canale) continue;

    // Se l'URL esiste già ma manca la caption, aggiornala senza aggiungere un duplicato
    const existing = canale.accounts.find((a) => a.url === url);
    if (existing) {
      if (!existing.caption) {
        const caption = fullCaption(item);
        if (caption) {
          existing.caption = caption;
          modified = true;
        }
      }
      continue;
    }

    const date = item.date_modified || item.date_published || null;
    const caption = fullCaption(item);

    canale.accounts.push({
      platform: detectPlatform(url),
      handle,
      url,
      date,
      caption,
    });

    const posts = canale.accounts.filter((a) => isPostUrl(a.url));
    if (posts.length > MAX_POSTS_PER_CHANNEL) {
      canale.accounts = canale.accounts.filter((a) => a.url !== posts[0].url);
    }

    modified = true;
  }
}

if (!modified) {
  console.log("Nessuna novità, trends.json non modificato.");
  process.exit(0);
}

await writeTrendsJson(trends, sha);
console.log("trends.json aggiornato su GitHub.");
