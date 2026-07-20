// Trend Virali: rileva "audio in trend" tra i Reel dei Canali Inspo — 3+
// Reel diversi con lo stesso audio_url, da almeno 2 canali distinti (vedi
// sync-audio-trends.ts per la logica esatta e i limiti noti del match per
// URL, che non cattura un audio ricaricato come "originale" da un altro
// utente).
//
// Nessuno scraping qui: aggrega solo ciò che discover-canali-inspo-content.mjs
// ha già raccolto (audio_name/audio_url, Fase F) — per questo lo script è
// solo una chiamata all'endpoint, niente Playwright.
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
  `Gruppi audio analizzati: ${result.audioGroups ?? 0} · Reel promossi a "in trend": ${result.promoted ?? 0} · Reel resettati: ${result.reset ?? 0}`,
);
