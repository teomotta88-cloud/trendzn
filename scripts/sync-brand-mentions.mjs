// Reputazione Brand: cerca menzioni del brand su Twitter/X, Reddit, Instagram,
// YouTube, LinkedIn tramite la REST API di anysite (https://api.anysite.io),
// classifica il sentiment (regole da .claude/skills/anysite-brand-reputation/
// references/MONITORING_GUIDE.md) e invia il risultato all'hook
// sync-brand-mentions, che fa l'upsert su Supabase (vedi sync-tiktok-hashtag.mjs
// per lo stesso pattern: script esterno -> hook pubblico -> supabaseAdmin).
//
// Variabili d'ambiente:
//   ANYSITE_API_KEY        obbligatoria, header "access-token" per api.anysite.io
//   KEYWORDS                csv, default: "hyundai,hyundai_italia"
//   MAX_RESULTS_PER_CALL    default: 25 (ogni risultato consuma credit anysite)
//   DELAY_BETWEEN_CALLS_MS  default: 2000
//
// NOTA: primo run (workflow #<vedi log>) ha dato 404 su tutte le piattaforme
// perche' i path erano indovinati come GET /{platform}/search. Il formato reale
// e' POST /api/{platform}/search/{noun} con body JSON (confermato per twitter
// via ricerca pubblica: "/api/twitter/search/posts"). reddit/instagram/youtube/
// linkedin sono per ora dedotti per coerenza di naming con lo stesso pattern +
// i nomi tool della skill (search_reddit_posts, search_instagram_posts,
// search_youtube_videos, search_linkedin_posts) — da confermare al prossimo
// run e aggiustare se ancora 404. Se necessario, i campi di normalizeResult()
// vanno adeguati in base alla risposta JSON reale.
//
// Eseguito da .github/workflows/sync-brand-mentions.yml su schedule.

const ANYSITE_BASE = "https://api.anysite.io";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-brand-mentions";

const apiKey = process.env.ANYSITE_API_KEY;
if (!apiKey) {
  console.error("Manca ANYSITE_API_KEY nell'ambiente.");
  process.exit(1);
}

const KEYWORDS = (process.env.KEYWORDS ?? "hyundai,hyundai_italia")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const MAX_RESULTS_PER_CALL = parseInt(process.env.MAX_RESULTS_PER_CALL ?? "25", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "2000", 10);

// path/param confermati per twitter; gli altri sono dedotti per coerenza
// (vedi nota in testa al file) e vanno riverificati al prossimo run.
const PLATFORM_ENDPOINTS = {
  twitter: { path: "/api/twitter/search/posts", param: "query" },
  reddit: { path: "/api/reddit/search/posts", param: "query" },
  instagram: { path: "/api/instagram/search/posts", param: "query" },
  youtube: { path: "/api/youtube/search/videos", param: "query" },
  linkedin: { path: "/api/linkedin/search/posts", param: "keywords" },
};

// Framework "Manual Sentiment Classification" dal MONITORING_GUIDE.md della skill.
const POSITIVE_WORDS = [
  "love", "great", "amazing", "best", "recommend", "recommended",
  "consiglio", "consigliato", "fantastico", "ottimo", "top",
];
const NEGATIVE_WORDS = [
  "disappointed", "worst", "terrible", "awful", "broken", "refund", "problem",
  "deluso", "pessimo", "rotto", "rimborso", "problema", "guasto",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifySentiment(text) {
  const t = (text ?? "").toLowerCase();
  const positive = POSITIVE_WORDS.some((w) => t.includes(w));
  const negative = NEGATIVE_WORDS.some((w) => t.includes(w));
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  return "neutral";
}

async function searchPlatform(platform, keyword) {
  const { path, param } = PLATFORM_ENDPOINTS[platform];
  const url = new URL(path, ANYSITE_BASE);

  const res = await fetch(url, {
    method: "POST",
    headers: { "access-token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ [param]: keyword, count: MAX_RESULTS_PER_CALL }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anysite ${platform} search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.results ?? data.data ?? data.items ?? []);
  return items;
}

function normalizeResult(platform, keyword, item) {
  const externalId = String(item.id ?? item.post_id ?? item.external_id ?? item.url ?? "");
  const url = item.url ?? item.link ?? item.permalink ?? "";
  const content = item.text ?? item.content ?? item.caption ?? item.title ?? item.body ?? "";
  const author = item.author ?? item.username ?? item.user?.username ?? item.channel ?? null;
  const publishedAt = item.published_at ?? item.created_at ?? item.date ?? null;
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
    sentiment: classifySentiment(content),
    engagement,
    reach,
    is_viral: engagement > 1000,
    raw: item,
  };
}

async function sendToHook(mentions, run) {
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mentions, run }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync endpoint failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — Reputazione Brand (anysite) ===");
console.log(`Keyword: ${KEYWORDS.join(", ")}`);

const platforms = Object.keys(PLATFORM_ENDPOINTS);
let totalInserted = 0;
const summary = [];

for (const platform of platforms) {
  for (const keyword of KEYWORDS) {
    const startedAt = new Date().toISOString();
    console.log(`\n[${platform}] "${keyword}"`);
    try {
      const items = await searchPlatform(platform, keyword);
      const mentions = items.map((item) => normalizeResult(platform, keyword, item));
      console.log(`  Trovate ${mentions.length} mention`);

      const result = await sendToHook(mentions, {
        platform,
        keyword,
        requests_used: 1,
        mentions_found: mentions.length,
        status: "ok",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      totalInserted += result.inserted ?? 0;
      summary.push({ platform, keyword, found: mentions.length, inserted: result.inserted ?? 0 });
      console.log(`  Inserite: ${result.inserted ?? 0}`);
    } catch (err) {
      console.error(`  ERRORE: ${String(err)}`);
      summary.push({ platform, keyword, error: String(err) });
      await sendToHook([], {
        platform,
        keyword,
        requests_used: 1,
        mentions_found: 0,
        status: "error",
        error_message: String(err).slice(0, 500),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      }).catch(() => {});
    }

    await sleep(DELAY_MS);
  }
}

console.log("\n=== RIEPILOGO ===");
for (const r of summary) {
  if (r.error) {
    console.log(`  [${r.platform}] "${r.keyword}": ERRORE — ${r.error}`);
  } else {
    console.log(`  [${r.platform}] "${r.keyword}": ${r.found} trovate → ${r.inserted} inserite`);
  }
}
console.log(`\nTotale nuove mention inserite: ${totalInserted}`);
