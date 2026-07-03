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

          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);

          if (!res.ok) {
            return Response.json(
              { ok: false, error: `fetch_failed_${res.status}` },
              { status: 502 },
            );
          }

          const data = await res.json();

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
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
