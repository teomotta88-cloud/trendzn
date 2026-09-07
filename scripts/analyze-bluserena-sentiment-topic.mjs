// Analisi AI di sentiment, topic e location per i post Bluserena-monitoring,
// su TUTTO il testo che il post porta con sé: caption, parlato (trascrizione
// audio) e testo sovraimpresso (OCR).
//
// Perché i tre insieme: nei reel il messaggio sta quasi sempre nel parlato o
// nella grafica a video, non nella caption — sui 338 post BSConfirmed della
// finestra, 332 hanno una trascrizione e 173 hanno testo on-screen, e 8 non
// hanno caption del tutto. Analizzare la sola caption significava dare un
// sentiment a metà del contenuto.
//
// Perimetro: i post BSConfirmed nella finestra luglio-agosto 2025 e 2026 (la
// finestra è quella di tutta la pagina, la impone il driver condiviso). I post
// non confermati sono rumore da hashtag omonimi — hotel Serena in Uganda e in
// Pakistan — e analizzarli costerebbe chiamate LLM per sporcare le medie.
//
// Il record finisce in `sentimentData` (con status, confidence, fonti usate e
// versione), e i campi piatti `sentiment`, `topics` e `location` che legge la
// UI vengono aggiornati di conseguenza. La versione permette al driver di
// riprendere una run interrotta e di rifare tutto da solo quando il prompt
// cambia, senza flag da ricordare.
//
// NOTA: la vecchia versione di questo script scriveva in `audioAnalysis` il
// risultato di un'analisi LLM dei METADATI audio (nome del suono TikTok),
// serializzato come stringa. Da quando analyze-bluserena-audio.mjs mette lì la
// trascrizione Whisper, quella scrittura distruggeva le trascrizioni: è stata
// rimossa, questo script non tocca più audioAnalysis né ocrData.
//
// Env:
//   OPENROUTER_API_KEY / GROQ_API_KEY: almeno una delle due
//   GITHUB_TOKEN: obbligatoria
//   MIN_CONFIDENCE: soglia sotto la quale il sentiment non viene applicato (0.6)
//   MAX_POSTS / MAX_MINUTES / BATCH_SIZE / REPROCESS_FAILED: vedi lib/bluserena-enrich.mjs

import { chatCompletionWithFallback } from "./lib/openrouter.mjs";
import { runEnrichment } from "./lib/bluserena-enrich.mjs";

// Alzare quando il prompt o le regole cambiano: il driver rifà da solo i
// record scritti con una versione precedente.
const VERSION = 1;

const MIN_CONFIDENCE = Number.parseFloat(process.env.MIN_CONFIDENCE ?? "0.6");

const apiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

if (!apiKey && !groqApiKey) {
  console.error("Serve almeno una chiave API: OPENROUTER_API_KEY o GROQ_API_KEY");
  process.exit(1);
}
if (!process.env.GITHUB_TOKEN) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

// Nomi da riconoscere come location. Sono gli stessi resort della verifica
// BSConfirmed, in forma estesa: qui servono a dire DOVE, non SE.
const RESORTS = [
  "Bluserena",
  "Is Serenas Badesi Resort",
  "Calaserena Resort",
  "Serenusa Resort",
  "Serena Majestic Hotel Residence",
  "Sibari Green Resort",
  "Serenè Resort",
  "Granserena Hotel",
  "Torreserena Resort",
  "Calanè Resort",
  "Valentino Resort",
  "Kalidria Hotel & Thalasso SPA",
  "Alborèa Ecolodge Resort",
  "Ethra Reserve",
];

// Trascrizioni e OCR possono essere lunghi: un reel di un minuto fa qualche
// migliaio di caratteri e il prompt non ci guadagna nulla oltre un certo
// punto, mentre il costo per chiamata sì.
const MAX_CHARS = 1500;

const clip = (text) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_CHARS ? `${clean.slice(0, MAX_CHARS)}…` : clean;
};

function buildPrompt(sections) {
  const blocco = sections.map(({ label, text }) => `${label}:\n"${text}"`).join("\n\n");

  return `
Analizza questo post social di un resort italiano. Il contenuto arriva da più
fonti: valutale INSIEME, nessuna prevale sulle altre.

${blocco}

Tieni presente che la trascrizione audio e il testo on-screen sono generati
automaticamente e possono contenere errori di riconoscimento: se una parola
sembra storpiata, interpretala dal contesto invece di trattarla come rumore.

Rispondi in JSON con:
1. sentiment: "positive" | "negative" | "neutral" — il sentimento di chi ha
   pubblicato il post verso la vacanza/struttura, considerando tutte le fonti
2. topics: array di argomenti principali (es: ["animazione", "spiaggia", "cibo"])
3. locations: array di strutture citate, scelte SOLO fra: ${RESORTS.join(", ")}
4. confidence: numero fra 0 e 1

Rispondi SOLO con JSON valido, senza markdown e senza altro testo.
Esempio: {"sentiment": "positive", "topics": ["animazione", "mare"], "locations": ["Torreserena Resort"], "confidence": 0.9}
  `.trim();
}

const parse = (text) => {
  try {
    const json = JSON.parse(text.trim());
    if (!json.sentiment || !Array.isArray(json.topics)) return null;
    if (!["positive", "negative", "neutral"].includes(json.sentiment)) return null;
    return json;
  } catch {
    return null;
  }
};

async function analyzePost(account) {
  // Le fonti effettivamente disponibili per QUESTO post: finiscono nel record
  // così si sa su cosa è stato deciso il sentiment, senza riaprire il post.
  const sections = [];
  const sources = [];

  const caption = clip(account.caption);
  if (caption) {
    sections.push({ label: "Caption del post", text: caption });
    sources.push("caption");
  }

  const transcript =
    account.audioAnalysis?.status === "ok" ? clip(account.audioAnalysis.transcript) : "";
  if (transcript) {
    sections.push({ label: "Parlato nel video (trascrizione automatica)", text: transcript });
    sources.push("audio");
  }

  const onScreen = account.ocrData?.status === "ok" ? clip(account.ocrData.textOnScreen) : "";
  if (onScreen) {
    sections.push({ label: "Testo sovraimpresso nel video (OCR)", text: onScreen });
    sources.push("ocr");
  }

  if (!sections.length) {
    return {
      status: "no_text",
      sentiment: null,
      topics: [],
      location: null,
      confidence: 0,
      sources,
    };
  }

  let result;
  try {
    result = await chatCompletionWithFallback([{ role: "user", content: buildPrompt(sections) }], {
      apiKey,
      groqApiKey,
      parse,
    });
  } catch (err) {
    return {
      status: "error",
      reason: String(err?.message ?? err).slice(0, 200),
      sentiment: null,
      topics: [],
      location: null,
      confidence: 0,
      sources,
    };
  }

  const confidence = Number(result.confidence) || 0;
  const locations = Array.isArray(result.locations) ? result.locations : [];

  console.log(
    `    ${result.sentiment} (conf ${confidence.toFixed(2)}) da ${sources.join("+")}` +
      `${confidence < MIN_CONFIDENCE ? " — sotto soglia, non applicato" : ""}`,
  );

  // Sotto soglia il record resta "ok" (la pipeline ha funzionato, il modello
  // era solo incerto) ma il sentiment non viene applicato: meglio un post
  // "non analizzato" che una media inquinata da tirate a indovinare.
  return {
    status: "ok",
    sentiment: confidence >= MIN_CONFIDENCE ? result.sentiment : null,
    topics: confidence >= MIN_CONFIDENCE ? result.topics.filter(Boolean).slice(0, 8) : [],
    location: locations[0] ?? null,
    confidence,
    minConfidence: MIN_CONFIDENCE,
    sources,
  };
}

// Il record vive in sentimentData, ma la UI legge i campi piatti: vanno
// aggiornati insieme, o la pagina continuerebbe a mostrare l'analisi vecchia.
//
// sentiment e topics vengono SEMPRE dallo stesso record, anche quando è vuoto:
// tenersi i valori della run precedente significherebbe mostrare un giudizio
// dato sulla sola caption accanto a uno dato su caption + audio + OCR, senza
// modo di distinguerli. Se un post perde il sentiment, sentimentData dice
// perché (confidence sotto soglia, nessun testo, errore).
function applyRecord(account, record) {
  account.sentimentData = record;
  account.sentiment = record.sentiment;
  account.topics = record.topics?.length ? record.topics : undefined;
  // Il geotag vero, quando c'è, vale più di un nome dedotto dal testo.
  if (!account.location && record.location) account.location = record.location;
}

await runEnrichment({
  field: "sentimentData",
  version: VERSION,
  title: "Sentiment, topic e location su caption + audio + testo on-screen",
  commitMessage: (n) => `chore: sentiment su ${n} post Bluserena BSConfirmed [trendzn-bot]`,
  // Solo i post confermati: gli altri sono omonimie da hashtag e non entrano
  // nelle statistiche della pagina, che sono calcolate sui BSConfirmed.
  //
  // E mai quelli decisi a mano dal feed: sovrascriverli alla run notturna
  // renderebbe la correzione manuale inutile. Per rimetterli in circolo basta
  // riportarli a "non analizzato" dalla pagina, che cancella il record.
  select: (account) =>
    account.verificationStatus === "confirmed" && account.sentimentData?.status !== "manual",
  processPost: analyzePost,
  apply: applyRecord,
});
