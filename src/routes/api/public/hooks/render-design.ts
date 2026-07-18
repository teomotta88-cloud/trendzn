import { createFileRoute } from "@tanstack/react-router";
import { renderDesignToPng, fetchGoogleFontBytes, type DesignElement } from "@/lib/design-render";

// Route di verifica del motore di rendering dell'editor grafico interno
// (Fase 1 del piano: motore isolato, prima di costruire l'editor visuale).
// Prende un albero di elementi "alla template_elements" + valori risolti e
// ritorna il PNG generato — nessuna tabella coinvolta, serve solo a validare
// che satori + resvg-wasm producano un render fedele su questo runtime
// (Cloudflare Workers via Nitro) prima di investire nell'editor UI (Fase 2).

interface RenderDesignBody {
  width?: number;
  height?: number;
  backgroundColor?: string;
  elements?: DesignElement[];
  values?: Record<string, string>;
}

export const Route = createFileRoute("/api/public/hooks/render-design")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as RenderDesignBody;

          const width = body.width ?? 1080;
          const height = body.height ?? 1080;
          const elements = Array.isArray(body.elements) ? body.elements : [];
          const values = body.values ?? {};

          if (elements.length === 0) {
            return Response.json(
              { ok: false, error: "Nessun elemento nel design" },
              { status: 400 },
            );
          }

          // Font unici richiesti dagli elementi testo (default Inter se non
          // specificato) — Fase 3 aggiungerà il set curato self-hostato +
          // font custom caricati, qui basta Google Fonts a runtime per
          // validare il motore.
          const families = new Set<string>();
          for (const el of elements) {
            if (el.tipo === "text") {
              families.add(
                typeof el.style?.fontFamily === "string" ? el.style.fontFamily : "Inter",
              );
            }
          }
          if (families.size === 0) families.add("Inter");

          const fonts = await Promise.all(
            [...families].map(async (name) => ({
              name,
              data: await fetchGoogleFontBytes(name, 400),
              weight: 400,
              style: "normal" as const,
            })),
          );

          const png = await renderDesignToPng({
            width,
            height,
            backgroundColor: body.backgroundColor,
            elements,
            values,
            fonts,
          });

          return new Response(png as unknown as BodyInit, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          console.error("render-design error:", err);
          return Response.json({ ok: false, error: String(err).slice(0, 500) }, { status: 500 });
        }
      },
    },
  },
});
