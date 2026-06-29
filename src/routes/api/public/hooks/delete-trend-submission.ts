import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/delete-trend-submission")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { id } = (await request.json()) as { id: string };
          if (!id) {
            return Response.json({ ok: false, error: "id mancante" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { error } = await supabaseAdmin.from("trend_submissions").delete().eq("id", id);
          if (error) {
            return Response.json({ ok: false, error: error.message.slice(0, 200) }, { status: 500 });
          }

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
        }
      },
    },
  },
});
