import { createFileRoute } from "@tanstack/react-router";

/**
 * Restituisce gli hashtag TikTok in trend, IN ORDINE DI RANK, usati come
 * input per il monitoraggio del flusso "Trend Virali".
 *
 * Fonte primaria: tiktok_trending_hashtags (popolata da sync-trending-hashtags.ts
 * dalla classifica reale di TikTok Creative Center, campo `rank`) — è
 * l'ultima istantanea per region+period_days (la pipeline sostituisce lo
 * snapshot precedente ad ogni run). Se è vuota o dà errore (es. migration non
 * ancora applicata) si ripiega sull'aggregazione per frequenza da
 * trend_submissions, come in precedenza — così l'endpoint non smette mai di
 * restituire qualcosa.
 */

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;
const LOOKBACK_DAYS = 3;

// "starhotels" è il tag di fallback hardcoded in sync-tiktok-hashtag.ts
// quando lo scraper del brand cliente non passa un hashtag esplicito —
// condivide la stessa tabella/section, ma non è un hashtag realmente in
// trend: va sempre escluso.
const EXCLUDED_TAGS = new Set(["starhotels"]);

export const Route = createFileRoute("/api/public/hooks/top-tiktok-hashtags")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const limitParam = new URL(request.url).searchParams.get("limit");
          const limit = Math.min(
            Math.max(parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT, 1),
            MAX_LIMIT,
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Fonte primaria: classifica reale per rank dall'ultima istantanea
          // di Creative Center (tiktok_trending_hashtags).
          const { data: rankRows } = await supabaseAdmin
            .from("tiktok_trending_hashtags")
            .select("hashtag, rank")
            .eq("region", "IT")
            .order("rank", { ascending: true, nullsFirst: false })
            .limit(500);

          const seen = new Set<string>();
          const hashtags: string[] = [];
          for (const row of rankRows ?? []) {
            const tag = row.hashtag;
            if (!tag || EXCLUDED_TAGS.has(tag.toLowerCase()) || seen.has(tag)) continue;
            seen.add(tag);
            hashtags.push(tag);
            if (hashtags.length >= limit) break;
          }

          // Ripiego (tabella vuota o non disponibile): frequenza da
          // trend_submissions, come in precedenza — nessun rank qui.
          if (hashtags.length === 0) {
            const since = new Date();
            since.setDate(since.getDate() - LOOKBACK_DAYS);

            const { data: subs } = await supabaseAdmin
              .from("trend_submissions")
              .select("tags")
              .eq("section", "tiktok-hashtag")
              .eq("status", "approved")
              .gte("created_at", since.toISOString())
              .limit(2000);

            const freq = new Map<string, number>();
            for (const row of subs ?? []) {
              for (const tag of row.tags ?? []) {
                if (!tag || EXCLUDED_TAGS.has(tag.toLowerCase())) continue;
                freq.set(tag, (freq.get(tag) ?? 0) + 1);
              }
            }
            hashtags.push(
              ...[...freq.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
                .map(([tag]) => tag),
            );
          }

          return Response.json({ ok: true, hashtags });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
