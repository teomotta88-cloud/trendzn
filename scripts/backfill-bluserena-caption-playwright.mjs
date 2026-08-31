import { chromium } from "playwright";
import fs from "fs/promises";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const ghHeaders = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

// Resort list with exact hashtags
const RESORTS_WITH_HASHTAGS = [
  { name: "Is Serenas Badesi Resort", hashtag: "#IsSerenasBadesiResort" },
  { name: "Calaserena Resort", hashtag: "#CalaserenaResort" },
  { name: "Serenusa Resort", hashtag: "#SerenusaResort" },
  { name: "Serena Majestic Hotel Residence", hashtag: "#SerenaMajesticHotelResidence" },
  { name: "Sibari Green Resort", hashtag: "#SibariGreenResort" },
  { name: "Serenè Resort", hashtag: "#SerenèResort" },
  { name: "Granserena Hotel", hashtag: "#GranserenaHotel" },
  { name: "Torreserena Resort", hashtag: "#TorreserenaResort" },
  { name: "Calanè Resort", hashtag: "#CalanèResort" },
  { name: "Valentino Resort", hashtag: "#ValentinoResort" },
  { name: "Kalidria Hotel & Thalasso SPA", hashtag: "#KalidriaHotel" },
  { name: "Alborèa Ecolodge Resort", hashtag: "#AlborèaEcolodgeResort" },
  { name: "Ethra Reserve", hashtag: "#EthraReserve" },
];

function isBsconfirmed(caption) {
  if (!caption) return false;

  const lower = caption.toLowerCase();

  // Exact match for "bluserena" or "#bluserena"
  if (/\bbluserena\b/.test(lower) || /#bluserena\b/.test(lower)) {
    return true;
  }

  // Check for exact resort hashtags (case-sensitive in hashtag part)
  for (const resort of RESORTS_WITH_HASHTAGS) {
    if (caption.includes(resort.hashtag)) {
      return true;
    }
  }

  return false;
}

function extractLocation(caption) {
  if (!caption) return null;

  const lower = caption.toLowerCase();

  // Check for "bluserena" first
  if (lower.includes("bluserena")) {
    return "Bluserena";
  }

  // Check for resort names
  for (const resort of RESORTS_WITH_HASHTAGS) {
    if (lower.includes(resort.name.toLowerCase())) {
      return resort.name;
    }
  }

  return null;
}

async function extractCaptionFromTikTok(url) {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.createBrowserContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    console.log(`  Fetching caption from ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for caption to be visible
    await page.waitForSelector("div[data-testid='video-desc']", { timeout: 5000 }).catch(() => null);

    const caption = await page.evaluate(() => {
      // Try multiple selectors for TikTok caption
      const desc = document.querySelector("div[data-testid='video-desc']")?.textContent;
      if (desc) return desc.trim();

      const h1 = document.querySelector("h1[data-testid='video-desc-title']")?.textContent;
      if (h1) return h1.trim();

      const span = document.querySelector("span.video-desc-title")?.textContent;
      if (span) return span.trim();

      return null;
    });

    await context.close();
    return caption;
  } catch (err) {
    console.error(`  Error fetching caption: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

function isInJulyAugust(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  return month === 7 || month === 8;
}

async function main() {
  try {
    console.log("\u{1F4E5} Reading bluserena-monitoring.json...");

    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    let updated = 0;
    let confirmed = 0;
    let skipped = 0;
    let fetched = 0;

    const postsToUpdate = [];

    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        // Solo luglio-agosto 2025-2026
        if (!isInJulyAugust(account.date)) {
          skipped++;
          continue;
        }

        // Solo se non ha caption
        if (account.caption && account.caption.trim() !== "") {
          skipped++;
          continue;
        }

        // Solo se ha URL TikTok
        if (!account.url || !/tiktok\.com/.test(account.url)) {
          skipped++;
          continue;
        }

        postsToUpdate.push(account);
      }
    }

    console.log(`\u{1F50D} Found ${postsToUpdate.length} TikTok posts without caption`);
    console.log(`\u{23ED} Skipped ${skipped} posts (already have caption or no TikTok URL)`);

    for (let i = 0; i < postsToUpdate.length; i++) {
      const account = postsToUpdate[i];

      const caption = await extractCaptionFromTikTok(account.url);

      if (caption && caption.trim()) {
        account.caption = caption;
        fetched++;

        const isConfirmed = isBsconfirmed(caption);
        if (isConfirmed) {
          account.bsconfirmed = true;
          confirmed++;
        }

        const location = extractLocation(caption);
        if (location && !account.location) {
          account.location = location;
        }

        updated++;
        console.log(
          `[${i + 1}/${postsToUpdate.length}] \u{2705} ${account.handle || "unknown"}: caption extracted${isConfirmed ? " (confirmed)" : ""}`
        );
      } else {
        console.log(`[${i + 1}/${postsToUpdate.length}] \u{26A0} ${account.handle || "unknown"}: no caption found`);
      }

      // Rate limiting to avoid overloading
      if (i % 5 === 0 && i > 0) {
        console.log(`  Pausing 2 seconds...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`\n\u{1F4CA} Summary:`);
    console.log(`  Fetched: ${fetched}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Confirmed: ${confirmed}`);
    console.log(`  Skipped: ${skipped}`);

    if (updated === 0) {
      console.log("\nNo changes made, skipping commit.");
      process.exit(0);
    }

    // Commit
    console.log(`\n\u{1F4BE} Updating file and committing to GitHub...`);

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      headers: ghHeaders,
    });
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: backfill caption and bsconfirmed flag via Playwright

- Extracted ${fetched} captions from TikTok using Playwright
- Marked ${confirmed} posts as bsconfirmed (bluserena or resort mention found)
- Extracted location for ${updated} posts
- Method: Playwright browser automation for caption extraction`,
        content,
        sha: fileData.sha,
      }),
    });

    console.log("✅ Committed successfully!");
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();
