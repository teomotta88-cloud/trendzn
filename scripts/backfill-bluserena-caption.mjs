import https from "https";
import fs from "fs";
import { Octokit } from "@octokit/rest";

const STORE_PATH = "src/data/bluserena-monitoring.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RAW_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/" + STORE_PATH;

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

function isInJulyAugust(date) {
  if (!date) return false;
  const d = new Date(date);
  const month = d.getMonth() + 1;
  return month === 7 || month === 8;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRSSBridge(url) {
  return new Promise((resolve, reject) => {
    const rssUrl = `https://rss-bridge.org/?action=display&bridge=TikTok_Bridge&url=${encodeURIComponent(url)}&format=json`;

    https.get(rssUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function extractMetadata(rssData) {
  if (!rssData || !rssData.items || rssData.items.length === 0) {
    return null;
  }

  const item = rssData.items[0];
  const result = {
    caption: item.title || null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
  };

  // Estrai view count dalla description (RSS-Bridge lo mette qui)
  if (item.content_html) {
    const viewMatch = item.content_html.match(/(\d+)\s*views?/i);
    if (viewMatch) result.views = parseInt(viewMatch[1]);

    const likeMatch = item.content_html.match(/(\d+)\s*likes?/i);
    if (likeMatch) result.likes = parseInt(likeMatch[1]);

    const commentMatch = item.content_html.match(/(\d+)\s*comments?/i);
    if (commentMatch) result.comments = parseInt(commentMatch[1]);

    const shareMatch = item.content_html.match(/(\d+)\s*shares?/i);
    if (shareMatch) result.shares = parseInt(shareMatch[1]);
  }

  // Fallback: prova anche dalla description
  if (item.description && typeof item.description === "string") {
    if (!result.views) {
      const viewMatch = item.description.match(/(\d+)\s*views?/i);
      if (viewMatch) result.views = parseInt(viewMatch[1]);
    }
  }

  return result;
}

async function main() {
  try {
    console.log("📥 Fetching JSON from GitHub...");
    const jsonRes = await fetch(RAW_JSON_URL);
    const data = await jsonRes.json();

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Filtra post
    const postsToUpdate = [];
    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        // Solo TikTok
        if (account.platform !== "tiktok") continue;

        // Solo luglio-agosto 25-26
        if (!isInJulyAugust(account.date)) continue;

        // Solo se ha campi null
        if (
          account.caption ||
          account.views ||
          account.likes ||
          account.comments ||
          account.shares
        ) {
          skipped++;
          continue;
        }

        postsToUpdate.push({ canale, account });
      }
    }

    console.log(`🔍 Found ${postsToUpdate.length} posts to backfill`);
    console.log(`⏭️  Skipped ${skipped} posts (already have data)`);

    for (let i = 0; i < postsToUpdate.length; i++) {
      const { canale, account } = postsToUpdate[i];

      try {
        console.log(`[${i + 1}/${postsToUpdate.length}] Processing ${account.url}`);

        // Fetch da RSS-Bridge
        const rssData = await fetchRSSBridge(account.url);
        const metadata = extractMetadata(rssData);

        if (metadata) {
          // Aggiorna il post
          if (metadata.caption) account.caption = metadata.caption;
          if (metadata.views) account.views = metadata.views;
          if (metadata.likes) account.likes = metadata.likes;
          if (metadata.comments) account.comments = metadata.comments;
          if (metadata.shares) account.shares = metadata.shares;

          updated++;
          console.log(`  ✅ Updated: caption=${!!metadata.caption}, views=${metadata.views}`);
        } else {
          console.log(`  ⚠️  No data found from RSS-Bridge`);
          errors++;
        }

        // Delay per evitare rate limiting
        await delay(500);
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
        errors++;
        await delay(1000);
      }
    }

    console.log("\n📊 Summary:");
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);

    // Fetch file SHA
    console.log("\n💾 Committing to GitHub...");
    const { data: fileData } = await octokit.repos.getContent({
      owner: "teomotta88-cloud",
      repo: "trendzn",
      path: STORE_PATH,
    });

    // Commit
    await octokit.repos.createOrUpdateFileContents({
      owner: "teomotta88-cloud",
      repo: "trendzn",
      path: STORE_PATH,
      message: `chore: backfill caption and engagement data for Jul-Aug 2025-2026 posts

- Updated ${updated} posts with caption, views, likes, comments, shares
- Source: RSS-Bridge
- Filtered: Only Jul-Aug 2025 and 2026 posts with null fields`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
      sha: fileData.sha,
    });

    console.log("✅ Committed successfully!");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
