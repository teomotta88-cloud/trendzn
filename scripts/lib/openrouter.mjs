// Due usi di un LLM gratuito (conversione hashtag -> keyword e raggruppamento
// di didascalie per argomento, vedi clusterCaptionsByTopic) su DUE provider
// con free tier senza carta di credito: Groq (console.groq.com, endpoint
// compatibile OpenAI) e OpenRouter (openrouter.ai, stesso formato).
//
// Groq va provato per primo: free tier molto più ampio (14.400 richieste/
// giorno, 30/minuto, verificato) contro i 50/giorno di OpenRouter prima di
// aver acquistato 10$ di credito una tantum. OpenRouter resta come secondo
// livello di fallback per diversificare ulteriormente.
//
// ATTENZIONE (lezione imparata dal vivo): la lista dei modelli gratuiti di
// ENTRAMBI i provider ruota nel tempo — modelli ritirati dal free tier
// (OpenRouter, 404 "unavailable for free") o deprecati (Groq, es. la
// deprecazione di giugno 2026 di llama-3.3-70b-versatile/llama-3.1-8b-instant)
// capitano regolarmente. Per questo NON usiamo più una lista statica di
// slug come unica fonte: la scopriamo dal vivo ad ogni chiamata via gli
// endpoint pubblici /models di ciascun provider (che girano dentro il job
// GitHub Actions, con internet pieno — questo repo può interrogarli anche
// se il fetch da altri ambienti verso i siti web di OpenRouter/Groq è
// bloccato da anti-bot). DEFAULT_MODELS resta solo come ultima rete di
// sicurezza se la discovery di OpenRouter stessa fallisce (rete giù, ecc.).
//
// Il limite è condiviso da TUTTO ciò che usa la stessa chiave in questo
// progetto (conversione hashtag, clustering Canali Inspo, estrazione
// keyword SBAM) — un singolo modello satura spesso, quindi entrambe le
// funzioni di questo file provano una LISTA di candidati (provider+modello)
// in sequenza invece di uno solo.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
// Modelli Groq non adatti a un task di chat/istruzioni generiche (audio in/
// out, classificatori di moderazione) — vanno esclusi dai candidati.
const GROQ_EXCLUDE_PATTERN = /whisper|tts|guard|moderation/i;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Ultima rete di sicurezza SOLO per OpenRouter, se la discovery via
// OPENROUTER_MODELS_URL fallisce (rete giù, risposta malformata) — non
// garantita aggiornata, vedi ATTENZIONE sopra.
const DEFAULT_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
];

// Codici HTTP che rendono sensato passare al candidato successivo invece di
// abortire: modello non disponibile (404), rate limit (429), errori
// provider (5xx). Auth (401/403) e richiesta malformata (400) sono fatali
// per QUEL provider, ma non impediscono di provare l'altro provider.
function shouldFallback(status) {
  return status === 404 || status === 429 || status >= 500;
}

// `model` (stringa, anche comma-separated) ha priorità se passato dal
// chiamante (es. da OPENROUTER_MODEL nell'ambiente) — bypassa la discovery
// dinamica per OpenRouter, resta un escape hatch manuale.
function resolveStaticModels(model) {
  if (!model) return null;
  const list = model
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

async function discoverGroqModels(groqApiKey) {
  const res = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${groqApiKey}` },
  });
  if (!res.ok) throw new Error(`Groq /models ha risposto ${res.status}`);
  const data = await res.json();
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => id && !GROQ_EXCLUDE_PATTERN.test(id));
  if (models.length === 0) throw new Error("Nessun modello chat disponibile su Groq");
  return models;
}

async function discoverOpenRouterFreeModels() {
  const res = await fetch(OPENROUTER_MODELS_URL);
  if (!res.ok) throw new Error(`OpenRouter /models ha risposto ${res.status}`);
  const data = await res.json();
  const free = (data.data ?? [])
    .filter(
      (m) =>
        m.id?.endsWith(":free") &&
        Number(m.pricing?.prompt ?? 1) === 0 &&
        Number(m.pricing?.completion ?? 1) === 0,
    )
    .map((m) => m.id);
  if (free.length === 0) throw new Error("Nessun modello :free trovato su OpenRouter");
  return free;
}

// Costruisce la lista di candidati (provider + modello) da provare in
// sequenza: prima tutti i modelli Groq disponibili (free tier più ampio),
// poi quelli OpenRouter — scoperti dal vivo, con fallback alla lista
// statica solo se la discovery OpenRouter stessa fallisce. Ogni lista è
// troncata a un tetto ragionevole: evita che un catalogo enorme (centinaia
// di modelli non-free su OpenRouter, filtrati ma comunque potenzialmente
// numerosi) dilati troppo il tempo di un singolo round.
const MAX_CANDIDATES_PER_PROVIDER = 15;

async function buildCandidates({ apiKey, groqApiKey, model }) {
  const candidates = [];

  if (groqApiKey) {
    try {
      const groqModels = await discoverGroqModels(groqApiKey);
      for (const m of groqModels.slice(0, MAX_CANDIDATES_PER_PROVIDER)) {
        candidates.push({ provider: "groq", model: m });
      }
    } catch (err) {
      console.log(`Discovery modelli Groq fallita (salto Groq per questa chiamata): ${err}`);
    }
  }

  if (apiKey) {
    const staticOverride = resolveStaticModels(model);
    const orModels =
      staticOverride ??
      (await discoverOpenRouterFreeModels().catch((err) => {
        console.log(`Discovery modelli OpenRouter fallita, uso la lista statica: ${err}`);
        return DEFAULT_MODELS;
      }));
    for (const m of orModels.slice(0, MAX_CANDIDATES_PER_PROVIDER)) {
      candidates.push({ provider: "openrouter", model: m });
    }
  }

  return candidates;
}

function stripJsonFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Quando TUTTI i candidati falliscono (capitato più volte in monitoraggio,
// prima di aggiungere Groq, con OpenRouter da solo), conviene aspettare e
// riprovare l'intera lista invece di arrendersi subito — utile contro
// saturazioni temporanee (429), inutile contro modelli ritirati in modo
// permanente (404), ma la discovery dinamica sopra dovrebbe già escludere
// questi ultimi ad ogni round. Non è un retry "a oltranza" vero e proprio
// (bloccherebbe il job a tempo indeterminato) ma un numero di round bounded
// con backoff, pensato per stare ben dentro il timeout-minutes del workflow
// chiamante.
const RETRY_ROUNDS = parseInt(process.env.OPENROUTER_RETRY_ROUNDS ?? "4", 10);
const RETRY_BASE_DELAY_MS = parseInt(process.env.OPENROUTER_RETRY_BASE_DELAY_MS ?? "20000", 10);
const RETRY_MAX_DELAY_MS = 3 * 60 * 1000;

async function callModel(candidate, messages, keys) {
  const { provider, model } = candidate;
  const url = provider === "groq" ? GROQ_URL : OPENROUTER_URL;
  const authKey = provider === "groq" ? keys.groqApiKey : keys.apiKey;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });

  if (!res.ok) {
    const body = await res.text();
    const detail = `${provider} (${model}) ha risposto ${res.status}: ${body.slice(0, 200)}`;
    if (shouldFallback(res.status)) return { text: null, errorDetail: detail };
    // Errore fatale (auth, richiesta malformata) per QUESTO provider: inutile
    // ritentare lo stesso modello, ma si passa comunque al candidato
    // successivo (altro modello o altro provider) invece di abortire tutto.
    return { text: null, errorDetail: detail };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return { text: null, errorDetail: `${provider} (${model}): risposta senza contenuto testuale` };
  return { text, errorDetail: null };
}

// Prova una lista di candidati (provider + modello) in sequenza, un retry
// per candidato sul solo caso "risposta presente ma non nel formato atteso"
// (parse(text) ritorna null) — stesso pattern già in uso in
// extract-keywords.ts. `parse` non deve lanciare: ritorna il risultato o null.
async function chatCompletionWithFallback(messages, { apiKey, groqApiKey, model, parse }) {
  const candidates = await buildCandidates({ apiKey, groqApiKey, model });
  if (candidates.length === 0) {
    throw new Error("Nessuna API key configurata (né Groq né OpenRouter) o nessun candidato disponibile.");
  }

  const errors = [];

  for (let round = 0; round <= RETRY_ROUNDS; round++) {
    for (const candidate of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { text, errorDetail } = await callModel(candidate, messages, { apiKey, groqApiKey });
        if (errorDetail) {
          errors.push(`round ${round + 1}: ${errorDetail}`);
          break; // errore di trasporto/rate-limit: non ha senso ritentare lo stesso candidato
        }
        const parsed = parse(text);
        if (parsed !== null) return parsed;
        errors.push(
          `round ${round + 1}: ${candidate.provider} (${candidate.model}): risposta non nel formato atteso (tentativo ${attempt + 1})`,
        );
      }
    }

    if (round < RETRY_ROUNDS) {
      const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** round, RETRY_MAX_DELAY_MS);
      console.log(
        `Tutti i candidati falliti al round ${round + 1}/${RETRY_ROUNDS + 1}, ` +
          `riprovo tra ${Math.round(delay / 1000)}s...`,
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Tutti i candidati (Groq + OpenRouter) hanno fallito dopo ${RETRY_ROUNDS + 1} round. ` +
      `Dettaglio: ${errors.join(" | ").slice(0, 500)}`,
  );
}

// Converte un elenco di hashtag TikTok in keyword di ricerca leggibili in
// un'unica chiamata batch (es. "#torvergata" -> "Tor Vergata"). Lancia in
// caso di errore: il chiamante decide se e come ripiegare (vedi
// hashtagsToKeywordsWithFallback in sync-viral-trends.mjs).
export async function convertHashtagsToKeywords(hashtags, { apiKey, groqApiKey, model } = {}) {
  const messages = [
    {
      role: "system",
      content:
        "Converti hashtag TikTok (spesso in italiano) in keyword di ricerca leggibili in " +
        "linguaggio naturale, utili per cercare lo stesso argomento su Instagram. Esempi: " +
        '"torvergata" -> "Tor Vergata", "lafavolapersempre" -> "La favola per sempre". ' +
        "Rispondi SOLO con un array JSON di oggetti {hashtag, keyword}, senza altro testo, " +
        "senza markdown, senza spiegazioni.",
    },
    { role: "user", content: JSON.stringify(hashtags) },
  ];

  const parse = (text) => {
    try {
      const parsed = JSON.parse(stripJsonFences(text));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const parsed = await chatCompletionWithFallback(messages, { apiKey, groqApiKey, model, parse });

  const byHashtag = new Map(
    parsed.filter((p) => p?.hashtag && p?.keyword).map((p) => [p.hashtag, p.keyword]),
  );
  const missing = hashtags.filter((h) => !byHashtag.has(h));
  if (missing.length > 0) {
    throw new Error(
      `Nessun modello ha convertito tutti gli hashtag (mancanti: ${missing.join(", ")}).`,
    );
  }

  return hashtags.map((hashtag) => ({ hashtag, keyword: byHashtag.get(hashtag) }));
}

// Raggruppa didascalie di post (Canali Inspo) che parlano dello stesso
// argomento specifico, in un'UNICA chiamata batch — cruciale: chiedere
// un'etichetta separata per ogni didascalia rischierebbe di farne uscire
// varianti leggermente diverse per lo stesso argomento (mai uguali carattere
// per carattere), che non si aggancerebbero mai tra loro. Vedendo tutte le
// didascalie insieme, il modello può assegnare la STESSA etichetta a più
// indici direttamente.
//
// Ritorna solo i cluster di 2+ indici — una didascalia senza nessun'altra
// sullo stesso argomento non viene restituita affatto (non è un cluster).
// Il chiamante (discover-canali-inspo-content.mjs) applica poi due controlli
// che il modello da solo non garantisce: che gli indici del cluster
// appartengano davvero a profili diversi (non lo stesso profilo due volte) e
// che le didascalie raggruppate siano davvero simili tra loro (textSimilarity,
// per scartare etichette troppo generiche tipo "Attualità").
export async function clusterCaptionsByTopic(captions, { apiKey, groqApiKey, model } = {}) {
  const messages = [
    {
      role: "system",
      content:
        "Ricevi un elenco numerato di didascalie di post social italiani, ciascuna di un " +
        "profilo diverso. Trova i gruppi di didascalie che parlano chiaramente dello STESSO " +
        "argomento specifico: stesso evento, stessa notizia, stesso trend/sfida/meme, stesso " +
        'prodotto o uscita. NON raggruppare per tema generico (es. "cibo", "vacanze", ' +
        '"moda" non sono un argomento specifico). Per ogni gruppo di 2 o più didascalie sullo ' +
        "stesso argomento, restituisci un'etichetta breve (3-6 parole, in italiano) che descriva " +
        "l'argomento specifico. Ignora completamente le didascalie che non condividono un " +
        "argomento specifico con nessun'altra: non inventare gruppi da un solo elemento. " +
        'Rispondi SOLO con un array JSON [{"topic": "...", "indices": [0, 3, 7]}], senza altro ' +
        "testo, senza markdown, senza spiegazioni. Se non trovi nessun gruppo, rispondi [].",
    },
    {
      role: "user",
      content: JSON.stringify(captions.map((c, i) => ({ index: i, caption: c.slice(0, 400) }))),
    },
  ];

  const parse = (text) => {
    try {
      const parsed = JSON.parse(stripJsonFences(text));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const parsed = await chatCompletionWithFallback(messages, { apiKey, groqApiKey, model, parse });

  return parsed
    .filter((c) => c?.topic && Array.isArray(c.indices) && c.indices.length >= 2)
    .map((c) => ({
      topic: String(c.topic).trim(),
      indices: c.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < captions.length),
    }))
    .filter((c) => c.indices.length >= 2);
}

// Raggruppa etichette di trend provenienti da fonti INDIPENDENTI (TikTok,
// Google Trends, X, Canali Inspo — vedi scripts/match-cross-source-trends.mjs)
// che parlano dello stesso argomento reale, anche se fraseggiate in modo
// completamente diverso da fonte a fonte (es. "Mondiali 2026" su Canali
// Inspo vs "mondiali calcio 2026" su Google Trends): a differenza di
// clusterCaptionsByTopic sopra, qui non c'è nessuna chiave testuale comune
// da sfruttare, serve comprensione semantica. `items` è un array di
// {label, source}; ritorna solo i gruppi di 2+ indici (un'etichetta senza
// corrispondenza altrove non è un gruppo cross-fonte).
export async function matchTopicsAcrossSources(items, { apiKey, groqApiKey, model } = {}) {
  const messages = [
    {
      role: "system",
      content:
        "Ricevi un elenco numerato di etichette di trend/argomenti in tendenza in Italia, " +
        "ciascuna proveniente da una fonte diversa (indicata tra parentesi). Trova i gruppi di " +
        "etichette che si riferiscono chiaramente allo STESSO argomento/evento/persona reale, " +
        "anche se scritte in modo diverso da fonte a fonte (es. abbreviazioni, lingue diverse, " +
        "hashtag vs frase naturale). NON raggruppare argomenti solo genericamente simili (stesso " +
        "settore/categoria ma eventi diversi). Per ogni gruppo di 2 o più etichette sullo stesso " +
        "argomento, restituisci l'etichetta più chiara e leggibile tra quelle del gruppo. Ignora " +
        "completamente le etichette che non condividono l'argomento con nessun'altra: non " +
        'inventare gruppi da un solo elemento. Rispondi SOLO con un array JSON ' +
        '[{"label": "...", "indices": [0, 3, 7]}], senza altro testo, senza markdown, senza ' +
        "spiegazioni. Se non trovi nessun gruppo, rispondi [].",
    },
    {
      role: "user",
      content: JSON.stringify(
        items.map((it, i) => ({ index: i, label: `${it.label} (${it.source})` })),
      ),
    },
  ];

  const parse = (text) => {
    try {
      const parsed = JSON.parse(stripJsonFences(text));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const parsed = await chatCompletionWithFallback(messages, { apiKey, groqApiKey, model, parse });

  return parsed
    .filter((g) => g?.label && Array.isArray(g.indices) && g.indices.length >= 2)
    .map((g) => ({
      label: String(g.label).trim(),
      indices: g.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < items.length),
    }))
    .filter((g) => g.indices.length >= 2);
}
