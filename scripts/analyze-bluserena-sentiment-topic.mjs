// Analisi AI di sentiment, topic e location per i post Bluserena-monitoring.
// Usa Groq + OpenRouter per NLP su caption e metadati post.
//
// Per ogni post in bluserena-monitoring.json:
// 1. Estrae sentiment (positive/negative/neutral) dalla caption
// 2. Estrae topic (hashtag/argomenti) dalla caption
// 3. Tenta di rilevare location da geotag o match con elenco resort
// 4. Per TikTok: estrae audio (se disponibile) e lo analizza
//
// Salva i risultati aggiornando bluserena-monitoring.json su GitHub.
// Usa chatCompletionWithFallback da lib/openrouter.mjs per retry automatico.
//
// Env variables:
//   OPENROUTER_API_KEY: required for OpenRouter
//   GROQ_API_KEY: optional (for Groq free tier, tried first)
//   GITHUB_TOKEN: required for GitHub API
//   MIN_CONFIDENCE: (optional, default 0.6) - filtro per topic/sentiment con bassa confidenza
//   BATCH_SIZE: (optional, default 5) - quanti post analizzare in parallelo per limitare rate-limit
//   DRY_RUN: (optional) - se true, non scrive su GitHub

import { chatCompletionWithFallback } from "./lib/openrouter.mjs";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const WINDOW_A = { start: "2025-07-01", end: "2025-08-31" };
const WINDOW_B = { start: "2026-07-01", end: "2026-08-31" };

// Lista resort da matchare nelle caption (da estrarre da store attuale)
const RESORTS = [
  "Bluserena",
  "Cala Serena",
  "Serena Majestic",
  "Serena Majestic Hotel",
  "SerenaResort",
  "Serena Resort",
  "Torreserena",
  "Torre Serena",
  "Serenusa",
  "Serenahotel",
  "Serena Hotel",
  "Calanè",
  "Calanè Resort",
  "Calànè Resort",
  "GranSerena",
  "Gran Serena",
  "Sibari Green",
  "Sibari Green Resort",
  "Valentino",
  "Valentino Resort",
  "Kalidia",
  "Kalidia Hotel",
  "Alborèa",
  "Alborèa Ecolodge",
  "Ethra",
  "Ethra Reserve",
  "Is Serenas",
  "Is Serenas Badesi",
  "IsSerenas",
];

const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE ?? "0.6");
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "5", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

const apiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;

if (!apiKey && !groqApiKey) {
  console.error("Serve almeno una chiave API: OPENROUTER_API_KEY o GROQ_API_KEY");
  process.exit(1);
}

if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inWindow(date) {
  if (!date) return false;
  const d = date.slice(0, 10);
  return (d >= WINDOW_A.start && d <= WINDOW_A.end) || (d >= WINDOW_B.start && d <= WINDOW_B.end);
}

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    headers: ghHeaders,
  });

  if (!metaRes.ok) {
    throw new Error(`Lettura metadata fallita: ${metaRes.status} ${await metaRes.text()}`);
  }

  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;

  const rawRes = await fetch(rawUrl, {
    headers: {
      "User-Agent": "analyze-bluserena-sentiment",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!rawRes.ok) {
    throw new Error(`Lettura raw fallita: ${rawRes.status} ${await rawRes.text()}`);
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];

  // Crea mappa di post precedenti per merge intelligente (preserva sentiment/topics/location)
  const previousStore = {};
  for (const canale of store.canali) {
    for (const account of canale.accounts || []) {
      previousStore[account.url] = account;
    }
  }

  return { store, sha, previousStore };
}

async function writeStore(store, sha) {
  if (DRY_RUN) {
    console.log("(DRY_RUN) Non scrivo su GitHub.");
    return;
  }

  const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: analyze bluserena posts sentiment/topic [trendzn-bot]",
      content,
      sha,
    }),
  });

  if (!res.ok) {
    throw new Error(`Scrittura fallita: ${res.status} ${await res.text()}`);
  }
}

// Analizza metadati audio (TikTok sound name, IG audio, ecc.)
async function analyzeAudio(post) {
  const hasAudioUrl = !!post.audioUrl;
  const hasAudioName = !!post.audioName;

  if (!hasAudioUrl && !hasAudioName) {
    return null;
  }

  const audioContext = [];
  if (post.audioName) audioContext.push(`Audio name: ${post.audioName}`);
  if (post.audioUrl) audioContext.push(`Audio URL: ${post.audioUrl}`);

  const prompt = `
Analizza questo audio metadata da post social resort:
${audioContext.join("\n")}
Caption del post: "${post.caption || ""}"

Rispondi in JSON con:
1. audioSentiment: "positive" | "negative" | "neutral" (sentimento suggerito dall'audio)
2. audioGenre: stringa breve (es: "relaxing", "upbeat", "wedding", "travel")
3. audioRelevance: "high" | "medium" | "low" (quanto l'audio è rilevante al tema resort/vacanza)
4. confidence: numero 0-1

Rispondi SOLO con JSON valido, senza markdown.
Esempio: {"audioSentiment": "positive", "audioGenre": "upbeat", "audioRelevance": "high", "confidence": 0.7}
  `.trim();

  const messages = [
    {
      role: "user",
      content: prompt,
    },
  ];

  const parse = (text) => {
    try {
      const json = JSON.parse(text.trim());
      if (!json.audioSentiment) return null;
      return json;
    } catch {
      return null;
    }
  };

  try {
    const result = await chatCompletionWithFallback(messages, {
      apiKey,
      groqApiKey,
      parse,
    });

    return {
      sentiment: result.audioSentiment,
      genre: result.audioGenre || "unknown",
      relevance: result.audioRelevance || "unknown",
      confidence: result.confidence || 0,
    };
  } catch (err) {
    console.error(`Errore audio analysis post ${post.url}: ${err.message}`);
    return null;
  }
}

// Analizza un singolo post per sentiment, topic, location
async function analyzePost(post) {
  if (!post.caption && !post.url) {
    return { sentiment: null, topics: [], locations: [], audioAnalysis: null };
  }

  const caption = post.caption || "";

  // Includi OCR text se disponibile
  let ocrContext = "";
  if (post.ocrData?.textOnScreen) {
    ocrContext = `\nTesto on-screen (OCR): "${post.ocrData.textOnScreen}"`;
  }

  // Includi audio transcript se disponibile
  let audioContext = "";
  if (post.audioAnalysis?.transcript) {
    audioContext = `\nTranscript audio: "${post.audioAnalysis.transcript}"`;
  }

  const prompt = `
Analizza questo post social da resort italiano utilizzando TUTTI i dati disponibili:
Caption: "${caption}"${ocrContext}${audioContext}
URL: ${post.url}

Rispondi in JSON con:
1. sentiment: "positive" | "negative" | "neutral" (sentimento generale considerando caption, OCR e audio)
2. topics: array di argomenti/hashtag principali (es: ["vacanza", "mare", "relax"])
3. locations: array di nomi di resort/posti menzionati (cerca ${RESORTS.join(", ")})
4. confidence: numero 0-1 della fiducia nell'analisi

Rispondi SOLO con JSON valido, senza markdown, senza altro testo.
Esempio: {"sentiment": "positive", "topics": ["vacanza", "mare"], "locations": ["Cala Serena"], "confidence": 0.9}
  `.trim();

  const messages = [
    {
      role: "user",
      content: prompt,
    },
  ];

  const parse = (text) => {
    try {
      const json = JSON.parse(text.trim());
      if (!json.sentiment || !Array.isArray(json.topics)) return null;
      return json;
    } catch {
      return null;
    }
  };

  try {
    const result = await chatCompletionWithFallback(messages, {
      apiKey,
      groqApiKey,
      parse,
    });

    // Analizza audio se disponibile (per TikTok/IG Reels)
    let audioAnalysis = null;
    if ((post.audioUrl || post.audioName) && post.platform === "tiktok") {
      audioAnalysis = await analyzeAudio(post);
    }

    return {
      sentiment: result.sentiment,
      topics: result.topics || [],
      locations: result.locations || [],
      confidence: result.confidence || 0,
      audioAnalysis,
    };
  } catch (err) {
    console.error(`Errore analisi post ${post.url}: ${err.message}`);
    return { sentiment: null, topics: [], locations: [], audioAnalysis: null };
  }
}

// Applica risultati analisi al post, preservando dati precedenti se non sovrascrivibili
function applyAnalysis(post, analysis, previousPost) {
  // Se non abbiamo analisi valida, preserva i dati precedenti
  if (!analysis || analysis.confidence < MIN_CONFIDENCE) {
    if (previousPost) {
      post.sentiment = previousPost.sentiment;
      post.topics = previousPost.topics;
      post.location = previousPost.location;
      post.audioAnalysis = previousPost.audioAnalysis;
    }
    return;
  }

  // Applica nuova analisi
  post.sentiment = analysis.sentiment;
  post.topics = analysis.topics.length > 0 ? analysis.topics : undefined;

  // Per location: usa quella nuova se trovata, altrimenti preserva la vecchia
  if (analysis.locations && analysis.locations.length > 0) {
    post.location = analysis.locations[0];
  } else if (previousPost?.location) {
    post.location = previousPost.location;
  }

  if (analysis.audioAnalysis) {
    post.audioAnalysis = JSON.stringify(analysis.audioAnalysis);
  }
}

// Main
console.log(
  `Analisi Bluserena sentiment/topic per post in finestre: ${WINDOW_A.start}..${WINDOW_A.end}, ${WINDOW_B.start}..${WINDOW_B.end}`,
);
console.log(`Min confidence threshold: ${MIN_CONFIDENCE}`);
console.log(`Batch size: ${BATCH_SIZE}`);
if (DRY_RUN) console.log("(DRY_RUN mode attivo - nessuna modifica su GitHub)");

const { store, sha, previousStore } = await readStore();

let totalAnalyzed = 0;
let totalUpdated = 0;

for (const canale of store.canali) {
  console.log(`\nCanale: ${canale.name} (${canale.accounts?.length ?? 0} post)`);

  // Analizza TUTTI i post nella finestra temporale (rigenera sentiment/topics usando OCR + audio)
  const accountsToAnalyze = (canale.accounts || []).filter(
    (a) => inWindow(a.date) && a.caption,
  );

  if (accountsToAnalyze.length === 0) {
    console.log("  → Nessun post da analizzare (fuori finestra o già analizzati)");
    continue;
  }

  for (let i = 0; i < accountsToAnalyze.length; i += BATCH_SIZE) {
    const batch = accountsToAnalyze.slice(i, i + BATCH_SIZE);
    console.log(`  → Batch ${Math.floor(i / BATCH_SIZE) + 1}: analizzando ${batch.length} post...`);

    const results = await Promise.all(batch.map((post) => analyzePost(post)));

    let batchUpdated = 0;
    for (let j = 0; j < batch.length; j++) {
      const analysis = results[j];
      const previousPost = previousStore[batch[j].url];
      applyAnalysis(batch[j], analysis, previousPost);
      if (analysis.confidence >= MIN_CONFIDENCE) {
        batchUpdated++;
      }
    }

    console.log(`     → ${batchUpdated}/${batch.length} post aggiornati`);
    totalAnalyzed += batch.length;
    totalUpdated += batchUpdated;

    if (i + BATCH_SIZE < accountsToAnalyze.length) {
      await sleep(2000); // delay tra batch per rate-limit
    }
  }
}

console.log(`\n=== Riepilogo ===`);
console.log(`Post analizzati: ${totalAnalyzed}`);
console.log(`Post aggiornati: ${totalUpdated}`);

if (totalUpdated > 0) {
  console.log("Scritto su GitHub...");
  await writeStore(store, sha);
  console.log("✓ Completato!");
} else {
  console.log("Nessun aggiornamento.");
}
