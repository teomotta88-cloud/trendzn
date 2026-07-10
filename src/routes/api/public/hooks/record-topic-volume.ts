import { createFileRoute } from "@tanstack/react-router";
import { computeTopicGrowth, TOPIC_GROWTH_WINDOW_HOURS } from "@/lib/topicGrowth";

type Body = {
  topicId?: string;
  platform?: "tiktok" | "instagram";
  contentVolume?: number | null;
  isVolumeExact?: boolean;
  totalEngagement?: number | null;
};

// Storico più vecchio della finestra di crescita non serve più (Fase 6, vedi
// src/lib/topicGrowth.ts): un po' di margine oltre le 24h della finestra,
// per non perdere il riferimento se un run salta.
const HISTORY_RETENTION_HOURS = 48;

export const Route = createFileRoute("/api/public/hooks/record-topic-volume")({
  server: {
    handlers: {
      // Uno snapshot in topic_metrics_history per il calcolo del tasso di
      // crescita (Fase 6) — usato da scripts/discover-instagram-hashtag-content.mjs
      // dopo ogni discovery via pagina hashtag (content_volume = numero di
      // reel trovati in questo giro, is_volume_exact=false: è un campione,
      // non il vero totale di Instagram, a differenza di quello di TikTok).
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Body;
          if (!body.topicId || !body.platform) {
            return Response.json(
              { ok: false, error: "topicId e platform richiesti" },
              { status: 400 },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { error } = await supabaseAdmin.from("topic_metrics_history").insert({
            topic_id: body.topicId,
            platform: body.platform,
            content_volume: body.contentVolume ?? null,
            is_volume_exact: body.isVolumeExact ?? false,
            total_engagement: body.totalEngagement ?? null,
          });

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const windowStart = new Date(
            Date.now() - TOPIC_GROWTH_WINDOW_HOURS * 60 * 60 * 1000,
          ).toISOString();

          const { data: oldestRows } = await supabaseAdmin
            .from("topic_metrics_history")
            .select("content_volume, total_engagement, captured_at")
            .eq("topic_id", body.topicId)
            .eq("platform", body.platform)
            .gte("captured_at", windowStart)
            .order("captured_at", { ascending: true })
            .limit(1);

          const growth = computeTopicGrowth({
            currentVolume: body.contentVolume ?? null,
            currentEngagement: body.totalEngagement ?? null,
            oldest: oldestRows?.[0] ?? null,
          });

          await supabaseAdmin
            .from("monitored_topics")
            .update({
              volume_growth_pct: growth.volumeGrowthPct,
              engagement_growth_pct: growth.engagementGrowthPct,
              growth_platform: body.platform,
              growth_computed_at: new Date().toISOString(),
              latest_content_volume: body.contentVolume ?? null,
              latest_total_engagement: body.totalEngagement ?? null,
              latest_is_volume_exact: body.isVolumeExact ?? false,
            })
            .eq("id", body.topicId);

          const retentionStart = new Date(
            Date.now() - HISTORY_RETENTION_HOURS * 60 * 60 * 1000,
          ).toISOString();
          await supabaseAdmin
            .from("topic_metrics_history")
            .delete()
            .lt("captured_at", retentionStart);

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
