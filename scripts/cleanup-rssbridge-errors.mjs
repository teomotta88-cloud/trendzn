import fs from "fs/promises";

const STORE_PATH = "src/data/bluserena-monitoring.json";

async function main() {
  try {
    console.log("\u{1F4E5} Reading bluserena-monitoring.json...");

    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    let cleaned = 0;
    let total = 0;

    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        total++;
        // Check if caption is an RSS-Bridge error (contains "ClientException" or stack trace)
        if (
          account.caption &&
          (account.caption.includes("ClientException") ||
            account.caption.includes("Code: 400") ||
            account.caption.includes("Invalid parameters") ||
            account.caption.includes("lib/utils.php") ||
            account.caption.includes("lib/RssBridge.php"))
        ) {
          console.log(`Cleaning: ${account.handle} - removing RSS-Bridge error`);
          account.caption = null;
          cleaned++;
        }
      }
    }

    console.log(`\n\u{1F4CA} Summary:`);
    console.log(`  Total posts: ${total}`);
    console.log(`  Cleaned: ${cleaned}`);

    if (cleaned === 0) {
      console.log("\nNo RSS-Bridge errors found, skipping commit.");
      process.exit(0);
    }

    // Commit
    console.log(`\n\u{1F4BE} Updating file and committing to GitHub...`);

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

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString(
      "base64"
    );
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
          message: `chore: cleanup RSS-Bridge error messages from captions

- Removed ${cleaned} posts with RSS-Bridge error HTML as caption
- Set caption=null for posts with ClientException errors
- Allows Playwright backfill to process these posts
- Method: Pattern matching for RSS-Bridge error indicators`,
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
