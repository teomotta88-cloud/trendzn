// Script diagnostico usa-e-getta: come probe-tiktok-hashtag-depth.mjs
// (scroll DOM, fermo a 60 video su #bluserena) e
// probe-tiktok-hashtag-api-depth.py (paginazione API anonima via TikTokApi,
// bloccata subito da TikTok anche con webkit + ms_token reale), ma qui la
// scoperta è delegata al servizio a pagamento Apify (actor
// clockworks/tiktok-hashtag-scraper), che investe in infrastruttura
// anti-rilevamento (proxy, ecc.) che le nostre tecniche fai-da-te non hanno.
// Nessuna scrittura sullo store Bluserena-monitoring: solo output in
// console, per confrontare la copertura ottenuta con i probe precedenti.
//
// Uso: node scripts/probe-tiktok-hashtag-apify-depth.mjs <hashtag>
// Richiede env APIFY_API_TOKEN (secret GitHub, mai passato in chiaro).
// Env opzionali:
//   RESULTS_PER_PAGE (default 800 — la scheda dell'actor dichiara un range
//     tipico di 400-800 risultati per hashtag)
//   APIFY_TIMEOUT_SECS (default 280 — timeout lato Apify per l'esecuzione
//     sincrona; se il run reale richiede più tempo va alzato insieme al
//     timeout del job nel workflow)

const tag = process.argv[2];
if (!tag) {
  console.error("Uso: node scripts/probe-tiktok-hashtag-apify-depth.mjs <hashtag>");
  process.exit(1);
}

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_API_TOKEN) {
  console.error("Manca APIFY_API_TOKEN nell'ambiente (secret GitHub).");
  process.exit(1);
}

const RESULTS_PER_PAGE = parseInt(process.env.RESULTS_PER_PAGE ?? "800", 10);
const APIFY_TIMEOUT_SECS = parseInt(process.env.APIFY_TIMEOUT_SECS ?? "280", 10);

const ACTOR = "clockworks~tiktok-hashtag-scraper";
const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${APIFY_TIMEOUT_SECS}`;

console.log(`=== Probe Apify (clockworks/tiktok-hashtag-scraper): #${tag} ===`);
console.log(`Richiesti fino a ${RESULTS_PER_PAGE} risultati (timeout Apify ${APIFY_TIMEOUT_SECS}s)\n`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${APIFY_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    hashtags: [tag],
    resultsPerPage: RESULTS_PER_PAGE,
  }),
});

if (!res.ok) {
  console.error(`Chiamata Apify fallita: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const items = await res.json();
console.log(`Video totali restituiti: ${items.length}`);

if (items.length === 0) {
  process.exit(0);
}

const dates = [];
let withCaption = 0;
let withEngagement = 0;
let withLocation = 0;

for (const item of items) {
  const iso = item.createTimeISO ?? (item.createTime ? new Date(item.createTime * 1000).toISOString() : null);
  if (iso) dates.push(new Date(iso));
  if (item.text) withCaption++;
  if (item.diggCount != null || item.playCount != null) withEngagement++;
  if (item.locationCreated || item.location) withLocation++;
}

console.log(`Con caption: ${withCaption}/${items.length}`);
console.log(`Con engagement (like/views): ${withEngagement}/${items.length}`);
console.log(`Con geotag: ${withLocation}/${items.length}`);

if (dates.length === 0) {
  console.log("\nNessuna data ricavabile dagli item restituiti.");
  process.exit(0);
}

dates.sort((a, b) => a.getTime() - b.getTime());
console.log(`\nVideo più vecchio: ${dates[0].toISOString().slice(0, 10)}`);
console.log(`Video più recente: ${dates[dates.length - 1].toISOString().slice(0, 10)}`);

const byMonth = new Map();
for (const d of dates) {
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
}

console.log("Distribuzione per mese:");
for (const [month, count] of [...byMonth.entries()].sort()) {
  console.log(`  ${month}: ${count}`);
}
