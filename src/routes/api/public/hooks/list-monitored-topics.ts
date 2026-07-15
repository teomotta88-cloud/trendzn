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

          // Fase 2: i segnali di crescita vivono ora in topic_signals, una
          // riga per (topic, piattaforma) — embeddati qui via la FK
          // topic_id → monitored_topics. Ogni topic torna con l'array
          // `signals` (0, 1 o 2 righe: TikTok e/o Instagram), niente più
          // singolo valore clobberato.
          const { data, error } = await supabaseAdmin
            .from("monitored_topics")
            .select(
              "id, topic_type, value, derived_hashtag, derived_keyword, last_seen_in_top5_at, topic_signals(platform, volume_growth_pct, engagement_growth_pct, latest_content_volume, latest_total_engagement, is_volume_exact, computed_at)",
            )
            .eq("status", "active")
            .limit(500);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          // topic_signals non è ancora nei tipi Supabase generati: la forma è
          // nota e stabile (definita dalla migration), la normalizziamo qui.
          type Row = {
            id: string;
            topic_type: string;
            value: string;
            derived_hashtag: string | null;
            derived_keyword: string | null;
            last_seen_in_top5_at: string;
            topic_signals: unknown[] | null;
          };
          const topics = ((data ?? []) as unknown as Row[]).map((t) => ({
            id: t.id,
            topic_type: t.topic_type,
            value: t.value,
            derived_hashtag: t.derived_hashtag,
            derived_keyword: t.derived_keyword,
            last_seen_in_top5_at: t.last_seen_in_top5_at,
            signals: t.topic_signals ?? [],
          }));

          return Response.json({ ok: true, topics });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
