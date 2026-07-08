import { createFileRoute } from "@tanstack/react-router";
import { getInstagramMedia, getInstagramMediaInsights } from "@/lib/metaGraphApi.server";
import { textSimilarity } from "@/lib/textSimilarity";

const MATCH_SIMILARITY_THRESHOLD = 0.55;
const MATCH_DATE_TOLERANCE_DAYS = 1;

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function checkSyncSecret(request: Request): boolean {
  const expected = process.env.META_SYNC_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

// Sostituisce, per i canali collegati via OAuth (meta_connections), lo
// scraping RSS-Bridge + il matching euristico per similarità del copy: legge
// i post reali e gli insight reali da Instagram Graph API. Pensato per
// essere chiamato da un workflow GitHub Actions schedulato (vedi
// .github/workflows/sync-meta-posts.yml), autenticato con META_SYNC_SECRET —
// a differenza degli altri hook pubblici in api/public/hooks, questo non è
// sotto /public perché innesca chiamate a Graph API con token reali dei
// clienti, non riceve solo dati da inserire.
export const Route = createFileRoute("/api/meta/sync-posts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkSyncSecret(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        const { data: connections, error: connError } = await db
          .from("meta_connections")
          .select("*")
          .eq("status", "active");
        if (connError) {
          return Response.json({ ok: false, error: connError.message }, { status: 500 });
        }

        let mediaSynced = 0;
        let matched = 0;
        const errors: string[] = [];

        for (const conn of connections ?? []) {
          if (conn.platform !== "instagram" || !conn.ig_business_account_id) continue;

          try {
            const media = await getInstagramMedia(
              conn.ig_business_account_id,
              conn.page_access_token,
              25,
            );

            for (const item of media) {
              const insights = await getInstagramMediaInsights(item.id, conn.page_access_token);
              const publishedDate = item.timestamp.slice(0, 10);

              const { data: existing } = await db
                .from("editorial_published_posts")
                .select("id, matched_post_id")
                .eq("canale", "IG")
                .eq("url", item.permalink)
                .maybeSingle();

              let matchedPostId: string | null = existing?.matched_post_id ?? null;

              if (!matchedPostId && item.caption) {
                const { data: candidates } = await db
                  .from("editorial_posts")
                  .select("id, channel_copies")
                  .contains("canali", ["IG"])
                  .gte("post_date", shiftDate(publishedDate, -MATCH_DATE_TOLERANCE_DAYS))
                  .lte("post_date", shiftDate(publishedDate, MATCH_DATE_TOLERANCE_DAYS));

                let best: { id: string; score: number } | null = null;
                for (const post of (candidates ?? []) as {
                  id: string;
                  channel_copies: Record<string, string>;
                }[]) {
                  const channelCopy = post.channel_copies?.["IG"];
                  if (!channelCopy) continue;
                  const score = textSimilarity(channelCopy, item.caption);
                  if (score >= MATCH_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
                    best = { id: post.id, score };
                  }
                }
                matchedPostId = best?.id ?? null;
                if (matchedPostId) matched++;
              }

              const { error: upsertError } = await db.from("editorial_published_posts").upsert(
                {
                  canale: "IG",
                  url: item.permalink,
                  published_date: publishedDate,
                  caption: item.caption ?? null,
                  matched_post_id: matchedPostId,
                  external_id: item.id,
                  like_count: item.like_count ?? null,
                  comments_count: item.comments_count ?? null,
                  impressions: insights.impressions ?? null,
                  reach: insights.reach ?? null,
                  source: "meta_api",
                },
                { onConflict: "canale,url" },
              );
              if (upsertError) throw upsertError;
              mediaSynced++;
            }
          } catch (err) {
            errors.push(`${conn.fb_page_name ?? conn.fb_page_id}: ${String(err).slice(0, 200)}`);
          }
        }

        return Response.json({
          ok: true,
          connections: connections?.length ?? 0,
          mediaSynced,
          matched,
          errors,
        });
      },
    },
  },
});
