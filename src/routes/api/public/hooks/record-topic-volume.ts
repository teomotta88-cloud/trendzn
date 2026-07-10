import { createFileRoute } from "@tanstack/react-router";

type Body = {
  topicId?: string;
  platform?: "tiktok" | "instagram";
  contentVolume?: number | null;
  isVolumeExact?: boolean;
  totalEngagement?: number | null;
};

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

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
