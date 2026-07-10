import { createFileRoute } from "@tanstack/react-router";

/**
 * Elenco dei topic attualmente monitorati (status='active', vedi
 * monitor-topics.ts). Due usi:
 * - scripts/discover-instagram-hashtag-content.mjs: quali hashtag/keyword
 *   provare con la discovery gratuita via pagina hashtag Instagram.
 * - pagina /trend-virali (Fase 8): elenco hashtag TikTok / keyword Google
 *   Trends con il tasso di crescita (volume_growth_pct/engagement_growth_pct,
 *   vedi src/lib/topicGrowth.ts).
 */
export const Route = createFileRoute("/api/public/hooks/list-monitored-topics")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin
            .from("monitored_topics")
            .select(
              "id, topic_type, value, derived_hashtag, derived_keyword, volume_growth_pct, engagement_growth_pct, growth_platform, growth_computed_at, latest_content_volume, latest_total_engagement, latest_is_volume_exact",
            )
            .eq("status", "active")
            .limit(500);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, topics: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
