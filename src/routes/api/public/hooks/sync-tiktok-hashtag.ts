import { createFileRoute } from "@tanstack/react-router";

const SECTION = "tiktok-hashtag";
const CATEGORY = "TikTok Hashtag";

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/[).,;]+$/, "").trim();
  }
}

// Gli ID dei video TikTok sono "snowflake": i 32 bit più significativi
// codificano il timestamp Unix (in secondi) di creazione del post.
function decodePostedAt(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  if (!match) return null;
  try {
    const id = BigInt(match[1]);
    const seconds = Number(id >> 32n);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-tiktok-hashtag")({
  server: {
    handlers: {
      // Riceve gli URL trovati dallo scraper GitHub Actions (scripts/sync-tiktok-hashtag.mjs)
      // e li inserisce in trend_submissions usando supabaseAdmin, che gira solo lato server
      // e ha quindi accesso alla service role key senza che lo script esterno la conosca.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { urls?: string[]; hashtag?: string };
          const urls = Array.isArray(body.urls) ? body.urls : [];
          const hashtag = body.hashtag?.trim() || "starhotels";

          if (urls.length === 0) {
            return Response.json({ ok: true, inserted: 0 });
          }

          // Tutte le righe di uno stesso batch condividerebbero lo stesso now() di default
          // (now() è stabile per transazione in Postgres). created_at resta utile come data
          // di inserimento, ma l'ordinamento della pagina usa posted_at (data reale del post,
          // decodificata dall'ID del video).
          const now = Date.now();
          const rows = urls.map((url, index) => ({
            url: normalizeUrl(url),
            section: SECTION,
            category: CATEGORY,
            tags: [hashtag],
            status: "approved" as const,
            submitted_by: "tiktok-hashtag-scraper",
            created_at: new Date(now - index).toISOString(),
            posted_at: decodePostedAt(url),
          }));

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // onConflict + ignoreDuplicates richiede il vincolo UNIQUE su trend_submissions.url
          // (vedi migration 20260619120000_unique_url_trend_submissions.sql)
          const { data, error } = await supabaseAdmin
            .from("trend_submissions")
            .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
            .select("id");

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, inserted: data?.length ?? 0 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
