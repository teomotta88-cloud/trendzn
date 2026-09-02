import { createFileRoute } from "@tanstack/react-router";

/**
 * Proxy verso l'oEmbed pubblico di TikTok: restituisce solo thumbnail/title/author,
 * così il client può mostrare un frame di anteprima statico senza montare
 * l'iframe pesante (che TikTok fa partire in autoplay muto non appena caricato).
 */

export const Route = createFileRoute("/api/public/hooks/tiktok-oembed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url).searchParams.get("url");
          if (!url) {
            return Response.json({ ok: false, error: "url mancante" }, { status: 400 });
          }

          const allowedDomains = ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "m.tiktok.com"];
          const parsed = new URL(url);
          if (!allowedDomains.includes(parsed.hostname)) {
            return Response.json({ ok: false, error: "dominio non supportato" }, { status: 400 });
          }

          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });

          // TikTok risponde 400/403 per video rimossi, privati o rate limit:
          // non è un errore dell'app, quindi rispondiamo 200 con ok:false e il
          // client si limita a non mostrare l'anteprima (prima il 502 faceva
          // scattare l'error boundary e schermata bianca).
          if (!res.ok) {
            return Response.json(
              { ok: false, error: `fetch_failed_${res.status}` },
              { headers: { "Cache-Control": "public, max-age=3600" } },
            );
          }

          const data = (await res.json()) as Record<string, unknown>;

          return Response.json(
            {
              ok: true,
              thumbnail: data.thumbnail_url ?? null,
              title: data.title ?? null,
              author: data.author_name ?? null,
            },
            { headers: { "Cache-Control": "public, max-age=86400" } },
          );
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 200) },
            { headers: { "Cache-Control": "public, max-age=300" } },
          );
        }
      },
    },
  },
});
