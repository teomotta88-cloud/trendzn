import { createFileRoute } from "@tanstack/react-router";

/**
 * Restituisce gli URL dei video TikTok reali già raccolti per un hashtag
 * dalla pipeline "TikTok Trending IT" (section=tiktok-hashtag di
 * trend_submissions). Usato da sync-viral-trends.mjs per includere contenuti
 * TikTok nel feed "Trend Virali" — anysite non supporta la ricerca TikTok,
 * quindi qui non ci sono view/engagement (solo l'URL e la data del post),
 * a differenza degli altri contenuti trovati via anysite.
 */

const DEFAULT_LIMIT = 10;

export const Route = createFileRoute("/api/public/hooks/tiktok-hashtag-posts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const params = new URL(request.url).searchParams;
          const hashtag = params.get("hashtag")?.trim();
          if (!hashtag) {
            return Response.json({ ok: false, error: "hashtag mancante" }, { status: 400 });
          }
          const limit = Math.min(
            Math.max(parseInt(params.get("limit") ?? "", 10) || DEFAULT_LIMIT, 1),
            50,
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin
            .from("trend_submissions")
            .select("url, posted_at, created_at")
            .eq("section", "tiktok-hashtag")
            .eq("status", "approved")
            .contains("tags", [hashtag])
            .order("posted_at", { ascending: false, nullsFirst: false })
            .limit(limit);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const posts = (data ?? []).map((row) => ({
            url: row.url,
            publishedAt: row.posted_at ?? row.created_at,
          }));

          return Response.json({ ok: true, posts });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
