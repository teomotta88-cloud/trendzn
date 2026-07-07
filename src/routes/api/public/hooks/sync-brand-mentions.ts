import { createFileRoute } from "@tanstack/react-router";

const PLATFORMS = ["twitter", "reddit", "instagram", "youtube", "linkedin"] as const;
type Platform = (typeof PLATFORMS)[number];

type IncomingMention = {
  platform: Platform;
  external_id: string;
  url: string;
  author?: string | null;
  content?: string | null;
  published_at?: string | null;
  keyword_matched: string;
  sentiment: "positive" | "negative" | "neutral";
  category?: string | null;
  engagement?: number;
  reach?: number | null;
  is_viral?: boolean;
  raw?: unknown;
};

type IncomingRun = {
  platform?: string;
  keyword?: string;
  requests_used?: number;
  mentions_found?: number;
  status?: "ok" | "error";
  error_message?: string;
  started_at?: string;
  finished_at?: string;
};

// Soglie Level 1-4 da references/MONITORING_GUIDE.md della skill anysite-brand-reputation.
// baseline = media mention/giorno sugli ultimi 7 giorni (esclusa la giornata corrente).
function computeCrisisLevel(todayCount: number, negativeShare: number, baseline: number) {
  if (todayCount > baseline * 3 || negativeShare > 0.5) return 3;
  if (todayCount > baseline * 2 || negativeShare > 0.3) return 2;
  return null; // Level 1: monitor, nessun alert
}

export const Route = createFileRoute("/api/public/hooks/sync-brand-mentions")({
  server: {
    handlers: {
      // Riceve le mention raccolte dallo script GitHub Actions (scripts/sync-brand-mentions.mjs),
      // che chiama la REST API anysite (una piattaforma alla volta), e le inserisce usando
      // supabaseAdmin, cosi' lo script esterno non deve conoscere la service role key.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { mentions?: IncomingMention[]; run?: IncomingRun };
          const mentions = Array.isArray(body.mentions) ? body.mentions : [];
          const run = body.run ?? {};

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let inserted = 0;
          if (mentions.length > 0) {
            const rows = mentions
              .filter((m) => PLATFORMS.includes(m.platform))
              .map((m) => ({
                platform: m.platform,
                external_id: m.external_id,
                url: m.url,
                author: m.author ?? null,
                content: m.content ?? null,
                published_at: m.published_at ?? null,
                keyword_matched: m.keyword_matched,
                sentiment: m.sentiment,
                category: m.category ?? null,
                engagement: m.engagement ?? 0,
                reach: m.reach ?? null,
                is_viral: m.is_viral ?? false,
                raw: m.raw ?? null,
              }));

            // ignoreDuplicates: false (default upsert) cosi' una mention gia' vista
            // viene aggiornata con i dati freschi (es. engagement/reach cambiati)
            // invece di essere saltata per sempre dopo il primo inserimento.
            const { data, error } = await supabaseAdmin
              .from("brand_mentions")
              .upsert(rows, { onConflict: "platform,external_id" })
              .select("id");

            if (error) {
              return Response.json({ ok: false, error: error.message }, { status: 500 });
            }
            inserted = data?.length ?? 0;
          }

          await supabaseAdmin.from("brand_monitoring_runs").insert({
            platform: run.platform ?? null,
            keyword: run.keyword ?? null,
            requests_used: run.requests_used ?? 0,
            mentions_found: run.mentions_found ?? mentions.length,
            status: run.status ?? "ok",
            error_message: run.error_message ?? null,
            started_at: run.started_at ?? new Date().toISOString(),
            finished_at: run.finished_at ?? new Date().toISOString(),
          });

          // Alert di crisi: confronta il volume di oggi (per piattaforma) con la baseline a 7 giorni.
          if (run.platform && mentions.length > 0) {
            const since = new Date();
            since.setDate(since.getDate() - 8);
            const { data: recent } = await supabaseAdmin
              .from("brand_mentions")
              .select("sentiment, created_at")
              .eq("platform", run.platform)
              .gte("created_at", since.toISOString());

            if (recent && recent.length > 0) {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const todayRows = recent.filter((r) => new Date(r.created_at) >= todayStart);
              const priorDays = recent.length - todayRows.length;
              const baseline = priorDays > 0 ? priorDays / 7 : todayRows.length || 1;
              const negativeShare =
                todayRows.length > 0
                  ? todayRows.filter((r) => r.sentiment === "negative").length / todayRows.length
                  : 0;

              const level = computeCrisisLevel(todayRows.length, negativeShare, baseline);
              if (level !== null) {
                // Evita di accumulare alert duplicati: ogni run che ritrova le
                // stesse condizioni non deve creare una nuova riga finche' la
                // precedente per questa piattaforma non e' stata risolta.
                const { data: existingAlert } = await supabaseAdmin
                  .from("brand_sentiment_alerts")
                  .select("id")
                  .eq("platform", run.platform)
                  .is("resolved_at", null)
                  .limit(1)
                  .maybeSingle();

                if (!existingAlert) {
                  await supabaseAdmin.from("brand_sentiment_alerts").insert({
                    level,
                    platform: run.platform,
                    reason:
                      level === 3
                        ? "Volume >3x baseline o sentiment negativo >50%"
                        : "Volume 2-3x baseline o sentiment negativo >30%",
                    metrics: { today_count: todayRows.length, baseline, negative_share: negativeShare },
                  });
                }
              }
            }
          }

          return Response.json({ ok: true, inserted });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
