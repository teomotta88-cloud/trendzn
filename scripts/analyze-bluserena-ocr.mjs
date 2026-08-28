#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { Octokit } from "@octokit/rest";
import { chatCompletionWithFallback } from "./lib/openrouter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";

// Intervallo date per analisi (luglio-agosto 2025 e 2026)
const DATE_RANGES = [
  { start: new Date("2025-07-01"), end: new Date("2025-08-31") },
  { start: new Date("2026-07-01"), end: new Date("2026-08-31") },
];

function isInDateRange(dateStr) {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    return DATE_RANGES.some((range) => date >= range.start && date <= range.end);
  } catch {
    return false;
  }
}

async function extractOCRText(videoUrl) {
  console.log(`  [OCR] Attempting text extraction from video...`);

  try {
    // In production: download video → extract frame with ffmpeg → run Tesseract.js
    // For MVP: Placeholder (requires ffmpeg + tesseract.js)
    // TODO: Integrate with ffmpeg + tesseract.js for real OCR

    // Return empty/unavailable status (fallback to caption analysis)
    return {
      textOnScreen: null,
      confidence: 0.0,
      frames: [],
      available: false,
    };
  } catch (err) {
    console.log(`    ⚠️  OCR extraction unavailable: ${String(err).slice(0, 50)}`);
    return {
      textOnScreen: null,
      confidence: 0.0,
      frames: [],
      available: false,
    };
  }
}

async function sendOCRToGroq(caption, ocrData) {
  const combined = `
Caption: ${caption}
On-screen text: ${ocrData.textOnScreen}

Analizza questo contenuto e dammi:
1. Sentiment: positive|negative|neutral
2. Topics: estrai argomenti principali (lista)
3. Location hints: nomi di resort/posti
4. Key insights da testo on-screen

Rispondi in JSON: {"sentiment": "...", "topics": [...], "locations": [...], "onScreenInsights": "..."}
`;

  try {
    const response = await chatCompletionWithFallback([
      {
        role: "user",
        content: combined,
      },
    ]);

    return JSON.parse(response);
  } catch (err) {
    console.error(`    [ERROR] Groq analysis failed:`, err.message);
    return null;
  }
}

async function analyzeBlueserenaOCR() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("❌ GITHUB_TOKEN not set");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  console.log("📊 Bluserena OCR Analysis - Phase 2");
  console.log("==================================\n");

  try {
    // Leggi store
    console.log("1️⃣  Reading bluserena-monitoring.json...");
    const { data: fileData } = await octokit.repos.getContent({
      owner: "teomotta88-cloud",
      repo: "trendzn",
      path: STORE_PATH,
    });

    const raw = Buffer.from(fileData.content, "base64").toString("utf-8");
    const store = JSON.parse(raw);

    // Filtra post da analizzare
    let totalPosts = 0;
    let postsToAnalyze = 0;
    let processedCount = 0;
    let successCount = 0;

    for (const canale of store.canali || []) {
      console.log(`\n📺 Canale: ${canale.name}`);

      for (const account of canale.accounts || []) {
        totalPosts++;

        // Solo video TikTok/IG Reels
        if (!/\/(video|reel|reels)\//i.test(account.url)) continue;

        // Solo intervalli specificati
        if (!isInDateRange(account.date)) continue;

        // Skip se OCR già eseguito
        if (account.ocrData) {
          console.log(`  ✅ ${account.url} - already analyzed`);
          continue;
        }

        postsToAnalyze++;

        if (postsToAnalyze > 10) {
          console.log(`  ⚠️  Limiting to 10 posts per run (cost control)`);
          break;
        }

        console.log(
          `\n  🔍 Analyzing: ${account.url} (${new Date(account.date).toLocaleDateString()})`
        );

        // Extract OCR (with fallback)
        const ocrData = await extractOCRText(account.url);

        if (!ocrData.available) {
          console.log(`    ℹ️  OCR unavailable (ffmpeg/tesseract.js), using caption-only analysis`);
        }

        // Store OCR data if extracted
        if (ocrData.textOnScreen) {
          account.ocrData = ocrData;
        }

        // Send combined caption + OCR to Groq (or caption-only if OCR unavailable)
        const analysis = await sendOCRToGroq(account.caption, ocrData);

        if (analysis) {
          console.log(`    ✅ Analysis complete`);
          console.log(`       Sentiment: ${analysis.sentiment}`);
          console.log(`       Topics: ${analysis.topics?.join(", ")}`);
          console.log(`       Locations: ${analysis.locations?.join(", ")}`);

          // Merge with existing data (preserve if exists)
          account.sentiment = analysis.sentiment || account.sentiment;
          account.topics = analysis.topics || account.topics;
          account.location = analysis.locations?.[0] || account.location;

          if (analysis.onScreenInsights) {
            account.ocrInsights = analysis.onScreenInsights;
          }

          successCount++;
        }

        processedCount++;

        // Rate limit
        if (processedCount % 5 === 0) {
          console.log(`  ⏳ Cooldown (2s)...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (postsToAnalyze > 10) break;
    }

    // Summary
    console.log(`\n\n📈 Summary:`);
    console.log(`  Total posts: ${totalPosts}`);
    console.log(`  Posts analyzed: ${processedCount}`);
    console.log(`  Successful: ${successCount}`);

    if (successCount > 0) {
      console.log(`\n💾 Committing results to GitHub...`);

      const content = Buffer.from(JSON.stringify(store, null, 2)).toString(
        "base64"
      );

      await octokit.repos.createOrUpdateFileContents({
        owner: "teomotta88-cloud",
        repo: "trendzn",
        path: STORE_PATH,
        message: `chore: OCR + text analysis update to Bluserena posts [trendzn-bot]

Analyzed ${successCount}/${processedCount} posts from July-August 2025/2026
- Attempted OCR extraction (ffmpeg/tesseract.js)
- Fallback to caption-only analysis if OCR unavailable
- Updated sentiment, topics, location, ocrInsights fields`,
        content,
        sha: fileData.sha,
      });

      console.log(`✅ Committed successfully`);
    } else if (processedCount > 0) {
      console.log(`⚠️  ${processedCount} posts processed but analysis failed`);
    } else {
      console.log(`ℹ️  No posts matching criteria (July-Aug 2025/2026, video type, not analyzed)`);
    }
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    process.exit(1);
  }
}

await analyzeBlueserenaOCR();
