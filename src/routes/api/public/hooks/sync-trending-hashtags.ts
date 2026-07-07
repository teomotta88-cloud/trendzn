import { createFileRoute } from "@tanstack/react-router";

type IncomingHashtag = {
  hashtag: string;
  rank: number | null;
  category: string[];
  postCount: number | null;
  viewCount: number | null;
  trend: number[] | null;
  raw?: unknown;
};

export const Route = createFileRoute("/api/public/hooks/sync-trending-hashtags")({
  server: {
    handlers: {
      // Riceve la classifica hashtag di TikTok Creative Center dallo script
      // GitHub Actions (scripts/discover-trending-hashtags.mjs) e sostituisce
      // l'istantanea precedente per region+periodDays: la tabella mostra
      // sempre l'ultima rilevazione, non uno storico cumulativo.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            region?: string;
            periodDays?: number;
            items?: IncomingHashtag[];
          };

          const region = body.region?.trim() || "IT";
          const periodDays = body.periodDays ?? 7;
          const items = Array.isArray(body.items) ? body.items : [];

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { error: deleteError } = await supabaseAdmin
            .from("tiktok_trending_hashtags")
            .delete()
            .eq("region", region)
            .eq("period_days", periodDays);

          if (deleteError) {
            return Response.json({ ok: false, error: deleteError.message }, { status: 500 });
          }

          if (items.length === 0) {
            return Response.json({ ok: true, inserted: 0 });
          }

          const rows = items.map((item) => ({
            hashtag: item.hashtag,
            rank: item.rank,
            category: item.category ?? [],
            post_count: item.postCount,
            view_count: item.viewCount,
            trend_points: item.trend,
            region,
            period_days: periodDays,
            raw: item.raw ?? null,
          }));

          const { data, error } = await supabaseAdmin
            .from("tiktok_trending_hashtags")
            .insert(rows)
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
