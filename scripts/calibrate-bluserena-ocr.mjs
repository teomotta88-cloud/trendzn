#!/usr/bin/env node

// Calibrazione della soglia di confidenza per l'OCR. NON scrive nello store:
// scarica qualche video, fa l'OCR e stampa i numeri che servono a scegliere la
// soglia guardando i dati invece che a naso.
//
// Perché serve: la prima versione dell'estrattore usava solo `data.text`, cioè
// il testo già appiattito, dove una parola letta con confidenza 12 e una letta
// con confidenza 88 sono indistinguibili. Risultato, sui 5 post della run #18:
// solo 2 avevano contenuto reale ("Ciao Bluserena", "@bluserena") e il resto
// erano righe come "£5 4" e "Wy UR ARI" salvate come se fossero testo.
//
//   node scripts/calibrate-bluserena-ocr.mjs
//   SAMPLE=8 node scripts/calibrate-bluserena-ocr.mjs
//   POST_URLS="https://...,https://..." node scripts/calibrate-bluserena-ocr.mjs

import fs from "fs";
import os from "os";
import path from "path";
import Tesseract from "tesseract.js";

import { readStore, eachAccount } from "./lib/bluserena-store.mjs";
import {
  assertBinaries,
  cleanup,
  downloadVideo,
  probeDurationSec,
  run,
} from "./lib/bluserena-media.mjs";
import {
  cleanText,
  frameTimestamps,
  letterCount,
  linesFromBlocks,
  wordsFromBlocks,
} from "./lib/ocr-text.mjs";

const SAMPLE = Number.parseInt(process.env.SAMPLE ?? "5", 10);
const FRAMES = Number.parseInt(process.env.OCR_FRAMES ?? "5", 10);
const OCR_LANGS = process.env.OCR_LANGS ?? "ita+eng";
const SOGLIE = [0, 40, 50, 60, 70, 80];

const VIDEO_URL = /\/(video|reel|reels)\//i;
const DATE_RANGES = [
  { start: new Date("2025-07-01T00:00:00Z"), end: new Date("2025-08-31T23:59:59Z") },
  { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-08-31T23:59:59Z") },
];
const inRange = (d) => {
  const date = new Date(d);
  return !Number.isNaN(date.getTime()) && DATE_RANGES.some((r) => date >= r.start && date <= r.end);
};

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-calib-"));
const FRAME_FILTER = "scale=720:-2,eq=contrast=1.3";

function extractFrame(videoPath, seconds, outPath) {
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

function istogramma(parole) {
  const bucket = new Array(10).fill(0);
  for (const w of parole) bucket[Math.min(9, Math.floor(w.confidence / 10))]++;
  const max = Math.max(1, ...bucket);
  console.log("\nDistribuzione della confidenza per parola");
  bucket.forEach((n, i) => {
    const barra = "█".repeat(Math.round((n / max) * 42));
    console.log(
      `  ${String(i * 10).padStart(3)}-${String(i * 10 + 9).padEnd(3)} ${String(n).padStart(5)}  ${barra}`,
    );
  });
}

async function main() {
  console.log("🔎 Calibrazione soglia OCR — non scrive niente nello store\n");
  assertBinaries(["yt-dlp", "ffmpeg", "ffprobe"]);

  let worker;
  try {
    worker = await new Promise((resolve, reject) => {
      const onFatal = (err) => reject(err);
      process.once("uncaughtException", onFatal);
      Tesseract.createWorker(OCR_LANGS.split("+"))
        .then((w) => {
          process.off("uncaughtException", onFatal);
          resolve(w);
        })
        .catch(onFatal);
    });
    console.log(`  ✓ Tesseract pronto (${OCR_LANGS})\n`);
  } catch (err) {
    console.error(`❌ Tesseract non inizializzabile: ${String(err?.message ?? err).slice(0, 200)}`);
    process.exit(1);
  }

  const { store } = await readStore();
  const tutti = [];
  for (const { account } of eachAccount(store)) {
    if (account.url && VIDEO_URL.test(account.url) && inRange(account.date)) tutti.push(account);
  }

  const richiesti = (process.env.POST_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const campione = richiesti.length
    ? richiesti.map((u) => tutti.find((a) => a.url === u)).filter(Boolean)
    : tutti.slice(0, SAMPLE);

  console.log(`Post eleggibili: ${tutti.length} — campione: ${campione.length}\n`);

  const globali = [];
  const perPost = [];

  for (const [i, account] of campione.entries()) {
    console.log(`[${i + 1}/${campione.length}] ${account.url}`);
    const stem = path.join(TEMP_DIR, `p${i}`);
    const videoPath = `${stem}.mp4`;

    const dl = downloadVideo(account.url, videoPath);
    if (!dl.ok) {
      console.log(`    ⚠️  download fallito: ${dl.reason}\n`);
      continue;
    }

    const timestamps = frameTimestamps(probeDurationSec(videoPath), FRAMES);
    const parole = [];
    const blocchi = [];

    for (const [j, sec] of timestamps.entries()) {
      const framePath = `${stem}-f${j}.png`;
      if (!extractFrame(videoPath, sec, framePath).ok || !fs.existsSync(framePath)) {
        cleanup(framePath);
        continue;
      }
      const { data } = await worker.recognize(framePath);
      cleanup(framePath);

      if (!data.blocks?.length) {
        console.log("    ⚠️  nessun dato per parola da Tesseract (blocks vuoto)");
        continue;
      }
      blocchi.push(...data.blocks);
      parole.push(...wordsFromBlocks(data.blocks));
    }
    cleanup(videoPath);

    console.log(
      `    ${parole.length} parole lette, ${parole.filter((w) => w.inDictionary).length} nel dizionario`,
    );
    globali.push(...parole);
    perPost.push({ url: account.url, blocchi, parole });
    console.log("");
  }

  await worker.terminate();
  cleanup(TEMP_DIR);

  if (!globali.length) {
    console.error("❌ Nessuna parola letta: niente da calibrare.");
    process.exit(1);
  }

  istogramma(globali);

  console.log("\nQuante parole sopravvivono a ogni soglia");
  for (const soglia of SOGLIE) {
    const vive = globali.filter((w) => w.confidence >= soglia);
    const dizio = vive.filter((w) => w.inDictionary).length;
    const pct = ((vive.length / globali.length) * 100).toFixed(0);
    console.log(
      `  >= ${String(soglia).padStart(2)}: ${String(vive.length).padStart(5)} parole (${pct.padStart(3)}%), di cui ${dizio} nel dizionario`,
    );
  }

  console.log("\n" + "=".repeat(78));
  console.log("TESTO RICOSTRUITO A OGNI SOGLIA — è qui che si sceglie");
  console.log("=".repeat(78));
  for (const { url, blocchi } of perPost) {
    console.log(`\n### ${url}`);
    for (const soglia of SOGLIE) {
      const testo = cleanText(linesFromBlocks(blocchi, { minConfidence: soglia }));
      const righe = testo ? testo.split("\n") : [];
      console.log(
        `  soglia ${String(soglia).padStart(2)} -> ${righe.length} righe: ${JSON.stringify(righe.slice(0, 6))}`,
      );
    }
    const soloDiz = cleanText(linesFromBlocks(blocchi, { requireDictionary: true }));
    console.log(
      `  solo in_dictionary -> ${JSON.stringify((soloDiz ? soloDiz.split("\n") : []).slice(0, 6))}`,
    );

    // La regola che spedisce lo script vero: confidenza E numero di lettere.
    // La confidenza da sola non basta — nel campione del 02/09 le parole lette
    // meglio erano "|" a 97 e "i" a 95.
    for (const [conf, lettere] of [
      [50, 3],
      [60, 3],
      [60, 4],
      [70, 3],
    ]) {
      const testo = cleanText(
        linesFromBlocks(blocchi, { minConfidence: conf, minLetters: lettere }),
      );
      const righe = testo ? testo.split("\n") : [];
      const marca = conf === 60 && lettere === 3 ? " <= in produzione" : "";
      console.log(
        `  conf>=${conf} + ${lettere} lettere -> ${JSON.stringify(righe.slice(0, 8))}${marca}`,
      );
    }
  }

  const conLettere = globali.filter((w) => letterCount(w.text) >= 3);
  console.log(
    `\nParole con almeno 3 lettere: ${conLettere.length}/${globali.length}` +
      ` — di queste, sopra 60 di confidenza: ${conLettere.filter((w) => w.confidence >= 60).length}`,
  );

  const ordinate = [...globali].sort((a, b) => b.confidence - a.confidence);
  console.log("\nLe 15 parole lette meglio (dovrebbero essere il testo vero):");
  console.log(
    "  " +
      ordinate
        .slice(0, 15)
        .map((w) => `${w.text}(${w.confidence.toFixed(0)})`)
        .join(" "),
  );
  console.log("\nLe 15 lette peggio (dovrebbero essere rumore):");
  console.log(
    "  " +
      ordinate
        .slice(-15)
        .map((w) => `${w.text}(${w.confidence.toFixed(0)})`)
        .join(" "),
  );
}

await main();
