#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { Octokit } from "@octokit/rest";
import FormData from "form-data";
import { chatCompletionWithFallback } from "./lib/openrouter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const TEMP_DIR = path.join(__dirname, "..", ".tmp", "audio");

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

async function downloadVideo(videoUrl, outputPath) {
  console.log(`  📥 Downloading: ${videoUrl}`);

  try {
    const { execSync } = await import("child_process");
    // Try with user-agent and longer timeout for TikTok
    const cmd = `yt-dlp --no-warnings -f best -o "${outputPath}" --socket-timeout 30 "${videoUrl}" 2>&1`;
    execSync(cmd, {
      stdio: "pipe",
      timeout: 120000, // 2 minutes timeout
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true };
  } catch (err) {
    const errMsg = String(err).slice(0, 100);
    console.log(`    ⚠️  Video download failed: ${errMsg}`);
    return { success: false, reason: "yt-dlp failed or timeout" };
  }
}

async function extractAudio(videoPath, audioPath) {
  console.log(`  🎵 Extracting audio...`);

  try {
    const { execSync } = await import("child_process");
    execSync(`ffmpeg -i "${videoPath}" -q:a 0 -map a "${audioPath}" -y 2>&1 | grep -i "error" || true`, {
      stdio: "pipe",
      timeout: 30000,
    });
    if (fs.existsSync(audioPath)) {
      return { success: true };
    }
    return { success: false, reason: "ffmpeg output file not created" };
  } catch (err) {
    console.log(`    ⚠️  ffmpeg not available or extraction failed`);
    return { success: false, reason: "ffmpeg unavailable" };
  }
}

async function transcribeAudio(audioPath, groqApiKey) {
  console.log(`  🎤 Transcribing audio...`);

  if (!groqApiKey) {
    return {
      success: false,
      transcript: null,
      reason: "GROQ_API_KEY not set",
      confidence: 0,
    };
  }

  try {
    if (!fs.existsSync(audioPath)) {
      return {
        success: false,
        transcript: null,
        reason: "Audio file not found",
        confidence: 0,
      };
    }

    const stats = fs.statSync(audioPath);
    if (!stats || stats.size === 0) {
      return {
        success: false,
        transcript: null,
        reason: "Audio file is empty",
        confidence: 0,
      };
    }

    const formData = new FormData();
    const audioStream = fs.createReadStream(audioPath);
    formData.append("file", audioStream, { filename: "audio.mp3", contentType: "audio/mpeg" });
    formData.append("model", "whisper-large-v3");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      console.log(`    ⚠️  Groq Whisper failed (${response.status}): ${err.slice(0, 100)}`);
      return {
        success: false,
        transcript: null,
        reason: `Groq API error: ${response.status}`,
        confidence: 0,
      };
    }

    const result = await response.json();
    const transcript = result.text || "";

    if (!transcript || transcript.trim().length === 0) {
      return {
        success: false,
        transcript: null,
        reason: "No speech detected in audio",
        confidence: 0,
      };
    }

    return {
      success: true,
      transcript: transcript.trim(),
      reason: "OK",
      confidence: 0.9,
    };
  } catch (err) {
    console.log(`    ⚠️  Transcription error: ${String(err).slice(0, 100)}`);
    return {
      success: false,
      transcript: null,
      reason: `Error: ${err.message}`,
      confidence: 0,
    };
  }
}

async function sendAudioToGroq(caption, transcription, audioInsights, apiKey, groqApiKey) {
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

Rispondi SOLO con JSON valido, senza markdown:
{"sentiment": "positive|negative|neutral", "topics": [...], "locations": [...], "audioSentiment": "positive|negative|neutral", "engagement": 5}
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

        if (postsToAnalyze > 100) {
          console.log(`  ⚠️  Limiting to 100 videos per run (cost + time control)`);
          break;
        }

        console.log(
          `\n  🎯 Analyzing: ${account.url} (${new Date(account.date).toLocaleDateString()})`
        );

        let transcribeRes = { success: false, transcript: null };
        let audioNote = "Audio extraction unavailable (ffmpeg/yt-dlp)";

        // Try to download and extract audio (fallback to caption-only if fails)
        try {
          const vidPath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
          const dlRes = await downloadVideo(account.url, vidPath);

          if (dlRes.success) {
            const audioPath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
            const extractRes = await extractAudio(vidPath, audioPath);

            if (extractRes.success) {
              transcribeRes = await transcribeAudio(audioPath, groqApiKey);
              audioNote = transcribeRes.success
                ? `Transcript: "${transcribeRes.transcript?.slice(0, 50)}..."`
                : "Audio extracted but transcription failed";
            } else {
              audioNote = `Audio extraction failed: ${extractRes.reason}`;
            }

            // Cleanup temp files
            try {
              if (fs.existsSync(vidPath)) fs.unlinkSync(vidPath);
              if (extractRes.success && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            } catch {}
          } else {
            audioNote = `Video download unavailable (${dlRes.reason})`;
          }
        } catch (err) {
          audioNote = `Audio processing error: ${String(err).slice(0, 50)}`;
        }

        // Analyze caption + audio (fallback to caption-only if audio unavailable)
        console.log(`    ℹ️  ${audioNote}`);
        const analysis = await sendAudioToGroq(
          account.caption,
          transcribeRes.transcript,
          audioNote,
          apiKey,
          groqApiKey
        );

        if (analysis) {
          console.log(`    ✅ Analysis complete`);
          console.log(`       Sentiment: ${analysis.sentiment}`);
          console.log(`       Topics: ${analysis.topics?.join(", ")}`);
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

        // Rate limit
        if (processedCount % 3 === 0) {
          console.log(`  ⏳ Cooldown (3s)...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
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
        message: `chore: audio analysis update to Bluserena posts [trendzn-bot]

Analyzed ${successCount}/${processedCount} posts from July-August 2025/2026
- Attempted audio extraction (ffmpeg/yt-dlp)
- Fallback to caption-only analysis if audio unavailable
- Updated sentiment, engagement scores, audioAnalysis field`,
        content,
        sha: fileData.sha,
      });

      console.log(`✅ Committed successfully`);
    } else if (processedCount > 0) {
      console.log(`⚠️  ${processedCount} posts processed but analysis failed`);
    } else {
      console.log(`ℹ️  No posts matching criteria (July-Aug 2025/2026, video type, not analyzed)`);
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
