// Trova le keyword/trend rilevati su più fonti indipendenti (TikTok/Google
// Trends/X/Reddit/YouTube trending + Canali Inspo, 6 fonti in tutto) e le
// classifica per numero di fonti che le condividono ("Trendzning Now" in
// /trend-virali):
//
//   2/6 fonti   -> tier "hot"         (1 peperoncino)
//   3-4/6 fonti -> tier "spicy"       (2 peperoncini)
//   5-6/6 fonti -> tier "super_spicy" (3 peperoncini)
//
// (Soglie scalate da 2/3/4 su 4 fonti totali a 2/3-4/5-6 su 6, per non far
// scattare "quasi tutte le fonti concordano" già a metà — vedi
// TIER_BY_SOURCE_COUNT sotto.)
//
// TikTok/Google Trends/X/Reddit/YouTube condividono già una chiave esatta
// (monitored_topics, vedi list-monitored-topics) — ma Canali Inspo no: le
// sue etichette cross-profilo sono testo libero generato da un LLM sulle
// didascalie (cross_profile_topic), fraseggiato in modo indipendente dalle
// altre fonti. Per questo il match tra TUTTE le fonti è fatto da un'unica
// chiamata LLM (matchTopicsAcrossSources in scripts/lib/openrouter.mjs)
// invece che da un confronto testuale, che fallirebbe quasi sempre su
// Canali Inspo — e, più in generale, coglie anche parafrasi/lingue diverse
// che un confronto per chiave esatta perderebbe (motivo per cui l'altro
// tentativo di corroborazione cross-fonte fatto in questo progetto, a
// chiave canonica testuale in src/lib/topicAcceleration.ts, è stato
// abbandonato a favore di questo).
//
// I trend Canali Inspo vengono comunque SEMPRE inclusi nel risultato (tag
// "Dai Canali Inspo" in UI), anche quando non trovano corrispondenza in
// nessun'altra fonte — su richiesta esplicita.
//
// is_accelerating: a differenza del conteggio fonti (statico — "quante ne
// parlano"), guarda se ALMENO UNO dei topic del gruppo sta accelerando
// adesso (vedi computeAcceleration in src/lib/topicAcceleration.ts,
// applicato server-side da list-monitored-topics.ts e già incluso nella
// risposta che questo script legge in fetchRankedTopics) — è la differenza
// tra "un trend condiviso da più fonti ma stabile" e "un trend condiviso E
// in crescita accelerata", il segnale di forecasting più forte disponibile.
//
// Eseguito da .github/workflows/match-cross-source-trends.yml, schedulato
// dopo Discover Canali Inspo Content (la fonte più lenta, ogni 6h) così da
// avere sempre dati freschi da tutte le fonti.

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

const RANKED_SOURCES = [
  "tiktok-hashtag",
  "google-trends",
  "x-trending",
  "reddit-trending",
  "youtube-trending",
];
const TIER_BY_SOURCE_COUNT = { 2: "hot", 3: "spicy", 4: "spicy", 5: "super_spicy", 6: "super_spicy" };

function topicLabel(topic) {
  if (topic.topic_type === "tiktok-hashtag") return topic.derived_keyword ?? topic.value;
  return topic.value;
}

// true se ALMENO UNA delle righe di crescita (una per piattaforma, vedi
// list-monitored-topics.ts) del topic è in accelerazione — vedi commento in
// testa al file.
function isTopicAccelerating(topic) {
  return (topic.acceleration ?? []).some((a) => a.trend === "accelerating");
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
  `Topic in classifica: ${rankedTopics.length} (TikTok/Google/X/Reddit/YouTube) · ${canaliInspoTopics.length} etichette Canali Inspo`,
);

// items[i] è la fonte di verità posizionale per gli indici che l'LLM
// restituisce: costruito una sola volta, mai riordinato dopo. accelerating:
// solo i topic con id (non Canali Inspo, che non ha una riga in
// monitored_topics) possono valerla.
const items = [
  ...rankedTopics.map((t) => ({
    id: t.id,
    label: topicLabel(t),
    source: t.topic_type,
    accelerating: isTopicAccelerating(t),
  })),
  ...canaliInspoTopics.map((t) => ({
    id: null,
    label: t.topic,
    source: "canali-inspo",
    accelerating: false,
  })),
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
    isAccelerating: false,
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
  const isAccelerating = groupItems.some((it) => it.accelerating);

  groups.push({
    label: g.label,
    sourceCount: sources.length,
    tier: TIER_BY_SOURCE_COUNT[sources.length] ?? null,
    sources,
    topicIds,
    canaliInspoTopic: canaliInspoItem?.label ?? null,
    isAccelerating,
  });

  console.log(
    `  "${g.label}": ${sources.join(" + ")} (${sources.length}/6) -> ${TIER_BY_SOURCE_COUNT[sources.length] ?? "nessun tier"}${isAccelerating ? " [in accelerazione]" : ""}`,
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
    isAccelerating: false,
  });
});

const result = await syncGroups(groups);
console.log(
  `\nSincronizzati: ${result.inserted ?? 0} gruppi (${groups.filter((g) => g.tier).length} con tier, ${groups.filter((g) => g.isAccelerating).length} in accelerazione, ${groups.filter((g) => g.sources.includes("canali-inspo")).length} da Canali Inspo)`,
);
