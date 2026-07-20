// Trova le keyword/trend rilevati su più fonti indipendenti
// (TikTok/Google Trends/X trending + Canali Inspo) e le classifica per
// numero di fonti che le condividono ("Trendzning Now" in /trend-virali):
//
//   2/4 fonti -> tier "hot"         (1 peperoncino)
//   3/4 fonti -> tier "spicy"       (2 peperoncini)
//   4/4 fonti -> tier "super_spicy" (3 peperoncini)
//
// TikTok/Google Trends/X condividono già una chiave esatta (monitored_topics,
// vedi list-monitored-topics) — ma Canali Inspo no: le sue etichette
// cross-profilo sono testo libero generato da un LLM sulle didascalie
// (cross_profile_topic), fraseggiato in modo indipendente dalle altre fonti.
// Per questo il match tra TUTTE e 4 le fonti è fatto da un'unica chiamata
// LLM (matchTopicsAcrossSources in scripts/lib/openrouter.mjs) invece che
// da un confronto testuale, che fallirebbe quasi sempre su Canali Inspo.
//
// I trend Canali Inspo vengono comunque SEMPRE inclusi nel risultato (tag
// "Dai Canali Inspo" in UI), anche quando non trovano corrispondenza in
// nessun'altra fonte — su richiesta esplicita.
//
// Eseguito da .github/workflows/match-cross-source-trends.yml, schedulato
// dopo Discover Canali Inspo Content (la fonte più lenta, ogni 6h) così da
// avere sempre dati freschi da tutte e 4 le fonti.

import { matchTopicsAcrossSources } from "./lib/openrouter.mjs";

const LIST_TOPICS_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/list-monitored-topics";
const LIST_CANALI_INSPO_TOPICS_ENDPOINT =
  "https://trendzn.lovable.app/api/public/hooks/list-canali-inspo-topics";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-cross-source-trends";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Stessa soglia di isCurrentlyRanked in src/lib/monitoredTopics.ts: un topic
// "active" può essere nel periodo di grazia (uscito dai top-N, monitorato
// ancora 24h in background) — qui vogliamo solo quelli DAVVERO in classifica
// adesso, stessa logica della pagina /trend-virali.
const TOP5_FRESHNESS_HOURS = 7;
function isCurrentlyRanked(topic) {
  const ageMs = Date.now() - new Date(topic.last_seen_in_top5_at).getTime();
  return ageMs <= TOP5_FRESHNESS_HOURS * 60 * 60 * 1000;
}

const RANKED_SOURCES = ["tiktok-hashtag", "google-trends", "x-trending"];
const TIER_BY_SOURCE_COUNT = { 2: "hot", 3: "spicy", 4: "super_spicy" };

function topicLabel(topic) {
  if (topic.topic_type === "tiktok-hashtag") return topic.derived_keyword ?? topic.value;
  return topic.value;
}

async function fetchRankedTopics() {
  const res = await fetch(LIST_TOPICS_ENDPOINT);
  if (!res.ok) throw new Error(`list-monitored-topics fallito (${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(`list-monitored-topics error: ${data.error}`);
  return (data.topics ?? []).filter(
    (t) => RANKED_SOURCES.includes(t.topic_type) && isCurrentlyRanked(t),
  );
}

async function fetchCanaliInspoTopics() {
  const res = await fetch(LIST_CANALI_INSPO_TOPICS_ENDPOINT);
  if (!res.ok) throw new Error(`list-canali-inspo-topics fallito (${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(`list-canali-inspo-topics error: ${data.error}`);
  return data.topics ?? [];
}

async function syncGroups(groups) {
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sync-cross-source-trends fallito (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — Match trend cross-fonte ===");

const rankedTopics = await fetchRankedTopics();
const canaliInspoTopics = await fetchCanaliInspoTopics();

console.log(
  `Topic in classifica: ${rankedTopics.length} (TikTok/Google/X) · ${canaliInspoTopics.length} etichette Canali Inspo`,
);

// items[i] è la fonte di verità posizionale per gli indici che l'LLM
// restituisce: costruito una sola volta, mai riordinato dopo.
const items = [
  ...rankedTopics.map((t) => ({ id: t.id, label: topicLabel(t), source: t.topic_type })),
  ...canaliInspoTopics.map((t) => ({ id: null, label: t.topic, source: "canali-inspo" })),
];

if (!GROQ_API_KEY && !OPENROUTER_API_KEY) {
  console.log("Né GROQ_API_KEY né OPENROUTER_API_KEY configurate: nessun match cross-fonte possibile.");
  console.log("Sincronizzo comunque i soli trend Canali Inspo (sempre mostrati in UI).");
  const canaliInspoOnly = canaliInspoTopics.map((t) => ({
    label: t.topic,
    sourceCount: 1,
    tier: null,
    sources: ["canali-inspo"],
    topicIds: [],
    canaliInspoTopic: t.topic,
  }));
  const result = await syncGroups(canaliInspoOnly);
  console.log(`Sincronizzati: ${result.inserted ?? 0}`);
  process.exit(0);
}

let llmGroups = [];
if (items.length >= 2) {
  try {
    llmGroups = await matchTopicsAcrossSources(items, {
      apiKey: OPENROUTER_API_KEY,
      groqApiKey: GROQ_API_KEY,
    });
  } catch (err) {
    console.error(`Match cross-fonte fallito (non bloccante): ${String(err)}`);
  }
}

console.log(`Gruppi proposti dall'LLM: ${llmGroups.length}`);

const matchedIndices = new Set();
const groups = [];

for (const g of llmGroups) {
  const groupItems = g.indices.map((i) => items[i]);
  const sources = [...new Set(groupItems.map((it) => it.source))];
  if (sources.length < 2) continue; // stesso indice ripetuto o stessa fonte due volte: non è un match cross-fonte

  for (const i of g.indices) matchedIndices.add(i);

  const topicIds = [...new Set(groupItems.filter((it) => it.id).map((it) => it.id))];
  const canaliInspoItem = groupItems.find((it) => it.source === "canali-inspo");

  groups.push({
    label: g.label,
    sourceCount: sources.length,
    tier: TIER_BY_SOURCE_COUNT[sources.length] ?? null,
    sources,
    topicIds,
    canaliInspoTopic: canaliInspoItem?.label ?? null,
  });

  console.log(
    `  "${g.label}": ${sources.join(" + ")} (${sources.length}/4) -> ${TIER_BY_SOURCE_COUNT[sources.length] ?? "nessun tier"}`,
  );
}

// I trend Canali Inspo che non hanno trovato corrispondenza altrove restano
// comunque nel risultato (source_count=1, nessun tier) — sempre mostrati in
// UI con il solo tag "Dai Canali Inspo", su richiesta esplicita.
items.forEach((it, i) => {
  if (it.source !== "canali-inspo" || matchedIndices.has(i)) return;
  groups.push({
    label: it.label,
    sourceCount: 1,
    tier: null,
    sources: ["canali-inspo"],
    topicIds: [],
    canaliInspoTopic: it.label,
  });
});

const result = await syncGroups(groups);
console.log(`\nSincronizzati: ${result.inserted ?? 0} gruppi (${groups.filter((g) => g.tier).length} con tier, ${groups.filter((g) => g.sources.includes("canali-inspo")).length} da Canali Inspo)`);
