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

          // Storico volumi per il calcolo del tasso di crescita (Fase 6):
          // solo per gli hashtag già monitorati (monitored_topics, popolata
          // da sync-viral-trends.mjs) — se un hashtag non è ancora
          // monitorato al momento di questo run, semplicemente non ha
          // storico per questo giro, si autocorregge al prossimo. postCount
          // di TikTok Creative Center è un conteggio reale (is_volume_exact
          // true), a differenza del "volume" solo campionato di Instagram.
          const hashtagsWithVolume = items.filter((item) => item.postCount != null);
          if (hashtagsWithVolume.length > 0) {
            const { data: topics } = await supabaseAdmin
              .from("monitored_topics")
              .select("id, value")
              .eq("topic_type", "tiktok-hashtag")
              .in(
                "value",
                hashtagsWithVolume.map((item) => item.hashtag),
              );

            const topicIdByHashtag = new Map((topics ?? []).map((t) => [t.value, t.id]));
            const historyRows = hashtagsWithVolume
              .map((item) => {
                const topicId = topicIdByHashtag.get(item.hashtag);
                if (!topicId) return null;
                return {
                  topic_id: topicId,
                  platform: "tiktok" as const,
                  content_volume: item.postCount,
                  is_volume_exact: true,
                  total_engagement: null,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);

            if (historyRows.length > 0) {
              await supabaseAdmin.from("topic_metrics_history").insert(historyRows);
            }
          }

          return Response.json({ ok: true, inserted: data?.length ?? 0 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
