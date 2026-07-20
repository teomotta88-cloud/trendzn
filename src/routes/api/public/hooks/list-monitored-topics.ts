import { createFileRoute } from "@tanstack/react-router";
import { computeAcceleration, canonicalKeyFor, buildCorroboration } from "@/lib/topicAcceleration";

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
 *
 * Fase E: oltre ai segnali "grezzi" (signals, invariato), ogni topic torna
 * anche con `acceleration` (la crescita sta accelerando o rallentando,
 * rispetto alla lettura precedente — vedi topicAcceleration.ts) e
 * `corroboration` (quante fonti indipendenti raccontano lo stesso fenomeno
 * in accelerazione coerente, calcolato raggruppando TUTTI i topic attivi
 * per chiave canonica prima di rispondere).
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
              "id, topic_type, value, derived_hashtag, derived_keyword, category, last_seen_in_top5_at, topic_signals(platform, volume_growth_pct, engagement_growth_pct, latest_content_volume, latest_total_engagement, is_volume_exact, computed_at)",
            )
            .eq("status", "active")
            .limit(500);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          // topic_signals/topic_growth_history non sono ancora nei tipi
          // Supabase generati: la forma è nota e stabile (definita dalla
          // migration), la normalizziamo qui.
          type Row = {
            id: string;
            topic_type: string;
            value: string;
            derived_hashtag: string | null;
            derived_keyword: string | null;
            category: string | null;
            last_seen_in_top5_at: string;
            topic_signals: unknown[] | null;
          };
          const rows = (data ?? []) as unknown as Row[];
          const topicIds = rows.map((t) => t.id);

          // Fase E: ultime due letture per (topic, piattaforma) — una singola
          // query su tutti i topic attivi invece di N+1, raggruppata qui in
          // JS (dataset piccolo: qualche centinaio di topic attivi al più).
          type GrowthHistoryRow = {
            topic_id: string;
            platform: string;
            volume_growth_pct: number | null;
            engagement_growth_pct: number | null;
            computed_at: string;
          };
          const accelerationByTopic = new Map<
            string,
            ReturnType<typeof computeAcceleration>[]
          >();

          if (topicIds.length > 0) {
            const { data: growthHistory } = await supabaseAdmin
              .from("topic_growth_history")
              .select("topic_id, platform, volume_growth_pct, engagement_growth_pct, computed_at")
              .in("topic_id", topicIds)
              .order("computed_at", { ascending: true });

            const byTopicPlatform = new Map<string, GrowthHistoryRow[]>();
            for (const row of (growthHistory ?? []) as unknown as GrowthHistoryRow[]) {
              const key = `${row.topic_id}:${row.platform}`;
              const arr = byTopicPlatform.get(key) ?? [];
              arr.push(row);
              byTopicPlatform.set(key, arr);
            }

            for (const [key, readings] of byTopicPlatform) {
              const [topicId, platform] = key.split(":");
              const latest = readings[readings.length - 1] ?? null;
              const previous = readings.length > 1 ? readings[readings.length - 2] : null;
              const acceleration = computeAcceleration(platform, latest, previous);
              const arr = accelerationByTopic.get(topicId) ?? [];
              arr.push(acceleration);
              accelerationByTopic.set(topicId, arr);
            }
          }

          // Corroborazione: raggruppa TUTTI i topic attivi per chiave
          // canonica (vedi canonicalKeyFor — solo hashtag TikTok e topic con
          // derived_hashtag entrano in un gruppo, gli altri restano fuori
          // dalla corroborazione automatica in questa prima iterazione).
          const corroborationInputs = rows.map((t) => {
            const accelerations = accelerationByTopic.get(t.id) ?? [];
            return {
              id: t.id,
              topic_type: t.topic_type,
              canonicalKey: canonicalKeyFor(t),
              isAccelerating: accelerations.some((a) => a.trend === "accelerating"),
            };
          });
          const corroborationByKey = buildCorroboration(corroborationInputs);
          const canonicalKeyById = new Map(
            corroborationInputs.map((t) => [t.id, t.canonicalKey]),
          );

          const topics = rows.map((t) => {
            const canonicalKey = canonicalKeyById.get(t.id) ?? null;
            return {
              id: t.id,
              topic_type: t.topic_type,
              value: t.value,
              derived_hashtag: t.derived_hashtag,
              derived_keyword: t.derived_keyword,
              category: t.category,
              last_seen_in_top5_at: t.last_seen_in_top5_at,
              signals: t.topic_signals ?? [],
              acceleration: accelerationByTopic.get(t.id) ?? [],
              corroboration: canonicalKey ? (corroborationByKey.get(canonicalKey) ?? null) : null,
            };
          });

          return Response.json({ ok: true, topics });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
