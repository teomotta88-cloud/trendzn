#!/usr/bin/env node

// Trascrive l'AUDIO dei video Bluserena (TikTok / IG Reels) con Groq Whisper e
// scrive la trascrizione nello store, nel campo `audioAnalysis`. Fa solo
// questo: nessuna chiamata a LLM, nessun sentiment, nessun engagement score,
// nessuna location — quei campi sono di altri script e questo non li tocca.
//
// Pipeline per post: yt-dlp -> ffmpeg (mono 16 kHz, il formato che Whisper
// usa internamente: meno banda, nessuna perdita di qualità utile) -> Groq
// whisper-large-v3.
//
// Il bug che rendeva inutile l'intero workflow: la richiesta a Groq veniva
// costruita con il FormData del pacchetto npm `form-data` e passata come body
// a fetch (undici), che non sa serializzarlo e lo converte a stringa. Groq
// riceveva 17 byte — la lunghezza di "[object FormData]" — e rispondeva
// 400 "multipart: NextPart: EOF" su ogni singolo video. Qui si usano FormData
// e Blob nativi, senza impostare a mano il Content-Type: il boundary lo deve
// generare fetch.

import fs from "fs";
import os from "os";
import path from "path";

import { runEnrichment } from "./lib/bluserena-enrich.mjs";
import { transcribeAudioBuffer } from "./lib/groq-whisper.mjs";
import { assertBinaries, cleanup, downloadVideo, run } from "./lib/bluserena-media.mjs";

// Si alza quando cambia il modo in cui si produce la trascrizione: i record
// scritti da una versione precedente vengono rifatti da soli alla run dopo.
const VERSION = 1;

const MODEL = process.env.WHISPER_MODEL ?? "whisper-large-v3";
// Contenuti italiani: forzare la lingua riduce le allucinazioni di Whisper sui
// clip corti o con sola musica. WHISPER_LANGUAGE="" per lasciarlo autodetect.
const LANGUAGE = process.env.WHISPER_LANGUAGE ?? "it";
// Limite di upload dell'API Groq.
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

// Contatore invece di Date.now(): due post elaborati nello stesso
// millisecondo (succede quando il download fallisce subito) condividerebbero
// lo stesso nome di file temporaneo.
let seq = 0;

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bluserena-audio-"));

const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  console.error("❌ GROQ_API_KEY non impostata: senza non si può trascrivere nulla.");
  process.exit(1);
}

function extractAudio(videoPath, audioPath) {
  // `-vn` scarta il video, `-ac 1 -ar 16000` è l'input nativo di Whisper.
  // Niente pipe verso grep: l'exit code di ffmpeg deve restare leggibile.
  return run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "5",
      "-y",
      audioPath,
    ],
    { timeoutMs: 60_000 },
  );
}

async function transcribePost(account) {
  const stem = path.join(TEMP_DIR, `post-${seq++}`);
  const videoPath = `${stem}.mp4`;
  const audioPath = `${stem}.mp3`;

  try {
    const dl = downloadVideo(account.url, videoPath);
    if (!dl.ok) {
      console.log(`    ⚠️  download fallito: ${dl.reason}`);
      return {
        transcript: null,
        language: null,
        durationSec: null,
        model: MODEL,
        status: "download_failed",
        reason: dl.reason,
      };
    }

    const extracted = extractAudio(videoPath, audioPath);
    if (!extracted.ok || !fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      const reason = extracted.ok ? "ffmpeg non ha prodotto audio" : extracted.reason;
      console.log(`    ⚠️  estrazione audio fallita: ${reason}`);
      return {
        transcript: null,
        language: null,
        durationSec: null,
        model: MODEL,
        status: "extract_failed",
        reason,
      };
    }

    const size = fs.statSync(audioPath).size;
    if (size > MAX_UPLOAD_BYTES) {
      const reason = `audio troppo grande (${(size / 1024 / 1024).toFixed(1)} MB)`;
      console.log(`    ⚠️  ${reason}`);
      return {
        transcript: null,
        language: null,
        durationSec: null,
        model: MODEL,
        status: "too_large",
        reason,
      };
    }

    const out = await transcribeAudioBuffer(fs.readFileSync(audioPath), {
      apiKey: groqApiKey,
      model: MODEL,
      language: LANGUAGE,
    });
    if (!out.ok) {
      console.log(`    ⚠️  ${out.reason}`);
      return {
        transcript: null,
        language: null,
        durationSec: null,
        model: MODEL,
        status: "transcribe_failed",
        reason: out.reason,
      };
    }

    // Whisper su un video di sola musica restituisce spesso stringhe vuote o
    // sola punteggiatura: non è una trascrizione.
    if (!out.text || !/[\p{L}\p{N}]/u.test(out.text)) {
      console.log(`    · nessun parlato rilevato`);
      return {
        transcript: null,
        language: out.language,
        durationSec: out.durationSec,
        model: MODEL,
        status: "no_speech",
      };
    }

    console.log(`    ✓ ${out.text.length} caratteri, lingua ${out.language ?? "n/d"}`);
    return {
      transcript: out.text,
      language: out.language,
      durationSec: out.durationSec,
      model: MODEL,
      status: "ok",
    };
  } finally {
    cleanup(videoPath, audioPath);
  }
}

console.log("🎤 Bluserena — trascrizione audio (Groq Whisper)\n");
assertBinaries(["yt-dlp", "ffmpeg"]);
console.log("");

try {
  await runEnrichment({
    field: "audioAnalysis",
    version: VERSION,
    title: "Trascrizione audio",
    commitMessage: (n) => `chore: trascrizione audio su ${n} post Bluserena [trendzn-bot]`,
    processPost: transcribePost,
  });
} finally {
  cleanup(TEMP_DIR);
}
