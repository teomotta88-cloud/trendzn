import { createFileRoute } from "@tanstack/react-router";

type IncomingPost = {
  url: string;
  author?: string | null;
  caption?: string | null;
  postedAt?: string | null;
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return url.split("?")[0].replace(/\/$/, "");
  }
}

export const Route = createFileRoute("/api/public/hooks/tiktok-tag-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const expectedSecret = process.env.TIKTOK_TAG_SYNC_SECRET;
          if (!expectedSecret) {
            return Response.json({ ok: false, error: "TIKTOK_TAG_SYNC_SECRET non configurato" }, { status: 500 });
          }
          if (request.headers.get("x-webhook-secret") !== expectedSecret) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const body = (await request.json()) as { tag?: string; posts?: IncomingPost[] };
          const tag = body.tag?.trim().toLowerCase();
          const posts = body.posts ?? [];

          if (!tag) {
            return Response.json({ ok: false, error: "tag mancante" }, { status: 400 });
          }
          if (!Array.isArray(posts) || posts.length === 0) {
            return Response.json({ ok: true, inserted: 0, skipped: 0 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let inserted = 0;
          let skipped = 0;

          for (const post of posts) {
            if (!post.url || !/^https?:\/\/(www\.)?tiktok\.com\//.test(post.url.trim())) {
              skipped++;
              continue;
            }

            const videoUrl = normalizeUrl(post.url.trim());

            const { error } = await supabaseAdmin
              .from("tiktok_tag_posts")
              .insert({
                tag,
                video_url: videoUrl,
                author_handle: post.author?.trim() || null,
                caption: post.caption?.trim() || null,
                posted_at: post.postedAt || null,
                status: "pending" as const,
              })
              .select("id")
              .single();

            // Conflitto su UNIQUE(video_url) => post già noto, non è un errore
            if (error) {
              if (error.code === "23505") {
                skipped++;
              } else {
                console.error("tiktok-tag-sync insert error:", error.message);
                skipped++;
              }
              continue;
            }

            inserted++;
          }

          return Response.json({ ok: true, inserted, skipped });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
