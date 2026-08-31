#!/usr/bin/env node

// Bulk verification script per Bluserena-monitoring
// Marchia automaticamente tutti i post come "confirmed" o "unconfirmed"
// basato sulla presence di "bluserena" o nomi di resort nella caption
//
// Env variables:
//   GITHUB_TOKEN: required for GitHub API
//   DRY_RUN: (optional) - se true, non scrive su GitHub

import { Octokit } from "@octokit/rest";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const DRY_RUN = process.env.DRY_RUN === "true";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("❌ GITHUB_TOKEN non configurato");
  process.exit(1);
}

const octokit = new Octokit({ auth: token });

// Lista resort da matchare nelle caption
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

function verifyPost(caption) {
  if (!caption) return "unconfirmed";

  const lower = caption.toLowerCase();

  // Verifica "bluserena"
  if (lower.includes("bluserena") || lower.includes("#bluserena")) {
    return "confirmed";
  }

  // Verifica resort
  for (const resort of RESORTS) {
    if (
      lower.includes(resort.toLowerCase()) ||
      lower.includes(`#${resort.toLowerCase()}`)
    ) {
      return "confirmed";
    }
  }

  return "unconfirmed";
}

async function bulkVerify() {
  console.log("🔍 Bluserena Bulk Verification");
  console.log("==============================\n");

  if (DRY_RUN) {
    console.log("⚠️  DRY_RUN mode - no changes will be written\n");
  }

  try {
    // Leggi file da raw GitHub URL
    console.log("1️⃣  Reading bluserena-monitoring.json...");

    const rawUrl = `https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/${STORE_PATH}?t=${Date.now()}`;
    const rawRes = await fetch(rawUrl, {
      headers: { "User-Agent": "bulk-verify-bluserena" },
    });

    if (!rawRes.ok) {
      console.error(`❌ Failed to fetch from raw GitHub: ${rawRes.status}`);
      process.exit(1);
    }

    let raw;
    try {
      raw = await rawRes.text();
    } catch (fetchErr) {
      console.error("❌ Failed to read response:", fetchErr.message);
      process.exit(1);
    }

    if (!raw || raw.trim().length === 0) {
      console.error("❌ File content is empty");
      process.exit(1);
    }

    let store;
    try {
      store = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Failed to parse JSON:", err.message);
      process.exit(1);
    }

    // Ottieni SHA del file per l'aggiornamento
    const { data: fileData } = await octokit.repos.getContent({
      owner: "teomotta88-cloud",
      repo: "trendzn",
      path: STORE_PATH,
    });

    let totalPosts = 0;
    let confirmedCount = 0;
    let unconfirmedCount = 0;
    let changedCount = 0;

    // Elabora tutti i canali e post
    for (const canale of store.canali || []) {
      console.log(`\n📺 Canale: ${canale.name}`);

      for (const account of canale.accounts || []) {
        // Solo post (non profili)
        if (!/\/(p|reel|reels|video|photo|watch|tv|status)\//i.test(account.url)) {
          continue;
        }

        totalPosts++;

        // Determina status
        const newStatus = verifyPost(account.caption);
        const oldStatus = account.verificationStatus || null;

        if (newStatus === "confirmed") {
          confirmedCount++;
        } else {
          unconfirmedCount++;
        }

        // Verifica se c'è stato un cambio
        if (oldStatus !== newStatus) {
          changedCount++;
          const change = oldStatus ? `${oldStatus} → ${newStatus}` : `null → ${newStatus}`;
          console.log(`  ✏️  ${account.handle || "unknown"}: ${change}`);

          // Aggiorna il post
          account.verificationStatus = newStatus;
        }
      }
    }

    // Summary
    console.log(`\n\n📈 Summary:`);
    console.log(`  Total posts: ${totalPosts}`);
    console.log(`  Confirmed: ${confirmedCount}`);
    console.log(`  Unconfirmed: ${unconfirmedCount}`);
    console.log(`  Changed: ${changedCount}`);

    if (changedCount > 0 && !DRY_RUN) {
      console.log(`\n💾 Writing changes to GitHub...`);

      const content = Buffer.from(JSON.stringify(store, null, 2)).toString(
        "base64"
      );

      await octokit.repos.createOrUpdateFileContents({
        owner: "teomotta88-cloud",
        repo: "trendzn",
        path: STORE_PATH,
        message: `chore: bulk verification of Bluserena posts [trendzn-bot]

Automatically marked ${changedCount} posts as confirmed/unconfirmed
based on caption content (bluserena mention or resort names)

Confirmed: ${confirmedCount}
Unconfirmed: ${unconfirmedCount}`,
        content,
        sha: fileData.sha,
      });

      console.log(`✅ Committed successfully`);
    } else if (changedCount > 0 && DRY_RUN) {
      console.log(`\n⚠️  DRY_RUN: Would have updated ${changedCount} posts`);
    } else if (changedCount === 0) {
      console.log(`\n✅ All posts already verified - no changes needed`);
    }
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    process.exit(1);
  }
}

await bulkVerify();
