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

// Catena di modelli con fallback: i modelli ":free" di OpenRouter vengono
// spesso rate-limitati a monte (429) o ritirati (404), quindi si prova il
// primo e, se non disponibile (429/404/5xx), si passa al successivo. La lista
// mescola provider diversi (Meta, DeepSeek, Google, Qwen, Mistral) così è
// improbabile che siano tutti saturi nello stesso momento; le voci
// eventualmente ritirate (404) vengono semplicemente saltate.
//
// Sovrascrivibile con OPENROUTER_MODEL (uno o più modelli separati da
// virgola). La lista dei modelli gratuiti ruota nel tempo: se troppi finiscono
// 404, aggiorna questa lista da https://openrouter.ai/models?max_price=0.
const DEFAULT_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
];

function getModels(): string[] {
  const env = process.env.OPENROUTER_MODEL;
  if (env) {
    const list = env
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_MODELS;
}

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

// Codici HTTP che rendono sensato passare al modello successivo invece di
// abortire: modello non disponibile (404), rate limit (429), errori provider
// (5xx). Auth (401/403) e richiesta malformata (400) sono invece fatali.
function shouldFallback(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

interface ModelAttempt {
  result: KeywordsResult | null;
  // true = errore transitorio (prova il modello successivo)
  fallback: boolean;
  errorDetail?: string;
}

async function tryModel(apiKey: string, model: string, copy: string): Promise<ModelAttempt> {
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
    const detail = `OpenRouter (${model}) ha risposto ${res.status}: ${body.slice(0, 200)}`;
    if (shouldFallback(res.status)) return { result: null, fallback: true, errorDetail: detail };
    // Errore fatale (auth, bad request): inutile provare altri modelli.
    throw new Error(detail);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text)
    return { result: null, fallback: true, errorDetail: `${model}: risposta senza contenuto` };
  return { result: parseKeywords(text), fallback: false };
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

          const models = getModels();
          const fallbackErrors: string[] = [];

          for (const model of models) {
            // Un retry per modello sul solo caso "JSON non conforme".
            let attempt = await tryModel(apiKey, model, copy);
            if (attempt.result === null && !attempt.fallback) {
              attempt = await tryModel(apiKey, model, copy);
            }
            if (attempt.result) {
              return Response.json({ ok: true, model, ...attempt.result });
            }
            if (attempt.errorDetail) fallbackErrors.push(attempt.errorDetail);
          }

          return Response.json(
            {
              ok: false,
              error:
                "Tutti i modelli gratuiti OpenRouter sono momentaneamente non disponibili " +
                "(rate limit a monte). Riprova tra poco, oppure aggiorna la lista OPENROUTER_MODEL. " +
                "Dettaglio: " +
                fallbackErrors.join(" | ").slice(0, 250),
            },
            { status: 502 },
          );
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
