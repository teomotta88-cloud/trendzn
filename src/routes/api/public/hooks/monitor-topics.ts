import { createFileRoute } from "@tanstack/react-router";

const TOPIC_TYPES = [
  "tiktok-hashtag",
  "google-trends",
  "trending-audio",
  "x-trending",
  "reddit-trending",
  "youtube-trending",
] as const;
type TopicType = (typeof TOPIC_TYPES)[number];

type IncomingTopic = {
  topicType: TopicType;
  value: string;
  derivedHashtag?: string | null;
  derivedKeyword?: string | null;
  // Categoria mostrata da X accanto al trend (es. "Politics") — solo
  // topic_type='x-trending', ignorata per le altre fonti.
  category?: string | null;
};

export const Route = createFileRoute("/api/public/hooks/monitor-topics")({
  server: {
    handlers: {
      // Ciclo di vita di monitoraggio per hashtag TikTok e keyword Google
      // Trends (vedi supabase/migrations/20260710120000_monitored_topics.sql):
      // chiamato da sync-viral-trends.mjs ad ogni run con la classifica attuale di
      // entrambe le fonti. Ogni topic ricevuto viene upsertato (per
      // topic_type+value): se già monitorato, aggiorna last_seen_in_top5_at e
      // ricalcola monitoring_stops_at = now()+24h (il topic resta "attivo"
      // finché continua a rientrare in classifica, poi per altre 24h dall'ultima
      // volta vista). I topic non più ricevuti semplicemente non vengono
      // toccati: passano da 'active' a 'expired' da soli quando la loro
      // monitoring_stops_at scade (vedi lo sweep sotto, eseguito ad ogni
      // chiamata invece che con un cron dedicato).
      //
      // Restituisce {topics: [{topicType, value, id}]} così il chiamante può
      // collegare topic_id ai contenuti scoperti per quel topic.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { topics?: IncomingTopic[] };
          const incoming = (Array.isArray(body.topics) ? body.topics : []).filter((t) =>
            TOPIC_TYPES.includes(t.topicType),
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const monitoringStopsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const nowIso = new Date().toISOString();

          const topics: { topicType: TopicType; value: string; id: string }[] = [];

          for (const t of incoming) {
            const { data: existingRows } = await supabaseAdmin
              .from("monitored_topics")
              .select("id, first_seen_in_top5_at")
              .eq("topic_type", t.topicType)
              .eq("value", t.value)
              .limit(1);
            const existing = existingRows?.[0];

            const { data: upserted, error } = await supabaseAdmin
              .from("monitored_topics")
              .upsert(
                {
                  topic_type: t.topicType,
                  value: t.value,
                  derived_hashtag: t.derivedHashtag ?? null,
                  derived_keyword: t.derivedKeyword ?? null,
                  category: t.category ?? null,
                  first_seen_in_top5_at: existing?.first_seen_in_top5_at ?? nowIso,
                  last_seen_in_top5_at: nowIso,
                  monitoring_stops_at: monitoringStopsAt,
                  status: "active",
                  updated_at: nowIso,
                },
                { onConflict: "topic_type,value" },
              )
              .select("id")
              .single();

            if (error || !upserted) {
              console.error(
                `monitor-topics upsert fallito per ${t.topicType}:${t.value}: ${error?.message}`,
              );
              continue;
            }

            topics.push({ topicType: t.topicType, value: t.value, id: upserted.id });
          }

          // Sweep: nessun cron dedicato, si aggancia a questa stessa chiamata
          // (eseguita ad ogni sync) — un topic scaduto resta "active" al più
          // fino al prossimo run del workflow, non è un problema per una
          // finestra di grazia di 24h.
          await supabaseAdmin
            .from("monitored_topics")
            .update({ status: "expired", updated_at: nowIso })
            .eq("status", "active")
            .lt("monitoring_stops_at", nowIso);

          return Response.json({ ok: true, topics });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
