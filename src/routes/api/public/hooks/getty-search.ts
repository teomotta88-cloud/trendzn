import { createFileRoute } from "@tanstack/react-router";

// SBAM AutoGraphics: ricerca foto Getty Images SENZA API key (non ancora
// configurata) e SENZA download dell'asset licenziato. Interroga la pagina
// pubblica di ricerca di gettyimages.com (gli stessi risultati/bozzetti
// watermarked visibili navigando il sito da browser) ed estrae i primi
// candidati. Il preview_url restituito è il bozzetto watermarked: è QUESTO,
// non un asset licenziato, che finisce nel template Figma finché non viene
// attivato un abbonamento/API key Getty con relativo flusso di download.
//
// ATTENZIONE: la struttura HTML di gettyimages.com non è stabile e non è
// un contratto pubblico — se in produzione questa funzione inizia a
// restituire 0 candidati, molto probabilmente il markup è cambiato e va
// aggiornata la logica di estrazione qui sotto (vedi i due tentativi:
// JSON-LD prima, poi fallback su tag <img>).

interface GettyCandidateResult {
  asset_id: string;
  preview_url: string;
  title: string | null;
  orientamento: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Mappa i formati grafici di rubrica_formati/graphic_job_formats
// sull'orientamento accettato dal filtro di ricerca Getty.
function formatoToOrientation(formato: string | undefined): string | undefined {
  if (!formato) return undefined;
  const f = formato.toLowerCase();
  if (f.includes("square") || f.includes("1x1") || f.includes("1_1")) return "square";
  if (f.includes("portrait") || f.includes("story") || f.includes("4x5") || f.includes("9x16"))
    return "vertical";
  if (f.includes("landscape") || f.includes("16x9")) return "horizontal";
  return undefined;
}

// Getty numera gli asset con ID tipo "gm1234567890" o puramente numerici
// a 9+ cifre nei permalink /detail/photo/.../id/<id>.
const ASSET_ID_PATTERN = /(?:gm|dv)?\d{9,}/i;

function extractAssetIdFromUrl(url: string): string | null {
  const match = url.match(ASSET_ID_PATTERN);
  return match ? match[0] : null;
}

// Tentativo 1: molti siti media incorporano JSON-LD (schema.org ItemList /
// ImageGallery) per la SEO — è il modo più stabile di leggere i risultati
// senza eseguire JS.
function extractFromJsonLd(html: string): GettyCandidateResult[] {
  const results: GettyCandidateResult[] = [];
  const scriptMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scriptMatches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const items = (node as Record<string, unknown>).itemListElement;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const image = (item as Record<string, unknown>)?.image ?? item;
        if (!image || typeof image !== "object") continue;
        const img = image as Record<string, unknown>;
        const previewUrl =
          (typeof img.contentUrl === "string" && img.contentUrl) ||
          (typeof img.thumbnailUrl === "string" && img.thumbnailUrl) ||
          (typeof img.url === "string" && img.url);
        if (!previewUrl) continue;
        const detailUrl = (typeof img.url === "string" && img.url) || previewUrl;
        const assetId = extractAssetIdFromUrl(detailUrl) ?? extractAssetIdFromUrl(previewUrl);
        if (!assetId) continue;
        results.push({
          asset_id: assetId,
          preview_url: previewUrl,
          title: typeof img.name === "string" ? img.name : null,
          orientamento: null,
        });
      }
    }
  }
  return results;
}

// Tentativo 2 (fallback): estrae direttamente i tag <img> del markup dei
// risultati, filtrando sul dominio CDN media.gettyimages.com.
function extractFromImgTags(html: string): GettyCandidateResult[] {
  const results: GettyCandidateResult[] = [];
  const seen = new Set<string>();
  const imgMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const match of imgMatches) {
    const src = match[1];
    if (!src.includes("media.gettyimages.com")) continue;
    const assetId = extractAssetIdFromUrl(src);
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    results.push({
      asset_id: assetId,
      preview_url: src,
      title: altMatch ? altMatch[1] : null,
      orientamento: null,
    });
  }
  return results;
}

async function scrapeGettySearch(
  query: string,
  orientation: string | undefined,
): Promise<{ candidates: GettyCandidateResult[]; diagnostic: string }> {
  const url = new URL("https://www.gettyimages.com/search/2/image");
  url.searchParams.set("phrase", query);
  url.searchParams.set("assettype", "image");
  url.searchParams.set("graphicalstyle", "photography");
  if (orientation) url.searchParams.set("orientations", orientation);

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Getty ha risposto ${res.status} per la query "${query}"`);
  }
  const html = await res.text();

  let candidates = extractFromJsonLd(html);
  let diagnostic = `json-ld: ${candidates.length}`;
  if (candidates.length === 0) {
    candidates = extractFromImgTags(html);
    diagnostic += `, img-fallback: ${candidates.length}`;
  }
  if (orientation) {
    candidates = candidates.map((c) => ({ ...c, orientamento: orientation }));
  }
  return { candidates, diagnostic: `${diagnostic}, html-length: ${html.length}` };
}

export const Route = createFileRoute("/api/public/hooks/getty-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            keywords?: string[];
            formato?: string;
          };
          const keywords = (body.keywords ?? []).map((k) => k.trim()).filter(Boolean);
          if (keywords.length === 0) {
            return Response.json({ ok: false, error: "keywords è obbligatorio" }, { status: 400 });
          }

          const orientation = formatoToOrientation(body.formato);
          const query = keywords.slice(0, 5).join(" ");

          const { candidates, diagnostic } = await scrapeGettySearch(query, orientation);

          if (candidates.length === 0) {
            return Response.json(
              {
                ok: false,
                error: `Nessun candidato Getty trovato per "${query}" (diagnostica: ${diagnostic}). La struttura della pagina di ricerca Getty potrebbe essere cambiata: vedi il commento in getty-search.ts.`,
              },
              { status: 502 },
            );
          }

          return Response.json({ ok: true, candidates: candidates.slice(0, 6), query });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
