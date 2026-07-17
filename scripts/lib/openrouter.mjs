// Conversione hashtag -> keyword tramite un LLM gratuito su OpenRouter
// (https://openrouter.ai/api/v1/chat/completions, compatibile OpenAI),
// invece del segmentatore offline a dizionario (scripts/lib/word-segment.mjs)
// — risolve i casi che un dizionario non può risolvere (nomi propri,
// toponimi, es. "torvergata" -> "Tor Vergata").
//
// OpenRouter offre modelli con suffisso ":free" a costo zero (nessuna carta
// di credito richiesta per la registrazione), con limite 20 richieste/minuto
// e 50/giorno finché non si sono acquistati almeno 10$ di credito una
// tantum — per il nostro uso (una chiamata batch al giorno) è abbondante.
//
// ATTENZIONE: la lista dei modelli gratuiti ruota nel tempo (alcuni vengono
// ritirati, altri aggiunti) — se OPENROUTER_MODEL smette di funzionare,
// verificare i modelli disponibili su https://openrouter.ai/models?max_price=0
// e aggiornare il default o la variabile d'ambiente.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

// Converte un elenco di hashtag TikTok in keyword di ricerca leggibili in
// un'unica chiamata batch (es. "#torvergata" -> "Tor Vergata"). Lancia in
// caso di errore: il chiamante decide se e come ripiegare (vedi
// hashtagsToKeywordsWithFallback in sync-viral-trends.mjs).
export async function convertHashtagsToKeywords(hashtags, { apiKey, model = DEFAULT_MODEL } = {}) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
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
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Risposta OpenRouter senza contenuto testuale.");

  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Risposta OpenRouter non è un array JSON.");

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
export async function clusterCaptionsByTopic(captions, { apiKey, model = DEFAULT_MODEL } = {}) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
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
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Risposta OpenRouter senza contenuto testuale.");

  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Risposta OpenRouter non è un array JSON.");

  return parsed
    .filter((c) => c?.topic && Array.isArray(c.indices) && c.indices.length >= 2)
    .map((c) => ({
      topic: String(c.topic).trim(),
      indices: c.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < captions.length),
    }))
    .filter((c) => c.indices.length >= 2);
}
