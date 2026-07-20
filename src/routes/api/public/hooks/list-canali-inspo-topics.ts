import { createFileRoute } from "@tanstack/react-router";

const WINDOW_DAYS = 7;

/**
 * Etichette dei trend cross-profilo Canali Inspo attualmente attivi (post
 * pubblicati negli ultimi WINDOW_DAYS giorni, stessa finestra di
 * VIRALITY_WINDOW_DAYS in src/lib/virality.ts) — usato da
 * scripts/match-cross-source-trends.mjs per abbinarli ai topic delle altre
 * fonti. Una riga per etichetta distinta, con il numero massimo di canali
 * visto (channel_count non cambia tra i post di uno stesso cluster, ma
 * prendiamo il massimo per sicurezza) e quanti post la compongono.
 */
export const Route = createFileRoute("/api/public/hooks/list-canali-inspo-topics")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const since = new Date();
          since.setDate(since.getDate() - WINDOW_DAYS);

          const { data, error } = await supabaseAdmin
            .from("viral_trend_content")
            .select("cross_profile_topic, cross_profile_channel_count, published_at, created_at")
            .eq("discovery_source", "canali-inspo")
            .not("cross_profile_topic", "is", null)
            .or(
              `published_at.gte.${since.toISOString()},and(published_at.is.null,created_at.gte.${since.toISOString()})`,
            )
            .limit(1000);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const byTopic = new Map<string, { channelCount: number; postCount: number }>();
          for (const row of data ?? []) {
            const topic = row.cross_profile_topic;
            if (!topic) continue;
            const existing = byTopic.get(topic);
            const channelCount = row.cross_profile_channel_count ?? 0;
            if (existing) {
              existing.postCount += 1;
              existing.channelCount = Math.max(existing.channelCount, channelCount);
            } else {
              byTopic.set(topic, { channelCount, postCount: 1 });
            }
          }

          const topics = Array.from(byTopic.entries()).map(([topic, stats]) => ({
            topic,
            channelCount: stats.channelCount,
            postCount: stats.postCount,
          }));

          return Response.json({ ok: true, topics });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
