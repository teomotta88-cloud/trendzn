import { createFileRoute } from "@tanstack/react-router";
import {
  computeDeltaMetrics,
  computePostVirality,
  VIRALITY_WINDOW_DAYS,
  VIRAL_DELTA_WINDOW_HOURS,
} from "@/lib/virality";

const PLATFORMS = ["twitter", "reddit", "instagram", "youtube", "linkedin", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

const DISCOVERY_SOURCES = [
  "tiktok-hashtag",
  "google-trends",
  "trending-audio",
  "x-trending",
  "canali-inspo",
  "reddit-trending",
  "youtube-trending",
] as const;
type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

type IncomingContent = {
  platform: Platform;
  external_id: string;
  url: string;
  author?: string | null;
  content?: string | null;
  published_at?: string | null;
  source_hashtag: string;
  keyword_matched: string;
  discovery_source?: DiscoverySource;
  topic_id?: string | null;
  engagement?: number;
  reach?: number | null;
  is_viral?: boolean;
  raw?: unknown;
  // Valorizzati solo per i post Canali Inspo che fanno parte di un cluster
  // cross-profilo promosso a trend (vedi discover-canali-inspo-content.mjs).
  cross_profile_topic?: string | null;
  cross_profile_channel_count?: number | null;
  // Fase F: nome della traccia audio e link a /reels/audio/<id>/, estratti
  // dalla pagina del singolo Reel (vedi scripts/lib/instagram-reel-audio.mjs)
  // — null per i contenuti non-Reel (foto/carosello) o quando l'estrazione
  // fallisce (non tutti i Reel espongono il link, es. audio non attribuito).
  audio_name?: string | null;
  audio_url?: string | null;
  // Fingerprint acustico (Chromaprint, calcolato inline durante lo
  // scraping mentre l'URL del video CDN è ancora valido — vedi
  // scripts/lib/audio-fingerprint.mjs) — solo per un sottoinsieme dei Reel
  // Canali Inspo con audio_url "isolato" (nessun altro Reel noto con lo
  // stesso audio_url), null per tutti gli altri.
  audio_fingerprint?: number[] | null;
};

type IncomingRun = {
  source_hashtag?: string;
  keyword_matched?: string;
  platform?: string;
  discovery_source?: string;
  requests_used?: number;
  content_found?: number;
  status?: "ok" | "error";
  error_message?: string;
  started_at?: string;
  finished_at?: string;
};

export const Route = createFileRoute("/api/public/hooks/sync-viral-trends")({
  server: {
    handlers: {
      // Riceve i contenuti raccolti dallo script GitHub Actions
      // (scripts/sync-viral-trends.mjs), che per ogni topic (hashtag TikTok
      // in trend o ricerca Google Trends IT, vedi discovery_source) cerca la
      // keyword corrispondente su Instagram (anysite), più i video TikTok
      // reali già raccolti per lo stesso hashtag (solo per topic da hashtag
      // TikTok — senza engagement/views, anysite non supporta la ricerca
      // TikTok), e li inserisce con supabaseAdmin — stesso pattern di
      // sync-brand-mentions.ts ma senza sentiment/crisis-alert, che non
      // hanno senso per keyword generiche non legate a un brand. Dopo
      // l'upsert calcola anche la viralità del post (vedi
      // computePostVirality in src/lib/virality.ts): il post è virale se il
      // suo segnale (engagement, o VIEWS per TikTok) sta accelerando nelle
      // ultime ~6h oltre la soglia della piattaforma. Non più uno stato
      // "sticky" su soglia assoluta: la viralità decade quando il post smette
      // di correre.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            contents?: IncomingContent[];
            run?: IncomingRun;
          };
          const contents = Array.isArray(body.contents) ? body.contents : [];
          const run = body.run ?? {};

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let inserted = 0;
          if (contents.length > 0) {
            const rowsWithDupes = contents
              .filter((c) => PLATFORMS.includes(c.platform))
              .map((c) => ({
                platform: c.platform,
                external_id: c.external_id,
                url: c.url,
                author: c.author ?? null,
                content: c.content ?? null,
                published_at: c.published_at ?? null,
                source_hashtag: c.source_hashtag,
                keyword_matched: c.keyword_matched,
                discovery_source: c.discovery_source ?? "tiktok-hashtag",
                topic_id: c.topic_id ?? null,
                engagement: c.engagement ?? 0,
                reach: c.reach ?? null,
                is_viral: c.is_viral ?? false,
                raw: (c.raw ?? null) as import("@/integrations/supabase/types").Json,
                cross_profile_topic: c.cross_profile_topic ?? null,
                cross_profile_channel_count: c.cross_profile_channel_count ?? null,
                audio_name: c.audio_name ?? null,
                audio_url: c.audio_url ?? null,
                audio_fingerprint: c.audio_fingerprint ?? null,
                // Fix rotazione list-instagram-content-urls.ts: ogni scrittura
                // reale del contenuto aggiorna updated_at esplicitamente
                // (nessun trigger DB, stesso pattern già in uso per
                // monitored_topics.updated_at).
                updated_at: new Date().toISOString(),
              }));

            // anysite può restituire lo stesso post più volte nella stessa
            // pagina di risultati: un batch con (platform, external_id)
            // duplicati fa fallire l'intero upsert con "ON CONFLICT DO
            // UPDATE command cannot affect row a second time" (Postgres non
            // permette di aggiornare la stessa riga due volte in un solo
            // statement). Dedup per la chiave di conflitto prima di inviare.
            const rows = [
              ...new Map(rowsWithDupes.map((r) => [`${r.platform}:${r.external_id}`, r])).values(),
            ];

            const { data, error } = await supabaseAdmin
              .from("viral_trend_content")
              .upsert(rows, { onConflict: "platform,external_id" })
              .select("id, platform, engagement, reach, published_at, created_at");

            if (error) {
              return Response.json({ ok: false, error: error.message }, { status: 500 });
            }
            inserted = data?.length ?? 0;

            // Uno snapshot per ogni post appena scritto, poi si ricalcolano
            // due cose separate: la "Variazione (7gg)" mostrata in UI
            // (computeDeltaMetrics, confrontando col valore più vecchio
            // noto negli ultimi 7 giorni) e la viralità vera e propria
            // (computePostVirality, finestra molto più stretta di 6 ore).
            // Alla prima volta che un post viene visto non esiste ancora
            // nessuno snapshot precedente in nessuna delle due finestre: i
            // delta restano 0, compariranno dal prossimo sync in cui questo
            // stesso post viene ritrovato.
            const windowStart = new Date(
              Date.now() - VIRALITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString();
            const viralWindowStart = new Date(
              Date.now() - VIRAL_DELTA_WINDOW_HOURS * 60 * 60 * 1000,
            ).toISOString();

            for (const row of data ?? []) {
              await supabaseAdmin.from("viral_trend_metrics_history").insert({
                content_id: row.id,
                engagement: row.engagement,
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
                engagement: row.engagement,
                reach: row.reach,
                oldest: oldestRows?.[0] ?? null,
              });

              const { isViral, deltaSignal6h } = computePostVirality({
                platform: row.platform,
                engagement: row.engagement,
                reach: row.reach,
                oldestWithin6h: oldestWithin6hRows?.[0] ?? null,
              });

              await supabaseAdmin
                .from("viral_trend_content")
                .update({
                  delta_engagement: deltaEngagement,
                  delta_reach: deltaReach,
                  // Velocità del segnale di viralità nelle ultime 6h: per
                  // TikTok è la crescita delle views, non dell'engagement
                  // (colonna non ancora rinominata — vedi computePostVirality).
                  delta_engagement_6h: deltaSignal6h,
                  delta_since: oldestRows?.[0]?.captured_at ?? null,
                  is_viral: isViral,
                })
                .eq("id", row.id);
            }

            // La finestra è sempre e solo l'ultima settimana: non serve
            // conservare snapshot più vecchi, si accumulerebbero all'infinito.
            await supabaseAdmin
              .from("viral_trend_metrics_history")
              .delete()
              .lt("captured_at", windowStart);
          }

          await supabaseAdmin.from("viral_trend_runs").insert({
            source_hashtag: run.source_hashtag ?? null,
            keyword_matched: run.keyword_matched ?? null,
            platform: run.platform ?? null,
            discovery_source: run.discovery_source ?? null,
            requests_used: run.requests_used ?? 0,
            content_found: run.content_found ?? contents.length,
            status: run.status ?? "ok",
            error_message: run.error_message ?? null,
            started_at: run.started_at ?? new Date().toISOString(),
            finished_at: run.finished_at ?? new Date().toISOString(),
          });

          return Response.json({ ok: true, inserted });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
