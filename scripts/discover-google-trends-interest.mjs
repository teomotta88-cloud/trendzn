// Trend Virali — Fase D: magnitudine reale per i topic Google Trends già
// monitorati (topic_type='google-trends', scoperti da sync-viral-trends.mjs
// tramite l'RSS delle ricerche in tendenza). Finora un topic Google Trends
// aveva solo una presenza binaria ("è nel top-25 sì/no", via
// last_seen_in_top5_at) — nessun numero storicizzato come per TikTok
// (post_count reale). Questo script aggiunge un vero indice di interesse
// (0-100, relativo) via fetchInterestOverTime (scripts/lib/google-trends.mjs),
// registrato come snapshot in topic_metrics_history (platform='google-trends')
// esattamente come le altre fonti — da qui in poi anche Google Trends ha una
// vera curva di crescita utilizzabile dal motore di accelerazione (Fase E),
// non solo "dentro o fuori dal top-25".
//
// Non fa discovery di nuovi topic (quella resta a sync-viral-trends.mjs):
// legge solo i topic google-trends già monitorati e ne misura la
// magnitudine. Un topic uscito dai top-25 ma ancora in periodo di grazia
// (status='active') continua a essere misurato — la sua curva di interesse
// che scende è essa stessa un segnale utile (trend in calo, non solo "fuori
// classifica").
//
// Rischio: stesso profilo dell'RSS in google-trends.mjs (endpoint interno
// non documentato) più aggravato dal rate-limit più aggressivo che Google
// applica alle chiamate /explore + /widgetdata ripetute — DELAY_BETWEEN_CALLS_MS
// più alto delle altre fonti apposta, e un fallimento su una singola keyword
// non deve mai bloccare le altre.
//
// Variabili d'ambiente:
//   MAX_TOPICS_PER_RUN       default: 15 — quanti topic google-trends
//                            misurare al massimo in un run (limita sia il
//                            tempo totale sia il rischio di rate-limit)
//   DELAY_BETWEEN_CALLS_MS   default: 4000
//
// Eseguito da .github/workflows/discover-google-trends-interest.yml su schedule.

import { fetchInterestOverTime, latestInterestValue } from "./lib/google-trends.mjs";

const LIST_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/list-monitored-topics";
const RECORD_VOLUME_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/record-topic-volume";

const MAX_TOPICS_PER_RUN = parseInt(process.env.MAX_TOPICS_PER_RUN ?? "15", 10);
const DELAY_BETWEEN_CALLS_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "4000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGoogleTrendsTopics() {
  const res = await fetch(LIST_TOPICS_ENDPOINT);
  if (!res.ok) throw new Error(`list-monitored-topics fallito (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`list-monitored-topics error: ${data.error}`);
  return (data.topics ?? []).filter((t) => t.topic_type === "google-trends");
}

async function recordSignal(topicId, interestValue) {
  const res = await fetch(RECORD_VOLUME_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicId,
      platform: "google-trends",
      // Come per YouTube: non un "volume di contenuti" ma una magnitudine
      // singola (l'indice di interesse) — va in total_engagement, non in
      // content_volume. isVolumeExact=true: è una misura reale della fonte,
      // non un campione come la pagina hashtag Instagram.
      contentVolume: null,
      totalEngagement: interestValue,
      isVolumeExact: true,
    }),
  });
  if (!res.ok) throw new Error(`record-topic-volume fallito (${res.status}): ${await res.text()}`);
}

console.log("=== TRENDZN — Google Trends: interesse reale nel tempo ===");

const topics = (await fetchGoogleTrendsTopics()).slice(0, MAX_TOPICS_PER_RUN);
console.log(`Topic Google Trends da misurare: ${topics.length}`);

let measured = 0;
let failed = 0;

for (let i = 0; i < topics.length; i++) {
  const topic = topics[i];
  console.log(`\n[${i + 1}/${topics.length}] "${topic.value}"`);

  try {
    const points = await fetchInterestOverTime({ keyword: topic.value, geo: "IT" });
    const interestValue = latestInterestValue(points);
    if (interestValue == null) {
      console.log("  Nessun punto restituito, salto.");
      failed++;
    } else {
      console.log(`  Interesse attuale: ${interestValue}/100 (${points.length} punti nella serie).`);
      await recordSignal(topic.id, interestValue);
      measured++;
    }
  } catch (err) {
    console.error(`  Errore: ${String(err)}`);
    failed++;
  }

  if (i < topics.length - 1) {
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }
}

console.log(`\n=== Fine === Misurati: ${measured} · Falliti: ${failed}`);
