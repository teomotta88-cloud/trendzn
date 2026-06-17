import { createFileRoute } from "@tanstack/react-router";

/**
 * Estrae i meta tag Open Graph da una pagina pubblica (es. LinkedIn).
 * Necessario lato server per evitare errori CORS dal browser.
 */

function extractMeta(html: string, property: string): string | null {
  // Cerca sia property="og:xxx" che name="og:xxx", in entrambi gli ordini di attributi
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export const Route = createFileRoute("/api/public/hooks/link-preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url).searchParams.get("url");
          if (!url) {
            return Response.json({ ok: false, error: "url mancante" }, { status: 400 });
          }

          // Limita ai domini supportati per evitare abusi come proxy generico
          const allowedDomains = ["linkedin.com", "www.linkedin.com"];
          const parsed = new URL(url);
          if (!allowedDomains.includes(parsed.hostname)) {
            return Response.json({ ok: false, error: "dominio non supportato" }, { status: 400 });
          }

          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)",
            },
          });

          if (!res.ok) {
            return Response.json({ ok: false, error: `fetch_failed_${res.status}` }, { status: 500 });
          }

          const html = await res.text();

          const title = extractMeta(html, "og:title");
          const description = extractMeta(html, "og:description");
          const image = extractMeta(html, "og:image");
          const siteName = extractMeta(html, "og:site_name");

          return Response.json({
            ok: true,
            title,
            description,
            image,
            siteName,
          });
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
