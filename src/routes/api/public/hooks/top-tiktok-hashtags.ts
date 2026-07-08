import { createFileRoute } from "@tanstack/react-router";

/**
 * Restituisce gli hashtag TikTok più frequenti tra i contenuti sincronizzati
 * di recente dalla pipeline "TikTok Trending IT" (section=tiktok-hashtag di
 * trend_submissions, popolata da sync-tiktok-hashtag.ts). Usato come input
 * per la conversione hashtag -> keyword del flusso "Trend Virali" — legge da
 * trend_submissions (già in produzione) invece che da tiktok_trending_hashtags
 * per non dipendere da una tabella la cui migration potrebbe non essere
 * ancora applicata.
 */

const DEFAULT_LIMIT = 5;
const LOOKBACK_DAYS = 3;

// "starhotels" è il tag di fallback hardcoded in sync-tiktok-hashtag.ts
// quando lo scraper del brand cliente non passa un hashtag esplicito —
// condivide la stessa tabella/section della pipeline "TikTok Trending IT",
// ma non è un hashtag realmente in trend: va escluso dall'aggregazione.
const EXCLUDED_TAGS = new Set(["starhotels"]);

export const Route = createFileRoute("/api/public/hooks/top-tiktok-hashtags")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const limitParam = new URL(request.url).searchParams.get("limit");
          const limit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT, 1), 20);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const since = new Date();
          since.setDate(since.getDate() - LOOKBACK_DAYS);

          const { data, error } = await supabaseAdmin
            .from("trend_submissions")
            .select("tags")
            .eq("section", "tiktok-hashtag")
            .eq("status", "approved")
            .gte("created_at", since.toISOString())
            .limit(2000);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          const freq = new Map<string, number>();
          for (const row of data ?? []) {
            for (const tag of row.tags ?? []) {
              if (!tag || EXCLUDED_TAGS.has(tag.toLowerCase())) continue;
              freq.set(tag, (freq.get(tag) ?? 0) + 1);
            }
          }

          const hashtags = [...freq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([tag]) => tag);

          return Response.json({ ok: true, hashtags });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
