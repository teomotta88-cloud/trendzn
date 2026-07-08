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
