import { createFileRoute } from "@tanstack/react-router";
import {
  computeDeltaMetrics,
  computePostVirality,
  VIRALITY_WINDOW_DAYS,
  VIRAL_DELTA_WINDOW_HOURS,
} from "@/lib/virality";

type IncomingUpdate = {
  platform: string;
  external_id: string;
  likes: number;
  comments: number;
};

export const Route = createFileRoute("/api/public/hooks/recheck-viral-engagement")({
  server: {
    handlers: {
      // Riceve gli aggiornamenti raccolti da scripts/recheck-viral-engagement.mjs
      // (browsing pubblico anonimo via Playwright, nessun credit anysite) per
      // contenuti Instagram già presenti in viral_trend_content. Aggiorna
      // engagement con likes+comments, inserisce uno snapshot in
      // viral_trend_metrics_history e ricalcola la viralità del post —
      // stesso meccanismo di sync-viral-trends.ts, stesse regole
      // (src/lib/virality.ts).
      //
      // Nota: engagement qui è likes+comments, senza reshare (non recuperabile
      // da un visitatore anonimo — vedi instagram-public-metrics.mjs). Se il
      // sync precedente aveva captato reshare via anysite, il primo
      // ricontrollo dopo può mostrare un piccolo calo di engagement: è un
      // cambio di fonte, non un vero calo di interazioni. reach non viene
      // toccato: questa fonte non fornisce views.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { updates?: IncomingUpdate[] };
          const updates = Array.isArray(body.updates) ? body.updates : [];

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const windowStart = new Date(
            Date.now() - VIRALITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString();
          const viralWindowStart = new Date(
            Date.now() - VIRAL_DELTA_WINDOW_HOURS * 60 * 60 * 1000,
          ).toISOString();

          let updated = 0;
          for (const u of updates) {
            const { data: rows } = await supabaseAdmin
              .from("viral_trend_content")
              .select("id, reach, published_at, created_at")
              .eq("platform", u.platform)
              .eq("external_id", u.external_id)
              .limit(1);
            const row = rows?.[0];
            if (!row) continue;

            const engagement = u.likes + u.comments;

            await supabaseAdmin.from("viral_trend_metrics_history").insert({
              content_id: row.id,
              engagement,
              reach: row.reach,
            });

            const { data: oldestRows } = await supabaseAdmin
              .from("viral_trend_metrics_history")
              .select("engagement, reach, captured_at")
              .eq("content_id", row.id)
              .gte("captured_at", windowStart)
              .order("captured_at", { ascending: true })
              .limit(1);

            const { data: oldestWithin6hRows } = await supabaseAdmin
              .from("viral_trend_metrics_history")
              .select("engagement, reach, captured_at")
              .eq("content_id", row.id)
              .gte("captured_at", viralWindowStart)
              .order("captured_at", { ascending: true })
              .limit(1);

            const { deltaEngagement, deltaReach } = computeDeltaMetrics({
              engagement,
              reach: row.reach,
              oldest: oldestRows?.[0] ?? null,
            });

            const { isViral, deltaEngagement6h } = computePostVirality({
              engagement,
              oldestWithin6h: oldestWithin6hRows?.[0] ?? null,
            });

            await supabaseAdmin
              .from("viral_trend_content")
              .update({
                engagement,
                delta_engagement: deltaEngagement,
                delta_reach: deltaReach,
                delta_engagement_6h: deltaEngagement6h,
                delta_since: oldestRows?.[0]?.captured_at ?? null,
                is_viral: isViral,
              })
              .eq("id", row.id);

            updated++;
          }

          if (updates.length > 0) {
            await supabaseAdmin
              .from("viral_trend_metrics_history")
              .delete()
              .lt("captured_at", windowStart);
          }

          return Response.json({ ok: true, updated });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
