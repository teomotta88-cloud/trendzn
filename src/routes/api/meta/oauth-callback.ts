import { createFileRoute } from "@tanstack/react-router";
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  getUserPagesWithInstagram,
  META_OAUTH_SCOPES,
} from "@/lib/metaGraphApi.server";

const RETURN_PATH = "/piano-editoriale";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function redirectWithError(error: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${RETURN_PATH}?meta_error=${encodeURIComponent(error)}`,
      "Set-Cookie": "meta_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
}

// Riceve il redirect di Meta dopo il consenso dell'utente, scambia il code
// per un token long-lived, trova la Pagina/account Instagram Business
// collegati e li salva in meta_connections — creando il canale cliente in
// editorial_client_channels se non esiste già (stessa struttura usata per i
// canali aggiunti manualmente, così il resto del Piano Editoriale non deve
// distinguere i due casi).
export const Route = createFileRoute("/api/meta/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) return redirectWithError("denied");

        const expectedState = readCookie(request, "meta_oauth_state");
        if (!state || !expectedState || state !== expectedState) {
          return redirectWithError("state_mismatch");
        }
        if (!code) return redirectWithError("missing_code");

        try {
          const shortLived = await exchangeCodeForUserToken(code);
          const longLived = await exchangeForLongLivedToken(shortLived.access_token);
          const expiresAt = new Date(
            Date.now() + (longLived.expires_in ?? 60 * 24 * 60 * 60) * 1000,
          );

          const pages = await getUserPagesWithInstagram(longLived.access_token);
          const pagesWithIg = pages.filter((p) => p.instagram_business_account?.id);

          if (pagesWithIg.length === 0) {
            return redirectWithError("no_instagram_business_account");
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          for (const page of pagesWithIg) {
            const ig = page.instagram_business_account!;
            const handle = ig.username ? `@${ig.username}` : page.name;
            const channelUrl = ig.username
              ? `https://www.instagram.com/${ig.username}`
              : `https://www.facebook.com/${page.id}`;

            const { data: existingChannel } = await db
              .from("editorial_client_channels")
              .select("id")
              .eq("canale", "IG")
              .eq("handle", handle)
              .maybeSingle();

            let clientChannelId = existingChannel?.id as string | undefined;
            if (!clientChannelId) {
              const { data: created, error: createError } = await db
                .from("editorial_client_channels")
                .insert({ canale: "IG", handle, url: channelUrl })
                .select("id")
                .single();
              if (createError) throw createError;
              clientChannelId = created.id;
            }

            const { error: upsertError } = await db.from("meta_connections").upsert(
              {
                client_channel_id: clientChannelId,
                platform: "instagram",
                fb_page_id: page.id,
                fb_page_name: page.name,
                ig_business_account_id: ig.id,
                ig_username: ig.username ?? null,
                user_access_token: longLived.access_token,
                page_access_token: page.access_token,
                scopes: META_OAUTH_SCOPES,
                token_expires_at: expiresAt.toISOString(),
                status: "active",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "fb_page_id" },
            );
            if (upsertError) throw upsertError;
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${RETURN_PATH}?meta_connected=${pagesWithIg.length}`,
              "Set-Cookie": "meta_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
            },
          });
        } catch (err) {
          console.error("[meta oauth-callback]", err);
          return redirectWithError("exchange_failed");
        }
      },
    },
  },
});
