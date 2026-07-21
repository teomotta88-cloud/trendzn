// Riconoscimento "stesso audio, URL diverso" per i Reel dei Canali Inspo —
// il match esatto su audio_url (vedi sync-audio-trends.ts) copre il caso
// comune (più creator scelgono lo stesso audio dalla libreria Instagram),
// ma non l'audio riscaricato e ricaricato come "audio originale" da un
// altro utente: in quel caso sia audio_url SIA audio_name diventano nuovi
// e scollegati dall'originale — nessun match testuale (nemmeno via LLM,
// verificato prima di scrivere questo modulo) può recuperarlo, perché il
// testo stesso non porta più il segnale. Serve guardare il contenuto
// audio vero e proprio.
//
// Chromaprint (fpcalc) fa esattamente questo — libreria open source alla
// base di AcoustID/MusicBrainz, pensata per "sono la stessa registrazione",
// non per "che canzone è" (quello richiederebbe un servizio di
// riconoscimento contro un catalogo commerciale, un problema diverso e più
// costoso che qui non serve). Non è scritta da zero: chiamiamo il
// binario `fpcalc` già pronto (pacchetto apt `libchromaprint-tools`, vedi
// .github/workflows/discover-canali-inspo-content.yml), che sa leggere
// direttamente file video (mp4/h264+aac, il formato dei Reel) senza bisogno
// di un passaggio ffmpeg separato — decodifica l'audio internamente.
//
// Costo per cui questo modulo va usato con parsimonia (vedi
// MAX_FINGERPRINTS_PER_RUN in discover-canali-inspo-content.mjs): scarica
// il video INTERO (non solo la pagina), molto più pesante di una richiesta
// HTML — in una sessione che già oggi può finire in login-wall dopo troppe
// richieste consecutive.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const DOWNLOAD_TIMEOUT_MS = 30000;
const FPCALC_TIMEOUT_MS = 20000;
// Un fingerprint completo di un Reel di qualche decina di secondi basta e
// avanza per il confronto (vedi audioFingerprintSimilarity in
// sync-audio-trends.ts) — troncare la durata analizzata da fpcalc tiene
// bassi sia il tempo di calcolo sia la dimensione del fingerprint salvato.
const MAX_FINGERPRINT_SECONDS = 30;

// Scarica il video (CDN Instagram, URL firmato a scadenza breve — va usato
// SUBITO, nella stessa run in cui è stato estratto dal DOM, non salvato per
// dopo) e restituisce il fingerprint grezzo di Chromaprint: un array di
// interi a 32bit, uno ogni ~1/3 di secondo di audio. null se il download o
// fpcalc falliscono — mai un'eccezione che blocchi il chiamante, stesso
// trattamento "best effort" già in uso per il resto della discovery audio.
export async function computeAudioFingerprint(videoUrl) {
  const res = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; trendzn-bot/1.0)" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`download video fallito (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const tempPath = join(tmpdir(), `trendzn-audio-${randomUUID()}.mp4`);
  await writeFile(tempPath, buffer);
  try {
    const { stdout } = await execFileAsync(
      "fpcalc",
      ["-raw", "-json", "-length", String(MAX_FINGERPRINT_SECONDS), tempPath],
      { timeout: FPCALC_TIMEOUT_MS },
    );
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed.fingerprint) || parsed.fingerprint.length === 0) {
      throw new Error("fpcalc: fingerprint mancante o vuoto nell'output");
    }
    return parsed.fingerprint;
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
