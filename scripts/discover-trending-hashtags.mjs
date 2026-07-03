// Scopre i topic in trend in Italia via Google Trends RSS (pubblico, no auth, no browser).
// Li converte in hashtag TikTok-style (lowercase, senza spazi).
//
// Fallback: lista hardcoded di hashtag IT sempre rilevanti.

const GOOGLE_TRENDS_IT_URL =
  "https://trends.google.com/trends/trendingsearches/daily/rss?geo=IT";

const FALLBACK_HASHTAGS = [
  "italia", "viral", "fyp", "trend",
  "calcio", "food", "moda", "musica", "estate",
  "milano", "roma", "vacanze", "humor", "notizie",
];

function topicToHashtag(title) {
  return title
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñçß]/g, "")
    .trim();
}

async function discoverFromGoogleTrends() {
  const res = await fetch(GOOGLE_TRENDS_IT_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TrendzBot/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Google Trends RSS: HTTP ${res.status}`);

  const xml = await res.text();

  // Estrae titoli con CDATA
  const cdataMatches = [...xml.matchAll(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/g)];
  const cdataTitles = cdataMatches.map((m) => m[1].trim()).filter(Boolean);

  // Estrae titoli senza CDATA, escludendo il titolo del feed
  const plainMatches = [...xml.matchAll(/<title>([^<]+)<\/title>/g)];
  const plainTitles = plainMatches
    .map((m) => m[1].trim())
    .filter((t) => !t.toLowerCase().includes("google") && t.length > 1);

  const all = [...new Set([...cdataTitles, ...plainTitles])];

  const hashtags = all
    .map(topicToHashtag)
    .filter((t) => t.length >= 3 && t.length <= 40);

  return [...new Set(hashtags)];
}

export async function discoverTrendingHashtags() {
  console.error("[discover] Cerco trend IT da Google Trends RSS…");
  try {
    const tags = await discoverFromGoogleTrends();
    if (tags.length >= 5) {
      console.error(`[discover] ${tags.length} hashtag da Google Trends IT`);
      return tags.slice(0, 20);
    }
    console.error(`[discover] Solo ${tags.length} hashtag da Google Trends — uso fallback`);
    return [...new Set([...tags, ...FALLBACK_HASHTAGS])].slice(0, 15);
  } catch (err) {
    console.error(`[discover] Errore Google Trends: ${String(err)} — uso fallback`);
    return FALLBACK_HASHTAGS.slice(0, 15);
  }
}

// Esecuzione standalone: node scripts/discover-trending-hashtags.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const tags = await discoverTrendingHashtags();
  console.log(JSON.stringify(tags, null, 2));
  console.error(`\n${tags.length} hashtag trovati`);
}
