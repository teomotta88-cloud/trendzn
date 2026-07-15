import { createFileRoute } from "@tanstack/react-router";
import { computeTopicGrowth, TOPIC_GROWTH_WINDOW_HOURS } from "@/lib/topicGrowth";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";

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
      // dopo ogni discovery via pagina hashtag.
      //
      // Per Instagram NON ci si fida del content_volume/total_engagement
      // calcolati dallo script sul singolo scrape: la pagina hashtag può
      // riordinare quali post mostra tra un giro e l'altro (fino a 100 per
      // run, ma non garantito che siano "gli stessi + eventuali nuovi"), e
      // un delta ha senso solo se confronta una base di contenuti stabile
      // nel tempo. Qui si ricalcola invece l'aggregato da TUTTO ciò che
      // conosciamo per questo topic in viral_trend_content (accumulato via
      // upsert da ogni discovery, tenuto aggiornato da
      // recheck-viral-engagement.mjs ogni 6h, stessa finestra di recency del
      // feed) — cresce solo quando arriva un post nuovo, cambia solo quando
      // l'engagement di un post noto cambia davvero, si riduce solo quando
      // un post esce dalla finestra di 7gg: mai per un caso di scraping.
      // TikTok invece resta come inviato dal chiamante: postCount di
      // Creative Center è già un conteggio reale sull'intero hashtag
      // (is_volume_exact true), non derivato da una nostra tabella parziale.
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

          let contentVolume = body.contentVolume ?? null;
          let totalEngagement = body.totalEngagement ?? null;

          if (body.platform === "instagram") {
            const since = new Date();
            since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
            const sinceIso = since.toISOString();

            const { data: contentRows, error: aggError } = await supabaseAdmin
              .from("viral_trend_content")
              .select("engagement")
              .eq("topic_id", body.topicId)
              .eq("platform", "instagram")
              .or(
                `published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`,
              );

            // Se l'aggregazione fallisce, ripiega sul numero inviato dallo
            // script piuttosto che bloccare la registrazione dello snapshot.
            if (!aggError && contentRows) {
              contentVolume = contentRows.length;
              totalEngagement = contentRows.reduce((sum, r) => sum + (r.engagement ?? 0), 0);
            }
          }

          const { error } = await supabaseAdmin.from("topic_metrics_history").insert({
            topic_id: body.topicId,
            platform: body.platform,
            content_volume: contentVolume,
            is_volume_exact: body.isVolumeExact ?? false,
            total_engagement: totalEngagement,
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
            currentVolume: contentVolume,
            currentEngagement: totalEngagement,
            oldest: oldestRows?.[0] ?? null,
          });

          // Fase 2: il segnale finisce nella riga (topic, instagram) di
          // topic_signals invece che sulle colonne singole di monitored_topics
          // — così non sovrascrive più il segnale TikTok e viceversa.
          await supabaseAdmin.from("topic_signals").upsert(
            {
              topic_id: body.topicId,
              platform: body.platform,
              volume_growth_pct: growth.volumeGrowthPct,
              engagement_growth_pct: growth.engagementGrowthPct,
              latest_content_volume: contentVolume,
              latest_total_engagement: totalEngagement,
              is_volume_exact: body.isVolumeExact ?? false,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "topic_id,platform" },
          );

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
