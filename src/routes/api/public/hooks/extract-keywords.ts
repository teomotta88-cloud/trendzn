import { createFileRoute } from "@tanstack/react-router";

// SBAM AutoGraphics: dal copy visual di un post "photo_card" estrae le keyword
// da usare per la ricerca di una foto stock Getty (vedi getty-search.ts).
// Keyword orientate al VISUAL (soggetti, ambientazione, mood), non alle parole
// astratte del copy.
//
// Usa OpenRouter (API OpenAI-compatibile) invece dell'SDK Anthropic, per
// coerenza col resto del progetto che già passa da OpenRouter per la
// conversione hashtag->keyword (scripts/lib/openrouter.mjs). La API key va
// nell'ambiente di deploy dell'app (secret runtime, es. Lovable/Cloudflare),
// letta da process.env.OPENROUTER_API_KEY — NON è la stessa cosa dei secret
// di GitHub Actions, che alimentano solo i workflow degli scraper.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// La lista dei modelli ":free" su OpenRouter ruota nel tempo: se questo
// smette di funzionare, imposta OPENROUTER_MODEL nell'ambiente o aggiorna il
// default (vedi https://openrouter.ai/models?max_price=0).
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

interface KeywordsResult {
  keywords_en: string[];
  keywords_it: string[];
}

const SYSTEM_PROMPT = `Sei un assistente che trasforma il copy visual di un post social in keyword per la ricerca di foto stock.
Estrai SOLO elementi visivamente rappresentabili: soggetti concreti, ambientazione, azioni, mood/atmosfera.
NON estrarre parole astratte del copy (slogan, call to action, nomi di prodotto, brand).
Le keyword inglesi devono essere quelle più efficaci per la ricerca su una libreria di stock photography internazionale.
Le keyword italiane sono la stessa lista adattata per un ricercatore che pensa in italiano, non una traduzione letterale parola per parola.
Rispondi SOLO con un oggetto JSON in questo formato esatto, senza markdown, senza spiegazioni:
{"keywords_en": ["...", "..."], "keywords_it": ["...", "..."]}
Esattamente 3-5 keyword per ciascuna lingua.`;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 5 &&
    value.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

function parseKeywords(raw: string): KeywordsResult | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (isStringArray(obj.keywords_en) && isStringArray(obj.keywords_it)) {
      return { keywords_en: obj.keywords_en, keywords_it: obj.keywords_it };
    }
    return null;
  } catch {
    return null;
  }
}

async function extractKeywords(
  apiKey: string,
  model: string,
  copy: string,
): Promise<KeywordsResult | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: copy },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ha risposto ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;
  return parseKeywords(text);
}

export const Route = createFileRoute("/api/public/hooks/extract-keywords")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { copy?: string };
          const copy = body.copy?.trim();
          if (!copy) {
            return Response.json({ ok: false, error: "copy è obbligatorio" }, { status: 400 });
          }

          const apiKey = process.env.OPENROUTER_API_KEY;
          if (!apiKey) {
            return Response.json(
              { ok: false, error: "OPENROUTER_API_KEY non configurata nell'ambiente dell'app" },
              { status: 500 },
            );
          }
          const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

          let result = await extractKeywords(apiKey, model, copy);
          if (!result) {
            // Retry singolo: i modelli free a volte non rispettano il formato.
            result = await extractKeywords(apiKey, model, copy);
          }
          if (!result) {
            return Response.json(
              { ok: false, error: "Il modello non ha restituito keyword valide" },
              { status: 502 },
            );
          }

          return Response.json({ ok: true, ...result });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
