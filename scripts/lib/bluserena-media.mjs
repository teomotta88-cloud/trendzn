// Download video + estrazione frame/audio per gli script di analisi Bluserena.
//
// Il punto centrale di questo modulo è NON mascherare i fallimenti degli
// eseguibili esterni. Il vecchio codice OCR usava:
//     if (result.status !== 0 && result.status !== null) { ... }
// ma quando il binario non esiste spawnSync ritorna status: null e valorizza
// result.error (ENOENT): il guard lasciava passare e "yt-dlp non installato"
// si travestiva da "video non disponibile". Il workflow OCR girava così verde
// senza aver mai fatto un solo OCR. Stessa classe di bug lato audio, dove
// ffmpeg veniva lanciato in pipe con `| grep -i error || true`, che azzera
// sempre l'exit code.

import fs from "fs";
import { spawnSync } from "child_process";

// Eseguibile esterno con esito esplicito: `ok` è vero solo se il processo è
// partito davvero ed è uscito con 0.
// L'ultima riga utile di stderr, che per yt-dlp è quella dell'estrattore.
function withDetail(reason, stderr) {
  const line = (stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  return line ? `${reason}: ${line.slice(0, 200)}` : reason;
}

export function run(bin, args, { timeoutMs = 60_000 } = {}) {
  const res = spawnSync(bin, args, {
    stdio: "pipe",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) {
    const why = res.error.code === "ENOENT" ? `${bin} non installato` : res.error.message;
    return { ok: false, reason: why, stdout: "", stderr: "" };
  }
  if (res.status !== 0) {
    const stderr = res.stderr?.toString() ?? "";
    const reason =
      res.signal === "SIGTERM" ? `${bin} timeout dopo ${timeoutMs}ms` : `${bin} exit ${res.status}`;
    return { ok: false, reason, stdout: res.stdout?.toString() ?? "", stderr };
  }

  return { ok: true, stdout: res.stdout?.toString() ?? "", stderr: res.stderr?.toString() ?? "" };
}

// ffmpeg e ffprobe NON accettano `--version`: usano l'opzione a trattino
// singolo `-version` ed escono con errore (8 e 1 rispettivamente) su
// un'opzione sconosciuta. Chiamarli con `--version` faceva fallire il
// preflight su binari perfettamente installati — run #16 di entrambi i
// workflow, con `ffmpeg -version` che due righe sopra stampava la versione.
const VERSION_ARG = { ffmpeg: "-version", ffprobe: "-version" };

export function versionArg(bin) {
  return VERSION_ARG[bin] ?? "--version";
}

// Preflight: meglio fallire subito e rumorosamente che processare 100 post
// producendo 100 "download failed".
export function assertBinaries(bins) {
  const missing = [];
  for (const bin of bins) {
    const res = run(bin, [versionArg(bin)], { timeoutMs: 20_000 });
    if (res.ok) {
      console.log(`  ✓ ${bin}: ${res.stdout.trim().split("\n")[0].slice(0, 60)}`);
    } else {
      missing.push(`${bin} (${res.reason})`);
    }
  }
  if (missing.length) {
    console.error(`❌ Eseguibili mancanti: ${missing.join(", ")}`);
    console.error("   Il workflow deve installarli prima di lanciare lo script.");
    process.exit(1);
  }
}

// TikTok riconosce lo User-Agent di default e serve una pagina di login al
// posto del video: è lo stesso blocco già diagnosticato e risolto per lo
// scraping delle caption (vedi REAL_CHROME_UA in sync-bluserena-hashtags.mjs,
// dove con lo UA di default la caption risultava null su 15 post su 15).
const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function downloadVideo(url, outPath, { timeoutMs = 120_000 } = {}) {
  const res = run(
    "yt-dlp",
    [
      "--no-warnings",
      "--no-playlist",
      "--user-agent",
      REAL_CHROME_UA,
      "--retries",
      "3",
      "--extractor-retries",
      "2",
      "-f",
      "best[ext=mp4]/best",
      "--socket-timeout",
      "30",
      "-o",
      outPath,
      url,
    ],
    { timeoutMs },
  );

  // "yt-dlp exit 1" da solo non dice niente: senza il messaggio
  // dell'estrattore non si distingue un post rimosso da un blocco di TikTok.
  if (!res.ok) return { ok: false, reason: withDetail(res.reason, res.stderr) };
  // yt-dlp può uscire 0 anche senza produrre il file (es. post rimosso).
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    return { ok: false, reason: "yt-dlp non ha prodotto un file" };
  }
  return { ok: true };
}

export function probeDurationSec(videoPath) {
  const res = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { timeoutMs: 20_000 },
  );
  if (!res.ok) return null;
  const seconds = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function cleanup(...paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}
