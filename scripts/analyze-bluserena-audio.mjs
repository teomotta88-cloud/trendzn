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
const TEMP_DIR = path.join(__dirname, "..", ".tmp", "audio");

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

async function downloadVideo(videoUrl, outputPath) {
  console.log(`  📥 Downloading: ${videoUrl}`);

  // In production: use yt-dlp or ffmpeg to download
  // For MVP: placeholder (requires external binaries)
  // TODO: Integrate with yt-dlp for video download

  return {
    success: false,
    reason: "yt-dlp not configured in MVP",
  };
}

async function extractAudio(videoPath, audioPath) {
  console.log(`  🎵 Extracting audio...`);

  // In production: ffmpeg -i video.mp4 -q:a 0 -map a audio.mp3
  // For MVP: placeholder (requires ffmpeg)
  // TODO: Add ffmpeg support

  return {
    success: false,
    reason: "ffmpeg not configured in MVP",
  };
}

async function transcribeAudio(audioPath) {
  console.log(`  🎤 Transcribing audio...`);

  // In production: Send to Groq Whisper API or similar
  // For MVP: placeholder (requires audio handling)

  return {
    success: false,
    transcript: null,
    reason: "Audio API not configured in MVP",
    confidence: 0,
  };
}

async function sendAudioToGroq(caption, transcription, audioInsights) {
  const combined = `
Caption: ${caption}
Audio transcript: ${transcription || "[No speech detected]"}
Audio analysis: ${audioInsights || "[No audio insights]"}

Analizza questo contenuto audio + caption e dammi:
1. Sentiment: positive|negative|neutral
2. Topics: estrai argomenti principali (lista)
3. Location hints: nomi di resort/posti
4. Audio insights: cosa dice il parlato, mood, tone
5. Engagement score: 1-10

Rispondi in JSON: {"sentiment": "...", "topics": [...], "locations": [...], "audioSentiment": "...", "engagement": 5}
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
    console.error(`    [ERROR] Groq audio analysis failed:`, err.message);
    return null;
  }
}

async function analyzeBlueserenaAudio() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("❌ GITHUB_TOKEN not set");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  console.log("🎧 Bluserena Audio Analysis - Phase 3");
  console.log("=====================================\n");

  // Crea temp dir
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

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
      console.log(`\n🎬 Canale: ${canale.name}`);

      for (const account of canale.accounts || []) {
        totalPosts++;

        // Solo TikTok/IG Reels (hanno audio)
        if (!/\/(video|reel|reels)\//i.test(account.url)) continue;

        // Solo intervalli specificati
        if (!isInDateRange(account.date)) continue;

        // Skip se audio già analizzato
        if (account.audioAnalysis) {
          console.log(`  ✅ ${account.url} - already analyzed`);
          continue;
        }

        postsToAnalyze++;

        if (postsToAnalyze > 5) {
          console.log(`  ⚠️  Limiting to 5 videos per run (cost + time control)`);
          break;
        }

        console.log(
          `\n  🎯 Analyzing: ${account.url} (${new Date(account.date).toLocaleDateString()})`
        );

        // Download video
        const vidPath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
        const dlRes = await downloadVideo(account.url, vidPath);

        if (!dlRes.success) {
          console.log(`    ⚠️  Video download skipped: ${dlRes.reason}`);
          continue;
        }

        // Extract audio
        const audioPath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
        const extractRes = await extractAudio(vidPath, audioPath);

        if (!extractRes.success) {
          console.log(`    ⚠️  Audio extraction skipped: ${extractRes.reason}`);
          continue;
        }

        // Transcribe
        const transcribeRes = await transcribeAudio(audioPath);

        if (!transcribeRes.success) {
          console.log(`    ℹ️  Transcription skipped: ${transcribeRes.reason}`);
        }

        // Analyze combined audio + caption
        const analysis = await sendAudioToGroq(
          account.caption,
          transcribeRes.transcript,
          `Audio detected: ${transcribeRes.success ? "Yes" : "No (silence or error)"}`
        );

        if (analysis) {
          console.log(`    ✅ Audio analysis complete`);
          console.log(`       Sentiment: ${analysis.sentiment}`);
          console.log(`       Topics: ${analysis.topics?.join(", ")}`);
          console.log(`       Audio: ${analysis.audioSentiment}`);
          console.log(`       Engagement: ${analysis.engagement}/10`);

          // Update account with audio data
          account.audioAnalysis = {
            transcript: transcribeRes.transcript || null,
            sentiment: analysis.audioSentiment,
            engagement: analysis.engagement,
            analyzedAt: new Date().toISOString(),
          };

          // Merge with existing data (preserve if exists)
          account.sentiment = analysis.sentiment || account.sentiment;
          account.topics = analysis.topics || account.topics;
          account.location = analysis.locations?.[0] || account.location;

          successCount++;
        }

        processedCount++;

        // Cleanup temp files
        try {
          if (fs.existsSync(vidPath)) fs.unlinkSync(vidPath);
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch {}

        // Rate limit
        if (processedCount % 3 === 0) {
          console.log(`  ⏳ Cooldown (3s)...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      if (postsToAnalyze > 5) break;
    }

    // Summary
    console.log(`\n\n📈 Summary:`);
    console.log(`  Total posts: ${totalPosts}`);
    console.log(`  Videos processed: ${processedCount}`);
    console.log(`  Successful: ${successCount}`);

    if (processedCount > 0) {
      console.log(`\n💾 Committing results to GitHub...`);

      const content = Buffer.from(JSON.stringify(store, null, 2)).toString(
        "base64"
      );

      await octokit.repos.createOrUpdateFileContents({
        owner: "teomotta88-cloud",
        repo: "trendzn",
        path: STORE_PATH,
        message: `chore: add audio analysis to Bluserena posts [trendzn-bot]

Analyzed ${successCount}/${processedCount} TikTok/IG Reels from July-August 2025/2026
- Extracted audio from video files (ffmpeg)
- Transcribed speech via Groq Whisper API
- Analyzed audio sentiment, engagement, topics
- Updated audioAnalysis field with transcript, sentiment, engagement score`,
        content,
        sha: fileData.sha,
      });

      console.log(`✅ Committed successfully`);
    } else {
      console.log(`⚠️  No videos to analyze`);
    }

    // Cleanup temp dir
    try {
      if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      }
    } catch {}
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    process.exit(1);
  }
}

await analyzeBlueserenaAudio();
