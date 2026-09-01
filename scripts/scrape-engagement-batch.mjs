import fs from "fs/promises";

const STORE_PATH = "src/data/bluserena-monitoring.json";
const SCRAPECREATORS_API_KEY = process.env.SCRAPECREATORS_API_KEY;

if (!SCRAPECREATORS_API_KEY) {
  console.error("❌ Missing SCRAPECREATORS_API_KEY environment variable");
  process.exit(1);
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("❌ Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTikTokVideoId(url) {
  const match = url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/);
  return match?.[1] || null;
}

function normalizeTikTokUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

async function fetchPostData(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const videoId = extractTikTokVideoId(url);
      if (!videoId) {
        return { url, error: "Could not extract video ID from URL" };
      }

      const response = await fetch(
        `https://api.scrapecreators.com/v1/tiktok/video?video_id=${videoId}`,
        {
          headers: { "x-api-key": SCRAPECREATORS_API_KEY },
          signal: AbortSignal.timeout(15000),
        }
      );

      const text = await response.text();
      if (!response.ok) {
        if (attempt < retries) {
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw new Error(`${response.status}: ${text.substring(0, 200)}`);
      }

      const data = JSON.parse(text);
      if (!data || typeof data !== "object") {
        return { url, error: "Invalid response format" };
      }

      const item = data.data || data;
      return {
        url,
        views: item.statistics?.play_count ?? null,
        likes: item.statistics?.digg_count ?? null,
        comments: item.statistics?.comment_count ?? null,
        shares: item.statistics?.share_count ?? null,
        caption: item.desc ?? null,
      };
    } catch (err) {
      if (attempt === retries) {
        console.error(`  ⚠️  ${url}: ${err.message}`);
        return { url, error: err.message };
      }
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}

async function main() {
  try {
    console.log("📥 Reading bluserena-monitoring.json...");
    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    const urls = [];
    const urlToAccount = new Map();

    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        if (!account.url) continue;

        const date = new Date(account.date);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;

        // Filter: only Jul-Aug 2025 and Jul-Aug 2026
        const isJulAug = (month === 7 || month === 8);
        const isTargetYear = (year === 2025 || year === 2026);

        if (isJulAug && isTargetYear) {
          urls.push(account.url);
          urlToAccount.set(account.url, account);
        }
      }
    }

    console.log(`📊 Found ${urls.length} URLs for Jul-Aug 2025-2026`);
    console.log(`\n🔄 Fetching engagement data from Emplifi...\n`);

    let updated = 0;
    let failed = 0;
    const batchSize = 5;

    // Process URLs in parallel batches (5 at a time)
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      console.log(`⏳ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urls.length / batchSize)} (URLs ${i + 1}-${Math.min(i + batchSize, urls.length)})...`);

      const results = await Promise.all(batch.map(url => fetchPostData(url)));

      for (const result of results) {
        const account = urlToAccount.get(result.url);
        if (!account) continue;

        if (result.error) {
          failed++;
          continue;
        }

        if (result.caption && !account.caption) {
          account.caption = result.caption;
        }

        if (result.views !== undefined && result.views !== null) account.views = result.views;
        if (result.likes !== undefined && result.likes !== null) account.likes = result.likes;
        if (result.comments !== undefined && result.comments !== null) account.comments = result.comments;
        if (result.shares !== undefined && result.shares !== null) account.shares = result.shares;

        updated++;
      }

      // Rate limiting: wait between batches
      if (i + batchSize < urls.length) {
        await sleep(1000);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Failed: ${failed}`);

    if (updated === 0) {
      console.log("\nNo updates made, skipping commit.");
      process.exit(0);
    }

    // Write updated JSON locally
    console.log(`\n💾 Writing updated JSON...`);
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));

    // Commit to GitHub
    console.log(`📤 Committing to GitHub...`);
    const res = await fetch(
      `https://api.github.com/repos/teomotta88-cloud/trendzn/contents/${STORE_PATH}`,
      {
        headers: ghHeaders,
      }
    );
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(
      `https://api.github.com/repos/teomotta88-cloud/trendzn/contents/${STORE_PATH}`,
      {
        method: "PUT",
        headers: {
          ...ghHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore: update engagement data for Jul-Aug 2025-2026 posts via Emplifi

- Updated caption, views, likes, comments, shares for ${updated} posts
- Parallel batch processing from Emplifi API
- Jul-Aug 2025-2026 timeframe`,
          content,
          sha: fileData.sha,
        }),
      }
    );

    console.log("✅ Committed successfully!");
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();
