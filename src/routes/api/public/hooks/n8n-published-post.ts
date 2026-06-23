import { createFileRoute } from "@tanstack/react-router";
import { textSimilarity } from "@/lib/textSimilarity";

const SIMILARITY_THRESHOLD = 0.55;
const DATE_TOLERANCE_DAYS = 1;

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findMatch(
  db: any,
  canale: string,
  publishedDate: string,
  caption: string | null,
): Promise<string | null> {
  if (!caption) return null;

  const { data: candidates, error } = await db
    .from("editorial_posts")
    .select("id, channel_copies, post_date")
    .contains("canali", [canale])
    .gte("post_date", shiftDate(publishedDate, -DATE_TOLERANCE_DAYS))
    .lte("post_date", shiftDate(publishedDate, DATE_TOLERANCE_DAYS));

  if (error || !candidates) return null;

  let best: { id: string; score: number } | null = null;
  for (const post of candidates as { id: string; channel_copies: Record<string, string> }[]) {
    const channelCopy = post.channel_copies?.[canale];
    if (!channelCopy) continue;
    const score = textSimilarity(channelCopy, caption);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { id: post.id, score };
    }
  }

  return best?.id ?? null;
}

export const Route = createFileRoute("/api/public/hooks/n8n-published-post")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            canale?: string;
            url?: string;
            published_date?: string;
            caption?: string | null;
          };

          const canale = body.canale?.trim();
          const url = body.url?.trim();
          const publishedDate = body.published_date?.trim();

          if (!canale || !url || !publishedDate) {
            return Response.json(
              { ok: false, error: "canale, url e published_date sono obbligatori" },
              { status: 400 },
            );
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) {
            return Response.json({ ok: false, error: "published_date deve essere YYYY-MM-DD" }, { status: 400 });
          }

          const caption = body.caption?.trim() || null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          const matchedPostId = await findMatch(db, canale, publishedDate, caption);

          const { data, error } = await db
            .from("editorial_published_posts")
            .upsert(
              {
                canale,
                url,
                published_date: publishedDate,
                caption,
                matched_post_id: matchedPostId,
              },
              { onConflict: "canale,url" },
            )
            .select("id")
            .single();

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, id: data.id, matched: !!matchedPostId });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
