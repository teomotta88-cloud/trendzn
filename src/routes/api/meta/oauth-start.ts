import { createFileRoute } from "@tanstack/react-router";
import { buildOAuthDialogUrl } from "@/lib/metaGraphApi.server";

// Avvia il login Facebook for Business per collegare un canale cliente
// (Instagram Business/Creator via Pagina Facebook). Lo state è un nonce
// anti-CSRF: viene messo anche in un cookie httpOnly di breve durata,
// confrontato con quello che Meta ci rimanda in oauth-callback.
export const Route = createFileRoute("/api/meta/oauth-start")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const state = crypto.randomUUID();
          const authUrl = buildOAuthDialogUrl(state);

          return new Response(null, {
            status: 302,
            headers: {
              Location: authUrl,
              "Set-Cookie": `meta_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
            },
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
