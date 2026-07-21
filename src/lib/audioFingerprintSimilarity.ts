// Confronto tra due fingerprint acustici grezzi (Chromaprint/fpcalc, vedi
// scripts/lib/audio-fingerprint.mjs) — completa il match esatto su
// audio_url già in sync-audio-trends.ts per i casi in cui lo stesso audio
// è stato ricaricato con un URL diverso.
//
// Un fingerprint grezzo è un array di interi a 32bit, uno ogni ~1/3 di
// secondo di audio — ogni intero è un hash dello spettro del suono in
// quella finestra. Due registrazioni identiche (o quasi: un repost passa
// di solito per una ri-codifica, non un taglia-e-incolla perfetto)
// producono interi molto simili bit a bit nella stessa posizione, ma non
// necessariamente TUTTI identici — da qui il bisogno di una similarità
// "quanti bit combaciano in media", non un confronto esatto elemento per
// elemento.
//
// Approccio standard per il confronto di fingerprint Chromaprint (usato,
// con variazioni, da diversi strumenti open source di deduplicazione
// audio): per ogni piccolo offset di allineamento (i repost possono
// iniziare qualche frazione di secondo prima/dopo l'originale, es. per un
// fade-in aggiunto), calcola la frazione media di bit che combaciano tra i
// due fingerprint sovrapposti; prendi il miglior offset.

// Quanti bit su 32 possono differire prima di considerare DUE FRAME
// (non l'intero fingerprint) "diversi" — non 0, perché anche due
// registrazioni identiche hanno piccola variazione da rumore di codifica.
const MAX_BIT_DIFFERENCE_PER_FRAME = 10;

// Offset di allineamento provati, in frame (~1/3 di secondo l'uno) — copre
// uno sfasamento fino a circa ±1.5s tra le due registrazioni.
const MAX_ALIGNMENT_OFFSET_FRAMES = 5;

// Sotto questa soglia di frame sovrapposti il confronto non è affidabile
// (troppo pochi dati, rischio di somiglianza spuria per caso).
const MIN_OVERLAP_FRAMES = 8;

// Soglia di similarità (0-1) sopra la quale due fingerprint sono
// considerati lo stesso audio — DA CALIBRARE su dati reali (nessun
// fingerprint reale disponibile in questo ambiente di sviluppo, stessa
// situazione già segnalata per altre soglie in questo progetto, es.
// ACCELERATION_MIN_DELTA_PCT_POINTS in topicAcceleration.ts). Punto di
// partenza prudente: alto abbastanza da minimizzare falsi positivi (due
// audio diversi scambiati per lo stesso), a costo di qualche falso
// negativo in più oltre a quelli già noti e accettati.
export const FINGERPRINT_MATCH_THRESHOLD = 0.9;

function popcount32(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >> 24;
}

function similarityAtOffset(a: number[], b: number[], offset: number): number | null {
  const start = Math.max(0, -offset);
  const end = Math.min(a.length, b.length - offset);
  const overlap = end - start;
  if (overlap < MIN_OVERLAP_FRAMES) return null;

  let matchingFrames = 0;
  for (let i = start; i < end; i++) {
    const xor = (a[i] ^ b[i + offset]) >>> 0;
    if (popcount32(xor) <= MAX_BIT_DIFFERENCE_PER_FRAME) matchingFrames++;
  }
  return matchingFrames / overlap;
}

// Similarità 0-1 tra due fingerprint, al miglior allineamento trovato —
// null se non c'è abbastanza sovrapposizione per un confronto affidabile
// a nessun offset.
export function fingerprintSimilarity(a: number[], b: number[]): number | null {
  let best: number | null = null;
  for (let offset = -MAX_ALIGNMENT_OFFSET_FRAMES; offset <= MAX_ALIGNMENT_OFFSET_FRAMES; offset++) {
    const score = similarityAtOffset(a, b, offset);
    if (score != null && (best == null || score > best)) best = score;
  }
  return best;
}

export function isSameAudio(a: number[], b: number[]): boolean {
  const similarity = fingerprintSimilarity(a, b);
  return similarity != null && similarity >= FINGERPRINT_MATCH_THRESHOLD;
}
