import { createFileRoute } from "@tanstack/react-router";

// Riceve i post scoperti/dettagliati da scripts/sync-bluserena-hashtags.mjs
// e li scrive su bluserena_hashtag_posts usando supabaseAdmin, così lo
// script esterno non deve conoscere la service role key — stesso pattern di
// sync-brand-mentions.ts.
//
// Un unico hook serve sia la Passata A (scoperta: solo url/tag/piattaforma,
// eventualmente views) sia la Passata B (dettaglio: autore/data/caption/
// geotag + detailStatus 'ok'/'failed') dello script: upsert su
// (platform, url), aggiornando solo i campi effettivamente forniti (mai
// sovrascrivere un valore già noto con null solo perché questa chiamata non
// lo conosce). detailStatus 'ok'/'failed' incrementa detail_attempt_count e
// aggiorna detail_last_attempt_at — è quello che alimenta la coda di retry
// letta da list-bluserena-hashtag-pending.ts.

type DetailStatus = "ok" | "failed";

type IncomingPost = {
  hashtagUrl: string;
  platform: "instagram" | "tiktok" | "x";
  tag: string;
  url: string;
  author?: string | null;
  publishedAt?: string | null;
  caption?: string | null;
  location?: string | null;
  views?: number | null;
  detailStatus?: DetailStatus;
  detailFailReason?: string | null;
};

export const Route = createFileRoute("/api/public/hooks/sync-bluserena-hashtag-posts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { posts?: IncomingPost[] };
          const posts = Array.isArray(body.posts) ? body.posts : [];
          const valid = posts.filter((p) => p?.hashtagUrl && p?.platform && p?.tag && p?.url);

          if (valid.length === 0) {
            return Response.json({ ok: true, upserted: 0 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Stessa ragione del dedup in sync-brand-mentions.ts: un batch con
          // (platform, url) duplicati fa fallire l'intero upsert ("ON
          // CONFLICT DO UPDATE command cannot affect row a second time").
          const dedupedByKey = new Map<string, IncomingPost>();
          for (const p of valid) dedupedByKey.set(`${p.platform}:${p.url}`, p);

          // detail_attempt_count va incrementato, non sovrascritto: legge il
          // valore attuale delle sole righe con detailStatus (Passata B) —
          // per la Passata A (la maggioranza delle chiamate, solo scoperta)
          // questa select è saltata del tutto. Non perfettamente atomico
          // sotto scritture concorrenti, accettabile: questo hook ha un solo
          // chiamante alla volta (il job GitHub Actions), non serve una RPC
          // dedicata solo per un contatore di retry.
          const detailPosts = [...dedupedByKey.values()].filter(
            (p) => p.detailStatus !== undefined,
          );
          const attemptCounts = new Map<string, number>();
          if (detailPosts.length > 0) {
            const urls = detailPosts.map((p) => p.url);
            const { data: existing } = await supabaseAdmin
              .from("bluserena_hashtag_posts")
              .select("platform, url, detail_attempt_count")
              .in("url", urls);
            for (const row of existing ?? []) {
              attemptCounts.set(`${row.platform}:${row.url}`, row.detail_attempt_count ?? 0);
            }
          }

          const now = new Date().toISOString();

          const rows = [...dedupedByKey.values()].map((p) => {
            const row: Record<string, unknown> = {
              hashtag_url: p.hashtagUrl,
              platform: p.platform,
              tag: p.tag,
              url: p.url,
              updated_at: now,
            };
            if (p.author !== undefined) row.author = p.author;
            if (p.publishedAt !== undefined) row.published_at = p.publishedAt;
            if (p.caption !== undefined) row.caption = p.caption;
            if (p.location !== undefined) row.location = p.location;
            if (p.views !== undefined) row.views = p.views;
            if (p.detailStatus !== undefined) {
              row.detail_status = p.detailStatus;
              row.detail_last_attempt_at = now;
              row.detail_attempt_count = (attemptCounts.get(`${p.platform}:${p.url}`) ?? 0) + 1;
              if (p.detailFailReason !== undefined) row.detail_fail_reason = p.detailFailReason;
            }
            return row;
          });

          // upsert() con onConflict aggiorna SOLO le colonne presenti nella
          // riga inviata (comportamento nativo di Postgres ON CONFLICT DO
          // UPDATE SET col = excluded.col per le colonne elencate): i campi
          // omessi qui sopra non vengono toccati sulla riga esistente, quindi
          // la Passata A (record minimo) non cancella mai dati già scritti
          // dalla Passata B di un giro precedente.
          const { data, error } = await supabaseAdmin
            .from("bluserena_hashtag_posts")
            .upsert(rows, { onConflict: "platform,url" })
            .select("id");

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, upserted: data?.length ?? 0 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
