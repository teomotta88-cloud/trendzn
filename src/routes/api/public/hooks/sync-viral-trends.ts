import { createFileRoute } from "@tanstack/react-router";

const PLATFORMS = ["twitter", "reddit", "instagram", "youtube", "linkedin"] as const;
type Platform = (typeof PLATFORMS)[number];

type IncomingContent = {
  platform: Platform;
  external_id: string;
  url: string;
  author?: string | null;
  content?: string | null;
  published_at?: string | null;
  source_hashtag: string;
  keyword_matched: string;
  engagement?: number;
  reach?: number | null;
  is_viral?: boolean;
  raw?: unknown;
};

type IncomingRun = {
  source_hashtag?: string;
  keyword_matched?: string;
  platform?: string;
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
      // (scripts/sync-viral-trends.mjs), che per ogni hashtag TikTok in
      // trend cerca la keyword corrispondente (convertita via Claude) su
      // YouTube + anysite, e li inserisce con supabaseAdmin — stesso pattern
      // di sync-brand-mentions.ts ma senza sentiment/crisis-alert, che non
      // hanno senso per keyword generiche non legate a un brand.
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
            const rows = contents
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
                engagement: c.engagement ?? 0,
                reach: c.reach ?? null,
                is_viral: c.is_viral ?? false,
                raw: c.raw ?? null,
              }));

            const { data, error } = await supabaseAdmin
              .from("viral_trend_content")
              .upsert(rows, { onConflict: "platform,external_id" })
              .select("id");

            if (error) {
              return Response.json({ ok: false, error: error.message }, { status: 500 });
            }
            inserted = data?.length ?? 0;
          }

          await supabaseAdmin.from("viral_trend_runs").insert({
            source_hashtag: run.source_hashtag ?? null,
            keyword_matched: run.keyword_matched ?? null,
            platform: run.platform ?? null,
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
