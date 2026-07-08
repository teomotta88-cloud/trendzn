import { createFileRoute } from "@tanstack/react-router";

/**
 * Restituisce gli URL dei video TikTok reali già raccolti per un hashtag
 * dalla pipeline "TikTok Trending IT" (section=tiktok-hashtag di
 * trend_submissions), con le views se estratte durante lo scraping (best
 * effort, vedi scripts/scrape-tiktok-hashtag.mjs — può essere null).
 * Usato da sync-viral-trends.mjs per includere contenuti TikTok nel feed
 * "Trend Virali": anysite non supporta la ricerca TikTok, e per questa
 * fonte non c'è comunque nessun dato di engagement (like/commenti), solo
 * le views.
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
            .select("url, posted_at, created_at, view_count")
            .eq("section", "tiktok-hashtag")
            .eq("status", "approved")
            .contains("tags", [hashtag])
            .order("view_count", { ascending: false, nullsFirst: false })
            .order("posted_at", { ascending: false, nullsFirst: false })
            .limit(limit);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const posts = (data ?? []).map((row) => ({
            url: row.url,
            publishedAt: row.posted_at ?? row.created_at,
            views: row.view_count ?? null,
          }));

          return Response.json({ ok: true, posts });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
