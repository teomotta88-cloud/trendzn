import { createRequire } from "module";
import { Rettiwt } from "rettiwt-api";

const require = createRequire(import.meta.url);
const rettiwtVersion = require("rettiwt-api/package.json").version;

const API_KEY = process.env.RETTIWT_API_KEY;
const TARGET_RAW = process.env.PROBE_SCREEN_NAME || "NASA";
const TARGET = TARGET_RAW.replace(/^@/, "").trim();

console.log("=== Probe X account ===");
console.log(`rettiwt-api versione installata: ${rettiwtVersion}`);
console.log(`target: @${TARGET}`);
console.log(`API_KEY presente: ${API_KEY ? `sì (${API_KEY.length} char)` : "NO"}`);

if (!API_KEY) {
  console.error("Manca RETTIWT_API_KEY nei secrets/env.");
  process.exit(1);
}

const rettiwt = new Rettiwt({ apiKey: API_KEY });

function printError(label, err) {
  console.log(`\n[${label}] FALLITO:`);
  console.log("  name:", err?.name || null);
  console.log("  message:", err?.message || String(err));
  console.log("  code:", err?.code || null);
  console.log("  status:", err?.status || null);

  if (err?.data) {
    try {
      console.log("  data:", JSON.stringify(err.data, null, 2).slice(0, 2000));
    } catch {
      console.log("  data:", err.data);
    }
  }

  if (err?.stack) {
    console.log("  stack head:", err.stack.split("\n").slice(0, 4).join("\n"));
  }
}

function summarizeTweet(tweet, index) {
  const id = tweet?.id || tweet?.id_str || tweet?.tweetId || tweet?.rest_id || null;
  const text =
    tweet?.fullText ||
    tweet?.text ||
    tweet?.content ||
    tweet?.tweetText ||
    tweet?.legacy?.full_text ||
    null;

  const createdAt =
    tweet?.createdAt || tweet?.created_at || tweet?.date || tweet?.legacy?.created_at || null;

  const metrics = tweet?.statistics || tweet?.stats || tweet?.public_metrics || tweet?.legacy || {};

  console.log(`\n  #${index + 1}`);
  console.log("  id:", id);
  console.log("  url:", id ? `https://x.com/${TARGET}/status/${id}` : null);
  console.log("  date:", createdAt);
  console.log("  text:", text ? String(text).replace(/\s+/g, " ").slice(0, 220) : null);
  console.log("  metrics:", {
    likes: metrics.likeCount ?? metrics.favorite_count ?? metrics.likes ?? null,
    reposts: metrics.retweetCount ?? metrics.retweet_count ?? metrics.retweets ?? null,
    replies: metrics.replyCount ?? metrics.reply_count ?? metrics.replies ?? null,
    quotes: metrics.quoteCount ?? metrics.quote_count ?? metrics.quotes ?? null,
    views: metrics.viewCount ?? metrics.views ?? null,
  });
}

async function tryCall(label, fn) {
  try {
    const result = await fn();
    console.log(`\n[${label}] OK`);

    if (Array.isArray(result)) {
      console.log(`  array length: ${result.length}`);
      result.slice(0, 5).forEach(summarizeTweet);
      return result;
    }

    if (result?.list && Array.isArray(result.list)) {
      console.log(`  list length: ${result.list.length}`);
      result.list.slice(0, 5).forEach(summarizeTweet);
      return result;
    }

    if (result?.tweets && Array.isArray(result.tweets)) {
      console.log(`  tweets length: ${result.tweets.length}`);
      result.tweets.slice(0, 5).forEach(summarizeTweet);
      return result;
    }

    console.log(
      "  result keys:",
      result && typeof result === "object" ? Object.keys(result) : null,
    );
    console.log("  result preview:", JSON.stringify(result, null, 2).slice(0, 2000));
    return result;
  } catch (err) {
    printError(label, err);
    return null;
  }
}

let user = null;

user = await tryCall("user.details(screenName)", async () => {
  return await rettiwt.user.details(TARGET);
});

const userId = user?.id || user?.id_str || user?.rest_id || null;

if (user) {
  console.log("\n[user summary]");
  console.log("  userName:", user.userName || user.username || user.screenName || null);
  console.log("  fullName:", user.fullName || user.name || null);
  console.log("  id:", userId);
  console.log("  followers:", user.followersCount ?? user.followers ?? null);
  console.log("  statuses:", user.statusesCount ?? user.statuses ?? null);
}

// Variante 1: quella già usata, ma la teniamo per confronto.
await tryCall("tweet.search({ fromUsers: [screenName] })", async () => {
  return await rettiwt.tweet.search({
    fromUsers: [TARGET],
    count: 10,
  });
});

// Variante 2: fromUsers lowercase, nel caso la libreria sia schizzinosa.
await tryCall("tweet.search({ fromUsers: [lowercase] })", async () => {
  return await rettiwt.tweet.search({
    fromUsers: [TARGET.toLowerCase()],
    count: 10,
  });
});

// Variante 3: query search classica X/Twitter.
await tryCall('tweet.search("from:screenName")', async () => {
  return await rettiwt.tweet.search({
    query: `from:${TARGET}`,
    count: 10,
  });
});

// Variante 4: query search con @.
await tryCall('tweet.search("from:@screenName")', async () => {
  return await rettiwt.tweet.search({
    query: `from:@${TARGET}`,
    count: 10,
  });
});

// Variante 5: se la libreria espone un metodo timeline/lista tweet utente.
if (typeof rettiwt.tweet.timeline === "function") {
  await tryCall("tweet.timeline(screenName)", async () => {
    return await rettiwt.tweet.timeline(TARGET, 10);
  });
} else {
  console.log("\n[tweet.timeline] metodo non disponibile nella versione installata.");
}

if (typeof rettiwt.tweet.user === "function") {
  await tryCall("tweet.user(screenName)", async () => {
    return await rettiwt.tweet.user(TARGET, 10);
  });
} else {
  console.log("\n[tweet.user] metodo non disponibile nella versione installata.");
}

if (typeof rettiwt.tweet.userTweets === "function") {
  await tryCall("tweet.userTweets(screenName)", async () => {
    return await rettiwt.tweet.userTweets(TARGET, 10);
  });
} else {
  console.log("\n[tweet.userTweets] metodo non disponibile nella versione installata.");
}

if (userId && typeof rettiwt.tweet.userTweets === "function") {
  await tryCall("tweet.userTweets(userId)", async () => {
    return await rettiwt.tweet.userTweets(userId, 10);
  });
}

console.log("\n=== Fine probe ===");
