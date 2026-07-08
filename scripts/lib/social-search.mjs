// Logica di ricerca/normalizzazione condivisa tra sync-brand-mentions.mjs
// (keyword statiche di un brand cliente) e sync-viral-trends.mjs (keyword
// dinamiche ricavate dagli hashtag TikTok in trend). Estratta qui perché
// entrambi gli script interrogano le stesse API (YouTube Data API v3,
// REST anysite) con la stessa logica di normalizzazione engagement/reach —
// un fix ai path anysite (vedi ANYSITE_ENDPOINTS) va fatto una volta sola.

export const ANYSITE_BASE = "https://api.anysite.io";
export const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3/search";
export const YOUTUBE_VIDEOS_BASE = "https://www.googleapis.com/youtube/v3/videos";

// path/param anysite: confermati per twitter, dedotti per gli altri (vedi
// PR #80 di sync-brand-mentions.mjs).
export const ANYSITE_ENDPOINTS = {
  twitter: { path: "/api/twitter/search/posts", param: "query" },
  reddit: { path: "/api/reddit/search/posts", param: "query" },
  instagram: { path: "/api/instagram/search/posts", param: "query" },
  linkedin: { path: "/api/linkedin/search/posts", param: "keywords" },
};

// nessun filtro lingua nativo noto per queste tre: va applicata l'euristica
// looksItalian() lato chiamante.
export const ANYSITE_LANGUAGE_HEURISTIC_PLATFORMS = ["reddit", "instagram", "linkedin"];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// anysite restituisce le date come timestamp Unix (secondi, es. "1782783856"),
// non come stringhe ISO: passate cosi' com'erano a Postgres davano
// "date/time field value out of range". Qui le normalizziamo tutte in ISO 8601.
export function toIsoDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const d = new Date(Number(value) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Parole funzionali molto comuni in italiano, improbabili per caso in altre
// lingue: euristica grezza per scartare contenuti chiaramente non italiani
// dove anysite non offre un filtro lingua nativo (reddit/instagram/linkedin).
const ITALIAN_STOPWORDS = new Set([
  "il",
  "lo",
  "la",
  "gli",
  "le",
  "di",
  "che",
  "non",
  "è",
  "un",
  "una",
  "per",
  "con",
  "sono",
  "questo",
  "questa",
  "della",
  "dei",
  "delle",
  "anche",
  "come",
  "più",
  "ma",
  "se",
  "molto",
  "suo",
  "loro",
  "nuovo",
  "nuova",
  "grazie",
]);

export function looksItalian(text) {
  if (!text) return false;
  const words = text.toLowerCase().match(/[a-zàèéìòù]+/g) ?? [];
  if (words.length === 0) return false;
  const hits = words.filter((w) => ITALIAN_STOPWORDS.has(w)).length;
  return hits >= 2;
}

// Rete di sicurezza indipendente dalla piattaforma: alcuni endpoint (in
// particolare quelli anysite con path/parametro dedotti e mai confermati da
// documentazione reale, es. linkedin) possono restituire risultati che non
// c'entrano nulla con la keyword cercata — probabile che il parametro di
// ricerca venga ignorato server-side. Scarta qui qualunque risultato il cui
// contenuto non menzioni davvero la keyword (o la sua parola principale).
export function containsKeyword(content, keyword) {
  if (!content) return false;
  const text = content.toLowerCase();
  const words = keyword
    .toLowerCase()
    .split(/[\s_]+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return text.includes(keyword.toLowerCase());
  return words.some((w) => text.includes(w));
}

// item.author non e' sempre una stringa: linkedin restituisce un oggetto
// ({@type, internal_id, name, alias, url, headline, image, ...}) che prima
// finiva stringificato per intero nel campo autore. Qui estraiamo solo il
// nome leggibile, qualunque sia la forma (stringa o oggetto annidato).
export function extractAuthorName(item) {
  const candidates = [item.author, item.username, item.user?.username, item.channel];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate && typeof candidate === "object") {
      const name = candidate.name ?? candidate.username ?? candidate.alias ?? candidate.handle;
      if (typeof name === "string" && name.trim()) return name;
    }
  }
  return null;
}

export async function searchYouTube({ apiKey, keyword, region, language, maxResults }) {
  const url = new URL(YOUTUBE_BASE);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", keyword);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
  url.searchParams.set("regionCode", region);
  url.searchParams.set("relevanceLanguage", language);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.items ?? [];
}

// search.list non include statistiche (viste/like/commenti): videos.list le
// da' in un'unica chiamata batch per fino a 50 ID, costo 1 unita' di quota
// totale (non per video) — molto piu' economico che chiamarla per ogni item.
export async function fetchVideoStatistics({ apiKey, videoIds }) {
  if (videoIds.length === 0) return new Map();

  const url = new URL(YOUTUBE_VIDEOS_BASE);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube videos.list failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return new Map((data.items ?? []).map((v) => [v.id, v.statistics ?? {}]));
}

// Non include "sentiment": e' specifico del caso d'uso brand monitoring,
// va aggiunto dal chiamante se serve.
export function normalizeYouTubeResult({ keyword, item, statsByVideoId }) {
  const videoId = item.id?.videoId ?? "";
  const snippet = item.snippet ?? {};
  const stats = statsByVideoId.get(videoId) ?? {};
  const likes = Number(stats.likeCount ?? 0);
  const comments = Number(stats.commentCount ?? 0);
  const views = stats.viewCount != null ? Number(stats.viewCount) : null;

  return {
    platform: "youtube",
    external_id: videoId || `youtube-${keyword}-${Math.random().toString(36).slice(2)}`,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    author: snippet.channelTitle ?? null,
    content: [snippet.title, snippet.description].filter(Boolean).join(" — "),
    published_at: toIsoDate(snippet.publishedAt),
    keyword_matched: keyword,
    engagement: likes + comments,
    reach: views,
    is_viral: likes + comments > 1000,
    raw: item,
  };
}

export async function searchAnysite({ apiKey, platform, keyword, language, maxResults }) {
  const { path, param } = ANYSITE_ENDPOINTS[platform];
  const url = new URL(path, ANYSITE_BASE);

  // Twitter/X supporta l'operatore lang: nella query stessa (sintassi nativa
  // di ricerca X, inoltrata cosi' com'e' da anysite). E' l'unica delle 4
  // piattaforme anysite con un filtro lingua noto e affidabile.
  const query = platform === "twitter" ? `${keyword} lang:${language}` : keyword;

  const res = await fetch(url, {
    method: "POST",
    headers: { "access-token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ [param]: query, count: maxResults }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anysite ${platform} search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? data.data ?? data.items ?? []);
}

// Non include "sentiment": vedi normalizeYouTubeResult.
export function normalizeAnysiteResult({ platform, keyword, item }) {
  const externalId = String(item.id ?? item.post_id ?? item.external_id ?? item.url ?? "");
  const url = item.url ?? item.link ?? item.permalink ?? "";
  const content = item.text ?? item.content ?? item.caption ?? item.title ?? item.body ?? "";
  const author = extractAuthorName(item);
  const publishedAt = toIsoDate(item.published_at ?? item.created_at ?? item.date ?? null);
  const likes = item.likes ?? item.like_count ?? 0;
  const shares = item.shares ?? item.retweet_count ?? item.share_count ?? 0;
  const comments = item.comments ?? item.comment_count ?? item.reply_count ?? 0;
  const reach = item.followers ?? item.follower_count ?? item.reach ?? null;
  const engagement = Number(likes) + Number(shares) + Number(comments);

  return {
    platform,
    external_id: externalId || `${platform}-${keyword}-${Math.random().toString(36).slice(2)}`,
    url,
    author,
    content,
    published_at: publishedAt,
    keyword_matched: keyword,
    engagement,
    reach,
    is_viral: engagement > 1000,
    raw: item,
  };
}
