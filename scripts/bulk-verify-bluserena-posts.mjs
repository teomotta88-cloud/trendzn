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

// Un post è confirmed se:
// 1. La caption nomina Bluserena o uno dei resort con DENOMINAZIONE COMPLETA
// 2. La trascrizione audio contiene "bluserena" O "blu" + "serena" (staccati)
// 3. Il testo OCR nomina Bluserena o uno dei resort con DENOMINAZIONE COMPLETA
//
// La lista precedente matchava sottostringhe generiche ("Valentino",
// "Ethra", "Serena Hotel", "Calanè"): bastava un hotel omonimo in Uganda o
// nelle Filippine per marcare confirmed un post che con Bluserena non
// c'entra nulla. Qui i termini sono interi e non ambigui.
//
// Il confronto ignora maiuscole/minuscole: su TikTok gli hashtag si
// scrivono quasi sempre tutti minuscoli (#sibarigreenresort), e con il
// match esatto se ne perdevano parecchi — #KalidriaHotel, per dire, nel
// dataset non compare mai con quelle maiuscole. Restano invece esclusi gli
// scostamenti di grafia: "Blu Serena" staccato (caption/OCR) non è "bluserena",
// MA in audio è accettato perché la trascrizione può separare le parole.
const TERMINI = [
  "bluserena", // copre anche #bluserena, essendo sottostringa
  "Is Serenas Badesi Resort",
  "#IsSerenasBadesiResort",
  "Calaserena Resort",
  "#CalaserenaResort",
  "Serenusa Resort",
  "#SerenusaResort",
  "Serena Majestic Hotel Residence",
  "#SerenaMajesticHotelResidence",
  "Sibari Green Resort",
  "#SibariGreenResort",
  "Serenè Resort",
  "#SerenèResort",
  "Granserena Hotel",
  "#GranserenaHotel",
  "Torreserena Resort",
  "#TorreserenaResort",
  "Calanè Resort",
  "#CalanèResort",
  "Valentino Resort",
  "#ValentinoResort",
  "Kalidria Hotel & Thalasso SPA",
  "#KalidriaHotel",
  "Alborèa Ecolodge Resort",
  "#AlborèaEcolodgeResort",
  "Ethra Reserve",
  "#EthraReserve",
];

function matchesTermini(text, lower) {
  if (!text) return false;
  const lowerText = lower || text.toLowerCase();
  return TERMINI.some((t) => lowerText.includes(t.toLowerCase()));
}

function verifyCaption(caption) {
  return matchesTermini(caption);
}

function verifyOCR(ocrData) {
  // OCR usa le stesse regole della caption: termini esatti, non staccati
  if (!ocrData?.text || ocrData.status !== "ok") return false;
  return matchesTermini(ocrData.text);
}

function verifyAudio(audioAnalysis) {
  // Audio ha regole più ampie:
  // - "bluserena" insieme (come caption/OCR)
  // - "blu" + "serena" staccati (unica differenza rispetto caption/OCR)
  if (!audioAnalysis?.transcript || audioAnalysis.status !== "ok") return false;

  const lower = audioAnalysis.transcript.toLowerCase();

  // Primo: prova i termini standard
  if (matchesTermini(audioAnalysis.transcript)) return true;

  // Secondo: per Bluserena specificamente, accetta anche "blu" + "serena" staccati
  // (perché la trascrizione audio può separarli nelle parole pronunciate)
  const hasBlu = /\bblu\b/i.test(audioAnalysis.transcript);
  const hasSerena = /\bserena\b/i.test(audioAnalysis.transcript);
  if (hasBlu && hasSerena) return true;

  return false;
}

function verifyPost(account) {
  // Verifica nell'ordine: caption, audio, OCR
  if (verifyCaption(account.caption)) return "confirmed";
  if (verifyAudio(account.audioAnalysis)) return "confirmed";
  if (verifyOCR(account.ocrData)) return "confirmed";

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
        const newStatus = verifyPost(account);
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
based on caption, audio transcript, and OCR text (bluserena mention or resort names).
Audio accepts "blu + serena" staccati.

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
