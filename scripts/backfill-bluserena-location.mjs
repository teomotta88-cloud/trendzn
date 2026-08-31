const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const ghHeaders = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

// Lista resort da matchare (stesso di bulk-verify)
const RESORTS = [
  "Bluserena",
  "Cala Serena",
  "Serena Majestic",
  "Serena Majestic Hotel",
  "SerenaResort",
  "Serena Resort",
  "Torreserena",
  "Torre Serena",
  "Serenusa",
  "Serenahotel",
  "Serena Hotel",
  "Calanè",
  "Calanè Resort",
  "Calànè Resort",
  "GranSerena",
  "Gran Serena",
  "Sibari Green",
  "Sibari Green Resort",
  "Valentino",
  "Valentino Resort",
  "Kalidia",
  "Kalidia Hotel",
  "Alborèa",
  "Alborèa Ecolodge",
  "Ethra",
  "Ethra Reserve",
  "Is Serenas",
  "Is Serenas Badesi",
  "IsSerenas",
];

function isInJulyAugust(date) {
  if (!date) return false;
  const d = new Date(date);
  const month = d.getMonth() + 1;
  return month === 7 || month === 8;
}

function extractLocation(caption) {
  if (!caption) return null;

  const lower = caption.toLowerCase();

  // Testa "bluserena" con match sia testo che hashtag
  if (lower.includes("bluserena")) {
    return "Bluserena";
  }

  // Testa ogni resort
  for (const resort of RESORTS) {
    const resortLower = resort.toLowerCase();
    if (lower.includes(resortLower)) {
      return resort;
    }
  }

  return null;
}

async function main() {
  try {
    console.log("\u{1F4E5} Reading bluserena-monitoring.json...");

    const fs = await import("fs").then(m => m.promises);
    const fileContent = await fs.readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(fileContent);

    let updated = 0;
    let skipped = 0;

    const postsToUpdate = [];
    for (const canale of data.canali) {
      for (const account of canale.accounts || []) {
        // Solo luglio-agosto 25-26
        if (!isInJulyAugust(account.date)) continue;

        // Solo se location è null
        if (account.location !== null && account.location !== undefined) {
          skipped++;
          continue;
        }

        // Solo se ha caption per il match
        if (!account.caption) {
          skipped++;
          continue;
        }

        postsToUpdate.push(account);
      }
    }

    console.log(`\u{1F50D} Found ${postsToUpdate.length} posts to backfill`);
    console.log(`\u{23ED} Skipped ${skipped} posts (already have location or no caption)`);

    for (let i = 0; i < postsToUpdate.length; i++) {
      const account = postsToUpdate[i];
      const location = extractLocation(account.caption);

      if (location) {
        account.location = location;
        updated++;
        console.log(`[${i + 1}/${postsToUpdate.length}] \u{2705} ${account.handle || "unknown"}: ${location}`);
      } else {
        console.log(`[${i + 1}/${postsToUpdate.length}] \u{26A0} ${account.handle || "unknown"}: no match`);
      }
    }

    console.log(`\n\u{1F4CA} Summary:`);
    console.log(`  Updated: ${updated}`);
    console.log(`  No match: ${postsToUpdate.length - updated}`);
    console.log(`  Skipped: ${skipped}`);

    // Commit
    console.log(`\n\u{1F4BE} Updating file and committing to GitHub...`);

    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`,
      { headers: ghHeaders }
    );
    const fileData = await res.json();

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: backfill location for Jul-Aug 2025-2026 posts

- Backfilled ${updated} posts with location via simple string matching
- Matched: Bluserena and ${RESORTS.length} resort names
- Filtered: Only Jul-Aug 2025 and 2026 posts with null location and caption
- Method: Case-insensitive caption matching (no AI)`,
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
