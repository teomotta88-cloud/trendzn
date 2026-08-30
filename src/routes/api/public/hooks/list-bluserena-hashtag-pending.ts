import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_LIMIT = 100;
// Oltre questo numero di tentativi un post smette di essere riproposto: un
// post che continua a dare login-wall/errore non deve rallentare la coda
// all'infinito (stesso spirito bounded-retry di RETRY_ROUNDS in
// scripts/lib/openrouter.mjs, applicato qui al numero di RUN invece che di
// round nella stessa chiamata).
const MAX_ATTEMPTS = 5;

// Coda di retry per Passata B di scripts/sync-bluserena-hashtags.mjs: i post
// scoperti dalla pagina hashtag (Passata A, detail_status 'pending') o falliti
// in un giro precedente (login-wall ecc., detail_status 'failed') tornano qui
// finché non arrivano a 'ok' o superano MAX_ATTEMPTS — è questo il
// meccanismo di "riprova in una run successiva" richiesto esplicitamente per
// il login-wall.
export const Route = createFileRoute("/api/public/hooks/list-bluserena-hashtag-pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const params = new URL(request.url).searchParams;
          const limit = Math.min(
            Math.max(parseInt(params.get("limit") ?? "", 10) || DEFAULT_LIMIT, 1),
            300,
          );
          const platform = params.get("platform");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let query = supabaseAdmin
            .from("bluserena_hashtag_posts")
            .select("id, hashtag_url, platform, tag, url")
            .neq("detail_status", "ok")
            .lt("detail_attempt_count", MAX_ATTEMPTS)
            .order("detail_last_attempt_at", { ascending: true, nullsFirst: true })
            .limit(limit);

          if (platform) query = query.eq("platform", platform);

          const { data, error } = await query;

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, posts: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
