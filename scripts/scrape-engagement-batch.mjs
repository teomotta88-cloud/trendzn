import fs from "fs/promises";

const STORE_PATH = "src/data/bluserena-monitoring.json";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
const SCRAPER_API_ENDPOINT = process.env.SCRAPER_API_ENDPOINT || "https://api.scrapecreator.com/batch";

if (!SCRAPER_API_KEY) {
  console.error("❌ SCRAPER_API_KEY environment variable not set");
  process.exit(1);
}

async function main() {
  try {
    console.log("📥 Reading bluserena-monitoring.json...");
    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    // Extract all URLs for Jul-Aug 2025-2026
    const urls = [];
    const urlToAccount = new Map(); // Map URL to account for later update

    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        const date = new Date(account.date);
        const month = date.getMonth() + 1;
        
        if ((month === 7 || month === 8) && account.url) {
          urls.push(account.url);
          urlToAccount.set(account.url, account);
        }
      }
    }

    console.log(`📊 Found ${urls.length} URLs for Jul-Aug 2025-2026`);
    console.log(`\n🔄 Sending batch request to ScraperCreator...`);

    // Prepare batch request
    const batchRequest = {
      urls: urls,
      fields: ["caption", "views", "likes", "comments", "shares"],
      options: {
        timeout: 30000,
        retries: 2
      }
    };

    console.log(`Request size: ${urls.length} URLs, fields: ${batchRequest.fields.join(", ")}`);

    // Send batch request
    const response = await fetch(SCRAPER_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SCRAPER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batchRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ ScraperCreator API error: ${response.status}`);
      console.error(error);
      process.exit(1);
    }

    const results = await response.json();
    console.log(`✅ Batch request completed`);
    console.log(`   Total results: ${results.data?.length || 0}`);

    let updated = 0;
    let failed = 0;

    // Update JSON with scraped data
    for (const result of results.data || []) {
      const account = urlToAccount.get(result.url);
      if (!account) continue;

      if (result.error) {
        console.log(`⚠️  ${result.url}: ${result.error}`);
        failed++;
        continue;
      }

      // Update caption if not already present
      if (result.caption && !account.caption) {
        account.caption = result.caption;
      }

      // Update engagement metrics
      if (result.views !== undefined) account.views = result.views;
      if (result.likes !== undefined) account.likes = result.likes;
      if (result.comments !== undefined) account.comments = result.comments;
      if (result.shares !== undefined) account.shares = result.shares;

      updated++;
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
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(
      `https://api.github.com/repos/teomotta88-cloud/trendzn/contents/${STORE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore: update engagement data for Jul-Aug 2025-2026 posts via ScraperCreator

- Updated caption, views, likes, comments, shares for ${updated} posts
- Single batch request to ScraperCreator API for efficiency
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
