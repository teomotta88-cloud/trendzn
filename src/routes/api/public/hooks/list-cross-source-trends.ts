import { createFileRoute } from "@tanstack/react-router";

/**
 * Gruppi di trend rilevati su più fonti (vedi
 * supabase/migrations/20260720100000_cross_source_trends.sql e
 * scripts/match-cross-source-trends.mjs). La tabella è ricalcolata per
 * intero ad ogni run dello script di matching: qui restituiamo sempre tutte
 * le righe correnti, senza filtri di freschezza (lo score/tier riflette già
 * "quanto è condiviso" il trend al momento del calcolo).
 */
export const Route = createFileRoute("/api/public/hooks/list-cross-source-trends")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin
            .from("cross_source_trends")
            .select(
              "id, label, source_count, tier, sources, topic_ids, canali_inspo_topic, computed_at",
            )
            .order("source_count", { ascending: false })
            .limit(200);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, trends: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
