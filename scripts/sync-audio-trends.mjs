// Trend Virali: rileva "audio in trend" tra i Reel dei Canali Inspo — 3+
// Reel diversi con lo stesso audio, da almeno 2 canali distinti. Due
// passate lato server (vedi sync-audio-trends.ts): match esatto su
// audio_url (deterministico), poi fingerprint acustico (Chromaprint,
// euristico) solo sui Reel che il match esatto non è riuscito a
// raggruppare — recupera il caso di un audio ricaricato come "originale"
// da un altro utente, che il match esatto per definizione non vede.
//
// Nessuno scraping qui: aggrega solo ciò che discover-canali-inspo-content.mjs
// ha già raccolto (audio_name/audio_url/audio_fingerprint) — per questo lo
// script è solo una chiamata all'endpoint, niente Playwright.
//
// Eseguito da .github/workflows/sync-audio-trends.yml su schedule, dopo
// Discover Canali Inspo Content.

const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-audio-trends";

console.log("=== TRENDZN — Rilevamento audio in trend (Canali Inspo) ===");

const res = await fetch(SYNC_ENDPOINT, { method: "POST" });
if (!res.ok) {
  console.error(`sync-audio-trends fallito (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const result = await res.json();
console.log(
  `Match esatto: ${result.audioUrlGroups ?? 0} gruppi audio_url, ${result.exactPromoted ?? 0} Reel promossi, ${result.exactReset ?? 0} resettati.`,
);
console.log(
  `Match fingerprint: ${result.fingerprintCandidates ?? 0} Reel candidati (audio isolato dal match esatto), ${result.fingerprintPromoted ?? 0} promossi.`,
);
