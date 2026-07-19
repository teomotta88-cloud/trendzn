// Due usi di un LLM gratuito su OpenRouter (https://openrouter.ai/api/v1/chat/completions,
// compatibile OpenAI): conversione hashtag -> keyword (risolve nomi propri e
// toponimi che un dizionario offline, scripts/lib/word-segment.mjs, non può
// risolvere, es. "torvergata" -> "Tor Vergata") e raggruppamento di
// didascalie per argomento (Canali Inspo, vedi clusterCaptionsByTopic).
//
// OpenRouter offre modelli con suffisso ":free" a costo zero (nessuna carta
// di credito richiesta per la registrazione), con limite 20 richieste/minuto
// e 50/giorno finché non si sono acquistati almeno 10$ di credito una
// tantum. Il limite è condiviso da TUTTO ciò che usa la stessa chiave in
// questo progetto (conversione hashtag, clustering Canali Inspo, estrazione
// keyword SBAM) — un singolo modello satura spesso (verificato dal vivo: 429
// "temporarily rate-limited upstream" su llama-3.3-70b), quindi entrambe le
// funzioni di questo file provano una LISTA di modelli in sequenza invece di
// uno solo, stesso pattern già in uso in extract-keywords.ts (SBAM).
//
// ATTENZIONE: la lista dei modelli gratuiti ruota nel tempo (alcuni vengono
// ritirati, altri aggiunti) — se troppi finiscono 404, aggiornare
// DEFAULT_MODELS da https://openrouter.ai/models?max_price=0.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
];

// Codici HTTP che rendono sensato passare al modello successivo invece di
// abortire: modello non disponibile (404), rate limit (429), errori
// provider (5xx). Auth (401/403) e richiesta malformata (400) sono fatali,
// riproverebbero con lo stesso esito su ogni modello.
function shouldFallback(status) {
  return status === 404 || status === 429 || status >= 500;
}

// `model` (stringa, anche comma-separated per più modelli) ha priorità se
// passato dal chiamante (es. da OPENROUTER_MODEL nell'ambiente) — altrimenti
// la lista di default.
function resolveModels(model) {
  if (!model) return DEFAULT_MODELS;
  const list = model
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_MODELS;
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

// Quando TUTTI i modelli della lista falliscono (429/404 diffusi sulla free
// tier, capita interi round di monitoraggio), conviene aspettare e
// riprovare l'intera lista invece di arrendersi subito: i rate limit
// gratuiti di OpenRouter sono per-minuto/per-giorno, quindi qualche minuto
// di attesa può bastare a liberare capacità su almeno un modello. Non è un
// retry "a oltranza" vero e proprio (bloccherebbe il job a tempo
// indeterminato) ma un numero di round bounded con backoff, pensato per
// stare ben dentro il timeout-minutes del workflow chiamante.
const RETRY_ROUNDS = parseInt(process.env.OPENROUTER_RETRY_ROUNDS ?? "4", 10);
const RETRY_BASE_DELAY_MS = parseInt(process.env.OPENROUTER_RETRY_BASE_DELAY_MS ?? "20000", 10);
const RETRY_MAX_DELAY_MS = 3 * 60 * 1000;

async function callModel(model, messages, apiKey) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });

  if (!res.ok) {
    const body = await res.text();
    const detail = `OpenRouter (${model}) ha risposto ${res.status}: ${body.slice(0, 200)}`;
    if (shouldFallback(res.status)) return { text: null, errorDetail: detail };
    // Errore fatale (auth, richiesta malformata): inutile provare altri modelli.
    throw new Error(detail);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return { text: null, errorDetail: `${model}: risposta senza contenuto testuale` };
  return { text, errorDetail: null };
}

// Prova una lista di modelli in sequenza, un retry per modello sul solo caso
// "risposta presente ma non nel formato atteso" (parse(text) ritorna null) —
// stesso pattern già in uso in extract-keywords.ts. `parse` non deve
// lanciare: ritorna il risultato o null.
async function chatCompletionWithFallback(messages, { apiKey, model, parse }) {
  const models = resolveModels(model);
  const errors = [];

  for (let round = 0; round <= RETRY_ROUNDS; round++) {
    for (const m of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { text, errorDetail } = await callModel(m, messages, apiKey);
        if (errorDetail) {
          errors.push(`round ${round + 1}: ${errorDetail}`);
          break; // errore di trasporto/rate-limit: non ha senso ritentare lo stesso modello
        }
        const parsed = parse(text);
        if (parsed !== null) return parsed;
        errors.push(`round ${round + 1}: ${m}: risposta non nel formato atteso (tentativo ${attempt + 1})`);
      }
    }

    if (round < RETRY_ROUNDS) {
      const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** round, RETRY_MAX_DELAY_MS);
      console.log(
        `OpenRouter: tutti i modelli falliti al round ${round + 1}/${RETRY_ROUNDS + 1}, ` +
          `riprovo tra ${Math.round(delay / 1000)}s...`,
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Tutti i modelli OpenRouter hanno fallito dopo ${RETRY_ROUNDS + 1} round. ` +
      `Dettaglio: ${errors.join(" | ").slice(0, 500)}`,
  );
}

// Converte un elenco di hashtag TikTok in keyword di ricerca leggibili in
// un'unica chiamata batch (es. "#torvergata" -> "Tor Vergata"). Lancia in
// caso di errore: il chiamante decide se e come ripiegare (vedi
// hashtagsToKeywordsWithFallback in sync-viral-trends.mjs).
export async function convertHashtagsToKeywords(hashtags, { apiKey, model } = {}) {
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

  const parsed = await chatCompletionWithFallback(messages, { apiKey, model, parse });

  const byHashtag = new Map(
    parsed.filter((p) => p?.hashtag && p?.keyword).map((p) => [p.hashtag, p.keyword]),
  );
  const missing = hashtags.filter((h) => !byHashtag.has(h));
  if (missing.length > 0) {
    throw new Error(
      `OpenRouter non ha convertito tutti gli hashtag (mancanti: ${missing.join(", ")}).`,
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
export async function clusterCaptionsByTopic(captions, { apiKey, model } = {}) {
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

  const parsed = await chatCompletionWithFallback(messages, { apiKey, model, parse });

  return parsed
    .filter((c) => c?.topic && Array.isArray(c.indices) && c.indices.length >= 2)
    .map((c) => ({
      topic: String(c.topic).trim(),
      indices: c.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < captions.length),
    }))
    .filter((c) => c.indices.length >= 2);
}
