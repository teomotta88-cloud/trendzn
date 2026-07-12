import { createFileRoute } from "@tanstack/react-router";
import Anthropic from "@anthropic-ai/sdk";

// SBAM AutoGraphics: dal copy visual di un post "photo_card" estrae le keyword
// da usare per la ricerca di una foto stock Getty (vedi getty-search.ts).
// Keyword orientate al VISUAL (soggetti, ambientazione, mood), non alle parole
// astratte del copy — e non allo Human-in-the-loop di approve-job.ts.

// Schema JSON "a mano" invece di un helper zod: evita di legare questa route
// alla versione esatta di zod richiesta dall'SDK (zod/v4), che diverge da
// quella usata altrove nel progetto (v3, per i form react-hook-form).
const KEYWORDS_JSON_SCHEMA = {
  type: "object",
  properties: {
    keywords_en: { type: "array", items: { type: "string" } },
    keywords_it: { type: "array", items: { type: "string" } },
  },
  required: ["keywords_en", "keywords_it"],
  additionalProperties: false,
} as const;

interface KeywordsResult {
  keywords_en: string[];
  keywords_it: string[];
}

function isValidKeywordsResult(value: unknown): value is KeywordsResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const isStringArray = (a: unknown): a is string[] =>
    Array.isArray(a) &&
    a.length >= 3 &&
    a.length <= 5 &&
    a.every((s) => typeof s === "string" && s.trim());
  return isStringArray(v.keywords_en) && isStringArray(v.keywords_it);
}

const SYSTEM_PROMPT = `Sei un assistente che trasforma il copy visual di un post social in keyword per la ricerca di foto stock.
Estrai SOLO elementi visivamente rappresentabili: soggetti concreti, ambientazione, azioni, mood/atmosfera.
NON estrarre parole astratte del copy (slogan, call to action, nomi di prodotto, brand).
Le keyword inglesi devono essere quelle più efficaci per la ricerca su una libreria di stock photography internazionale.
Le keyword italiane sono la stessa lista adattata per un ricercatore che pensa in italiano, non una traduzione letterale parola per parola.
Rispondi SOLO con l'oggetto JSON richiesto: esattamente 3-5 keyword per lingua, senza testo aggiuntivo.`;

async function extractKeywords(client: Anthropic, copy: string): Promise<KeywordsResult | null> {
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: KEYWORDS_JSON_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: copy }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  try {
    const parsed: unknown = JSON.parse(textBlock.text);
    return isValidKeywordsResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            return Response.json(
              { ok: false, error: "ANTHROPIC_API_KEY non configurata" },
              { status: 500 },
            );
          }
          const client = new Anthropic({ apiKey });

          let result = await extractKeywords(client, copy);
          if (!result) {
            // Retry singolo: il modello a volte non rispetta lo schema al primo colpo.
            result = await extractKeywords(client, copy);
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
