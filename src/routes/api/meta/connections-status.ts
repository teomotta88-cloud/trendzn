import { createFileRoute } from "@tanstack/react-router";

// meta_connections non ha una policy RLS pubblica (contiene access token), e
// una policy RLS non può comunque nascondere solo alcune colonne — quindi
// per far vedere lo stato della connessione nell'UI (Piano Editoriale)
// passiamo da un endpoint server che espone esplicitamente solo i campi non
// sensibili, mai i token.
export const Route = createFileRoute("/api/meta/connections-status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          const { data, error } = await db
            .from("meta_connections")
            .select(
              "client_channel_id, platform, fb_page_name, ig_username, status, token_expires_at",
            );
          if (error) throw error;

          return Response.json({ ok: true, connections: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
