#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { Octokit } from "@octokit/rest";
import { chatCompletionWithFallback } from "./lib/openrouter.mjs";
import Tesseract from "tesseract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";

// API keys
const apiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

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

async function downloadVideoAndExtractOCR(videoUrl) {
  console.log(`  📥 Downloading video for OCR...`);

  const tempDir = path.join(__dirname, "..", ".tmp", "ocr");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const videoPath = path.join(tempDir, `${Date.now()}.mp4`);

  try {
    const { spawnSync } = await import("child_process");
    // Download video with yt-dlp (longer timeout for TikTok)
    const result = spawnSync("yt-dlp", [
      "--no-warnings",
      "-f", "best",
      "-o", videoPath,
      "--socket-timeout", "30",
      videoUrl
    ], {
      stdio: "pipe",
      timeout: 120000, // 2 minutes timeout
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== 0 && result.status !== null) {
      const errMsg = result.stderr?.toString().slice(0, 100) || "Unknown error";
      console.log(`    ⚠️  Video download failed: ${errMsg}`);
      return {
        textOnScreen: null,
        confidence: 0.0,
        frames: [],
        available: false,
      };
    }

    if (!fs.existsSync(videoPath)) {
      console.log(`    ⚠️  Video download produced no file`);
      return {
        textOnScreen: null,
        confidence: 0.0,
        frames: [],
        available: false,
      };
    }

    // Extract OCR from downloaded video
    const ocrResult = await extractOCRText(videoPath);

    // Cleanup video
    try {
      fs.unlinkSync(videoPath);
    } catch {}

    return ocrResult;
  } catch (err) {
    console.log(`    ⚠️  Video download failed: ${String(err).slice(0, 100)}`);
    // Cleanup
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    } catch {}
    return {
      textOnScreen: null,
      confidence: 0.0,
      frames: [],
      available: false,
    };
  }
}

async function extractFrameAndOCR(videoPath, frameOutputPath) {
  console.log(`    [OCR] Extracting frame from video...`);

  try {
    const { spawnSync } = await import("child_process");
    // Extract frame at 5 seconds or middle of video
    const result = spawnSync("ffmpeg", [
      "-i", videoPath,
      "-vframes", "1",
      frameOutputPath,
      "-y"
    ], {
      stdio: "pipe",
      timeout: 15000
    });

    return fs.existsSync(frameOutputPath);
  } catch (err) {
    console.log(`    ⚠️  Frame extraction failed: ${String(err).slice(0, 50)}`);
    return false;
  }
}

async function extractOCRText(videoPath) {
  console.log(`  [OCR] Attempting text extraction from video...`);

  try {
    const frameDir = path.join(path.dirname(videoPath), "frames");
    if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir, { recursive: true });

    const frameOutputPath = path.join(frameDir, `frame_${Date.now()}.png`);
    const frameExtracted = await extractFrameAndOCR(videoPath, frameOutputPath);

    if (!frameExtracted) {
      console.log(`    ⚠️  Could not extract frame from video`);
      return {
        textOnScreen: null,
        confidence: 0.0,
        frames: [],
        available: false,
      };
    }

    console.log(`    [OCR] Running Tesseract on extracted frame...`);
    const result = await Tesseract.recognize(frameOutputPath, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          process.stdout.write(`\r    [OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    if (process.stdout.isTTY) console.log(""); // newline after progress

    const text = result.data.text?.trim() || "";
    const confidence = result.data.confidence || 0;

    // Cleanup
    try {
      fs.unlinkSync(frameOutputPath);
    } catch {}

    if (!text || text.length < 3) {
      return {
        textOnScreen: null,
        confidence: 0.0,
        frames: [],
        available: false,
      };
    }

    return {
      textOnScreen: text,
      confidence: confidence / 100, // normalize to 0-1
      frames: [frameOutputPath],
      available: true,
    };
  } catch (err) {
    console.log(`\n    ⚠️  OCR extraction failed: ${String(err).slice(0, 80)}`);
    return {
      textOnScreen: null,
      confidence: 0.0,
      frames: [],
      available: false,
    };
  }
}

async function sendOCRToGroq(caption, ocrData, apiKey, groqApiKey) {
  let ocrContext = ocrData?.textOnScreen ? `On-screen text: ${ocrData.textOnScreen}` : "On-screen text: [not available]";

  const combined = `
Caption: ${caption}
${ocrContext}

Analizza questo contenuto e dammi:
1. Sentiment: positive|negative|neutral
2. Topics: estrai argomenti principali (lista)
3. Location hints: nomi di resort/posti
4. Key insights

Rispondi SOLO con JSON valido, senza markdown:
{"sentiment": "positive|negative|neutral", "topics": [...], "locations": [...], "onScreenInsights": "..."}
`;

  const parse = (text) => {
    try {
      const json = JSON.parse(text.trim());
      if (!json.sentiment) return null;
      return json;
    } catch {
      return null;
    }
  };

  try {
    const response = await chatCompletionWithFallback([
      {
        role: "user",
        content: combined,
      },
    ], {
      apiKey,
      groqApiKey,
      parse,
    });

    return response;
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

    if (!fileData.content) {
      console.error("❌ File content is empty from GitHub API");
      process.exit(1);
    }

    let raw;
    try {
      raw = Buffer.from(fileData.content, "base64").toString("utf-8");
    } catch (decodeErr) {
      console.error("❌ Failed to decode base64 content:", decodeErr.message);
      process.exit(1);
    }

    if (!raw || raw.trim().length === 0) {
      console.error("❌ Decoded content is empty");
      process.exit(1);
    }

    let store;
    try {
      store = JSON.parse(raw);
    } catch (parseErr) {
      console.error("❌ Failed to parse JSON:", parseErr.message);
      console.error("First 200 chars:", raw.substring(0, 200));
      process.exit(1);
    }

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

        if (postsToAnalyze > 100) {
          console.log(`  ⚠️  Limiting to 100 posts per run (cost control)`);
          break;
        }

        console.log(
          `\n  🔍 Analyzing: ${account.url} (${new Date(account.date).toLocaleDateString()})`
        );

        // Download video and extract OCR (with fallback)
        const ocrData = await downloadVideoAndExtractOCR(account.url);

        if (!ocrData.available) {
          console.log(`    ℹ️  OCR unavailable (ffmpeg/tesseract.js), using caption-only analysis`);
        }

        // Store OCR data if extracted
        if (ocrData.textOnScreen) {
          account.ocrData = ocrData;
        }

        // Send combined caption + OCR to Groq (or caption-only if OCR unavailable)
        const analysis = await sendOCRToGroq(account.caption, ocrData, apiKey, groqApiKey);

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

      if (postsToAnalyze > 100) break;
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
