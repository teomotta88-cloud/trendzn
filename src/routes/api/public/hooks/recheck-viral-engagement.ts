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
  caption?: string | null;
  // Fase F: backfill retroattivo, stesso principio già usato per caption
  // sotto — i post sincronizzati prima che fetchMetricsDetailed estraesse
  // l'audio (vedi instagram-public-metrics.mjs) lo ricevono qui al primo
  // ricontrollo successivo, senza bisogno di nessuna migration di dati.
  audioName?: string | null;
  audioUrl?: string | null;
};

type IncomingDeletion = {
  platform: string;
  external_id: string;
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
      //
      // deletions: il ricontrollo rivisita ogni post Instagram nella finestra
      // di 7gg, quindi è anche il punto giusto per applicare retroattivamente
      // il filtro lingua italiana introdotto in discover-instagram-hashtag-content.mjs
      // (PR #122) — che valeva solo per i contenuti scoperti da quel momento
      // in poi. scripts/recheck-viral-engagement.mjs decide se un post non è
      // italiano (looksItalian sulla didascalia) e lo manda qui per la
      // cancellazione invece che per l'aggiornamento engagement. on delete
      // cascade su viral_trend_metrics_history: nessuna pulizia aggiuntiva
      // necessaria.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            updates?: IncomingUpdate[];
            deletions?: IncomingDeletion[];
          };
          const updates = Array.isArray(body.updates) ? body.updates : [];
          const deletions = Array.isArray(body.deletions) ? body.deletions : [];

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

            const { isViral, deltaSignal6h } = computePostVirality({
              platform: u.platform,
              engagement,
              reach: row.reach,
              oldestWithin6h: oldestWithin6hRows?.[0] ?? null,
            });

            await supabaseAdmin
              .from("viral_trend_content")
              .update({
                engagement,
                delta_engagement: deltaEngagement,
                delta_reach: deltaReach,
                // Solo Instagram passa di qui: il segnale è l'engagement, il
                // valore coincide con la velocità dell'engagement a 6h.
                delta_engagement_6h: deltaSignal6h,
                delta_since: oldestRows?.[0]?.captured_at ?? null,
                is_viral: isViral,
                // Prima di questo ricontrollo il percorso di discovery
                // gratuita via hashtag non salvava mai la didascalia (era
                // sempre null) — la riempie qui, retroattivamente, quando
                // disponibile.
                ...(u.caption ? { content: u.caption } : {}),
                ...(u.audioName ? { audio_name: u.audioName } : {}),
                ...(u.audioUrl ? { audio_url: u.audioUrl } : {}),
                // Fix rotazione list-instagram-content-urls.ts (limite noto
                // ora risolto): senza questo, un post ricontrollato qui non
                // si "sposta in fondo alla coda" e list-instagram-content-urls.ts
                // (ordinata per updated_at crescente) continuerebbe a
                // riproporlo prima di contenuti mai ricontrollati.
                updated_at: new Date().toISOString(),
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

          let deleted = 0;
          for (const d of deletions) {
            const { error, count } = await supabaseAdmin
              .from("viral_trend_content")
              .delete({ count: "exact" })
              .eq("platform", d.platform)
              .eq("external_id", d.external_id);
            if (!error) deleted += count ?? 0;
          }

          return Response.json({ ok: true, updated, deleted });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
