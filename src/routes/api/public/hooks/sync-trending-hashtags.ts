import { createFileRoute } from "@tanstack/react-router";
import { computeTopicGrowth, TOPIC_GROWTH_WINDOW_HOURS } from "@/lib/topicGrowth";

// Storico più vecchio della finestra di crescita non serve più (Fase 6, vedi
// src/lib/topicGrowth.ts): un po' di margine oltre le 24h della finestra,
// per non perdere il riferimento se un run salta.
const HISTORY_RETENTION_HOURS = 48;

// topic_growth_history (Fase E) tiene un tasso già calcolato per riga —
// molto più leggero di topic_metrics_history, retention più lunga per dare
// margine al backtest del lag cross-fonte in una fase successiva.
const GROWTH_HISTORY_RETENTION_DAYS = 14;

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

              // Tasso di crescita (Fase 6, vedi src/lib/topicGrowth.ts):
              // ricalcolato per ogni topic appena aggiornato, confrontando
              // col volume più vecchio noto nella finestra di 24h.
              const windowStart = new Date(
                Date.now() - TOPIC_GROWTH_WINDOW_HOURS * 60 * 60 * 1000,
              ).toISOString();

              for (const row of historyRows) {
                const { data: oldestRows } = await supabaseAdmin
                  .from("topic_metrics_history")
                  .select("content_volume, total_engagement, captured_at")
                  .eq("topic_id", row.topic_id)
                  .eq("platform", "tiktok")
                  .gte("captured_at", windowStart)
                  .order("captured_at", { ascending: true })
                  .limit(1);

                const growth = computeTopicGrowth({
                  currentVolume: row.content_volume,
                  currentEngagement: row.total_engagement,
                  oldest: oldestRows?.[0] ?? null,
                });

                // Fase 2: il segnale TikTok finisce nella riga (topic, tiktok)
                // di topic_signals invece che sulle colonne singole di
                // monitored_topics — niente più clobbering col segnale
                // Instagram (record-topic-volume.ts).
                const computedAt = new Date().toISOString();
                await supabaseAdmin.from("topic_signals").upsert(
                  {
                    topic_id: row.topic_id,
                    platform: "tiktok" as const,
                    volume_growth_pct: growth.volumeGrowthPct,
                    engagement_growth_pct: growth.engagementGrowthPct,
                    latest_content_volume: row.content_volume,
                    latest_total_engagement: row.total_engagement,
                    is_volume_exact: row.is_volume_exact,
                    computed_at: computedAt,
                  },
                  { onConflict: "topic_id,platform" },
                );

                // Fase E: stesso log append-only di record-topic-volume.ts,
                // per l'accelerazione (vedi src/lib/topicAcceleration.ts).
                await supabaseAdmin.from("topic_growth_history").insert({
                  topic_id: row.topic_id,
                  platform: "tiktok" as const,
                  volume_growth_pct: growth.volumeGrowthPct,
                  engagement_growth_pct: growth.engagementGrowthPct,
                  computed_at: computedAt,
                });
              }
            }

            const retentionStart = new Date(
              Date.now() - HISTORY_RETENTION_HOURS * 60 * 60 * 1000,
            ).toISOString();
            await supabaseAdmin
              .from("topic_metrics_history")
              .delete()
              .lt("captured_at", retentionStart);

            const growthHistoryRetentionStart = new Date(
              Date.now() - GROWTH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString();
            await supabaseAdmin
              .from("topic_growth_history")
              .delete()
              .lt("computed_at", growthHistoryRetentionStart);
          }

          return Response.json({ ok: true, inserted: data?.length ?? 0 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
