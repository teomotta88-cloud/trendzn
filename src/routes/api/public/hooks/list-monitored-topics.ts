import { createFileRoute } from "@tanstack/react-router";

/**
 * Elenco dei topic attualmente monitorati (status='active', vedi
 * monitor-topics.ts) — usato da scripts/discover-instagram-hashtag-content.mjs
 * per sapere quali hashtag/keyword provare con la discovery gratuita via
 * pagina hashtag Instagram.
 */
export const Route = createFileRoute("/api/public/hooks/list-monitored-topics")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin
            .from("monitored_topics")
            .select("id, topic_type, value, derived_hashtag, derived_keyword")
            .eq("status", "active")
            .limit(500);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, topics: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
