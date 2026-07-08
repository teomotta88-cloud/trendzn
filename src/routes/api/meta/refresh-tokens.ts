import { createFileRoute } from "@tanstack/react-router";
import { exchangeForLongLivedToken, getUserPagesWithInstagram } from "@/lib/metaGraphApi.server";

// I token utente long-lived di Meta durano ~60gg. Vanno riscambiati PRIMA
// della scadenza (fb_exchange_token richiede un token ancora valido): questo
// endpoint, chiamato periodicamente da GitHub Actions (vedi
// .github/workflows/refresh-meta-tokens.yml), estende chi scade entro 7
// giorni. Se il refresh fallisce (es. il cliente ha revocato l'accesso alla
// app dalle impostazioni Facebook) la connessione passa a "needs_reauth": il
// canale resta visibile in Piano Editoriale ma smette di sincronizzare finché
// il cliente non ripete il login.
const REFRESH_WINDOW_DAYS = 7;

function checkSyncSecret(request: Request): boolean {
  const expected = process.env.META_SYNC_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export const Route = createFileRoute("/api/meta/refresh-tokens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkSyncSecret(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        const cutoff = new Date(
          Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: connections, error } = await db
          .from("meta_connections")
          .select("*")
          .eq("status", "active")
          .lte("token_expires_at", cutoff);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        let refreshed = 0;
        let needsReauth = 0;

        for (const conn of connections ?? []) {
          try {
            const longLived = await exchangeForLongLivedToken(conn.user_access_token);
            const expiresAt = new Date(
              Date.now() + (longLived.expires_in ?? 60 * 24 * 60 * 60) * 1000,
            );

            // Ri-deriva anche il page token: la Pagina potrebbe essere stata
            // rinominata o l'admin del cliente potrebbe essere cambiato.
            const pages = await getUserPagesWithInstagram(longLived.access_token);
            const page = pages.find((p) => p.id === conn.fb_page_id);

            const { error: updateError } = await db
              .from("meta_connections")
              .update({
                user_access_token: longLived.access_token,
                page_access_token: page?.access_token ?? conn.page_access_token,
                token_expires_at: expiresAt.toISOString(),
                status: "active",
                updated_at: new Date().toISOString(),
              })
              .eq("id", conn.id);
            if (updateError) throw updateError;
            refreshed++;
          } catch (err) {
            console.error("[meta refresh-tokens]", conn.fb_page_id, err);
            await db.from("meta_connections").update({ status: "needs_reauth" }).eq("id", conn.id);
            needsReauth++;
          }
        }

        return Response.json({
          ok: true,
          checked: connections?.length ?? 0,
          refreshed,
          needsReauth,
        });
      },
    },
  },
});
