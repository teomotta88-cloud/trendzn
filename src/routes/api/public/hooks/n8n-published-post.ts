import { createFileRoute } from "@tanstack/react-router";

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

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          const { data, error } = await db
            .from("editorial_published_posts")
            .upsert(
              {
                canale,
                url,
                published_date: publishedDate,
                caption: body.caption?.trim() || null,
              },
              { onConflict: "canale,url" },
            )
            .select("id")
            .single();

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, id: data.id });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
