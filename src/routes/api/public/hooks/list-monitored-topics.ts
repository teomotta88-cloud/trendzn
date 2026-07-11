import { createFileRoute } from "@tanstack/react-router";

/**
 * Elenco dei topic attualmente monitorati (status='active', vedi
 * monitor-topics.ts). Due usi con esigenze diverse sullo stesso status
 * 'active':
 * - scripts/discover-instagram-hashtag-content.mjs: vuole TUTTI gli active,
 *   compresi quelli nel periodo di grazia (usciti dai top-N ma ancora
 *   monitorati per altre 24h) — la raccolta volumi/engagement continua lì.
 * - pagina /trend-virali (Fase 8): vuole mostrare solo i topic DAVVERO in
 *   classifica adesso, non quelli in periodo di grazia — per questo il
 *   filtro sulla freschezza di last_seen_in_top5_at (vedi isCurrentlyRanked
 *   in src/lib/monitoredTopics.ts) è lasciato al client invece che qui: qui
 *   si restituiscono sempre tutti gli active, last_seen_in_top5_at incluso.
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
              "id, topic_type, value, derived_hashtag, derived_keyword, volume_growth_pct, engagement_growth_pct, growth_platform, growth_computed_at, latest_content_volume, latest_total_engagement, latest_is_volume_exact, last_seen_in_top5_at",
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
