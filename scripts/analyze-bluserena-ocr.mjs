#!/usr/bin/env node

// Estrae il TESTO ON-SCREEN dai video Bluserena (TikTok / IG Reels) e lo
// scrive nello store, nel campo `ocrData`. Fa solo questo: nessuna chiamata a
// LLM, nessun sentiment, nessun topic, nessuna location — quei campi sono di
// altri script e questo non li tocca mai.
//
// Pipeline per post: yt-dlp -> ffprobe (durata) -> ffmpeg (N frame campionati
// lungo il video) -> Tesseract (ita+eng) -> testo ripulito e deduplicato.
//
// Nota sul vecchio comportamento: il workflow non installava né yt-dlp né
// ffmpeg, e lo script mascherava l'ENOENT come "video non disponibile",
// ricadendo su un'analisi LLM della sola caption. Risultato: 0 post con OCR su
// 1478, ma workflow verde. Ora i binari sono un prerequisito verificato
// all'avvio (assertBinaries) e l'unico output è il testo davvero letto a video.

import fs from "fs";
import os from "os";
import path from "path";
import Tesseract from "tesseract.js";

import { runEnrichment } from "./lib/bluserena-enrich.mjs";
import { cleanText, frameTimestamps } from "./lib/ocr-text.mjs";
import {
  assertBinaries,
  cleanup,
  downloadVideo,
  probeDurationSec,
  run,
} from "./lib/bluserena-media.mjs";

// Si alza quando cambia il modo in cui si estrae il testo: i record scritti da
// una versione precedente vengono rifatti da soli alla run dopo. Da alzare
// quando arriverà il filtro sulla confidenza per parola.
const VERSION = 1;

// Quanti fotogrammi campionare per video.
const FRAMES_PER_VIDEO = Number.parseInt(process.env.OCR_FRAMES ?? "5", 10);
const OCR_LANGS = process.env.OCR_LANGS ?? "ita+eng";

// Contatore invece di Date.now(): due post elaborati nello stesso
// millisecondo (succede quando il download fallisce subito) condividerebbero
// lo stesso nome di file temporaneo.
let seq = 0;

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bluserena-ocr-"));

// Tesseract su un video verticale a piena risoluzione è lento e rumoroso:
// si scala a 720px di larghezza e si alza il contrasto, che è la condizione in
// cui i sottotitoli/caption sovraimpressi si leggono meglio.
const FRAME_FILTER = "scale=720:-2,eq=contrast=1.3";

function extractFrame(videoPath, seconds, outPath) {
  // `-ss` prima di `-i` = seek veloce; `-update 1` perché l'output è un
  // singolo PNG e non una sequenza numerata.
  return run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-update",
      "1",
      "-vf",
      FRAME_FILTER,
      "-y",
      outPath,
    ],
    { timeoutMs: 30_000 },
  );
}

// Un solo worker Tesseract per tutta la run: crearne uno per frame (come
// faceva Tesseract.recognize) significa ricaricare i dati di lingua ogni volta.
//
// Il worker si crea nel preflight, non alla prima chiamata, perché è lì che
// tesseract.js scarica i dati di lingua: se il download fallisce vogliamo
// saperlo prima di aver elaborato dei post, non a metà run con un batch in
// sospeso. E serve la corsa contro "uncaughtException" qui sotto perché la
// promise di createWorker NON rigetta su errore di rete — l'errore arriva
// come eccezione non catturata che ucciderebbe il processo.
let worker = null;

async function initWorker() {
  return new Promise((resolve, reject) => {
    const onFatal = (err) => reject(err);
    // Finestra brevissima e solo in avvio: qui non gira nient'altro.
    process.once("uncaughtException", onFatal);
    Tesseract.createWorker(OCR_LANGS.split("+"))
      .then((w) => {
        process.off("uncaughtException", onFatal);
        resolve(w);
      })
      .catch(onFatal);
  });
}

async function ocrPost(account) {
  const stem = path.join(TEMP_DIR, `post-${seq++}`);
  const videoPath = `${stem}.mp4`;

  try {
    const dl = downloadVideo(account.url, videoPath);
    if (!dl.ok) {
      console.log(`    ⚠️  download fallito: ${dl.reason}`);
      return {
        textOnScreen: null,
        confidence: null,
        frameCount: 0,
        status: "download_failed",
        reason: dl.reason,
      };
    }

    const duration = probeDurationSec(videoPath);
    const timestamps = frameTimestamps(duration, FRAMES_PER_VIDEO);

    const lines = [];
    const confidences = [];
    let framesRead = 0;

    for (const [i, seconds] of timestamps.entries()) {
      const framePath = `${stem}-f${i}.png`;
      const extracted = extractFrame(videoPath, seconds, framePath);
      if (!extracted.ok || !fs.existsSync(framePath)) {
        cleanup(framePath);
        continue;
      }

      framesRead++;
      const { data } = await worker.recognize(framePath);
      cleanup(framePath);

      const text = data.text?.trim();
      if (text) {
        lines.push(...text.split("\n"));
        if (typeof data.confidence === "number") confidences.push(data.confidence);
      }
    }

    if (!framesRead) {
      console.log(`    ⚠️  nessun frame estraibile`);
      return { textOnScreen: null, confidence: null, frameCount: 0, status: "frame_failed" };
    }

    const textOnScreen = cleanText(lines);
    if (!textOnScreen) {
      console.log(`    · nessun testo a video (${framesRead} frame)`);
      return { textOnScreen: null, confidence: null, frameCount: framesRead, status: "no_text" };
    }

    const confidence = confidences.length
      ? +(confidences.reduce((a, b) => a + b, 0) / confidences.length / 100).toFixed(3)
      : null;

    console.log(
      `    ✓ ${textOnScreen.split("\n").length} righe, confidenza ${confidence ?? "n/d"} (${framesRead} frame)`,
    );
    return { textOnScreen, confidence, frameCount: framesRead, status: "ok" };
  } finally {
    cleanup(videoPath);
  }
}

console.log("🔤 Bluserena — estrazione testo on-screen (OCR)\n");
assertBinaries(["yt-dlp", "ffmpeg", "ffprobe"]);

try {
  worker = await initWorker();
  console.log(`  ✓ Tesseract pronto (${OCR_LANGS})`);
} catch (err) {
  console.error(`❌ Tesseract non inizializzabile: ${String(err?.message ?? err).slice(0, 200)}`);
  console.error("   Di solito è il download dei dati di lingua da jsdelivr.");
  process.exit(1);
}
console.log("");

try {
  await runEnrichment({
    field: "ocrData",
    version: VERSION,
    title: "OCR testo on-screen",
    commitMessage: (n) => `chore: OCR testo on-screen su ${n} post Bluserena [trendzn-bot]`,
    processPost: ocrPost,
  });
} finally {
  if (worker) {
    try {
      await worker.terminate();
    } catch {}
  }
  cleanup(TEMP_DIR);
}
