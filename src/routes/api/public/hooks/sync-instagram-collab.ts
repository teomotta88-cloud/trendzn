import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";

type IncomingPost = {
  shortcode: string;
  url: string;
  publishedAt?: string | null;
  collaborators: string[];
  raw?: unknown;
};

type IncomingRun = {
  postsFound?: number;
  newPosts?: number;
  collabsFound?: number;
  status?: "ok" | "error";
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
};

// Un collaboratore il cui username "contiene" o è "contenuto" nello username
// del profilo controllato (ripulito da punti/underscore) è quasi certamente
// un sotto-account dello stesso brand (es. "factanza" / "factanza.academy",
// visto in un post reale durante la fase diagnostica), non un vero collab
// con un influencer esterno: non va promosso a profilo monitorato, resta
// comunque salvato come collaboratore grezzo del post. Euristica
// approssimativa, da rivedere se emergono falsi positivi/negativi reali.
function looksLikeSameBrandFamily(ownerUsername: string, candidateUsername: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[._]/g, "");
  const a = clean(ownerUsername);
  const b = clean(candidateUsername);
  return a === b || a.includes(b) || b.includes(a);
}

export const Route = createFileRoute("/api/public/hooks/sync-instagram-collab")({
  server: {
    handlers: {
      // Lo script GitHub Actions (scripts/sync-instagram-collab.mjs) chiama
      // questa GET per sapere quali profili monitorati sono "dovuti" per un
      // check, in base al loro check_interval_minutes individuale — i profili
      // ad alta cadenza di pubblicazione vanno ricontrollati più spesso per
      // non perdere post tra un check e l'altro (vedi
      // supabase/migrations/20260727100000_instagram_collab_monitoring.sql).
      // Un cron frequente sullo script è innocuo: questa GET filtra da sola i
      // profili non ancora dovuti.
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: profiles, error } = await supabaseAdmin
            .from("instagram_monitored_profiles")
            .select("id, username, kind, industry, check_interval_minutes, last_checked_at")
            .eq("active", true);

          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

          const now = Date.now();
          const due = (profiles ?? []).filter((p) => {
            if (!p.last_checked_at) return true;
            const elapsedMinutes = (now - new Date(p.last_checked_at).getTime()) / 60000;
            return elapsedMinutes >= p.check_interval_minutes;
          });

          return Response.json({ ok: true, profiles: due });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },

      // Riceve i risultati del check di UN profilo (post trovati via
      // RSS-Bridge + collaboratori rilevati da
      // scripts/lib/instagram-collab-detector.mjs) e fa l'upsert: post,
      // collaboratori grezzi, nuovi profili influencer scoperti + relative
      // industry, storico esecuzione.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            profileId?: string;
            username?: string;
            posts?: IncomingPost[];
            run?: IncomingRun;
          };

          const profileId = body.profileId;
          const ownerUsername = body.username;
          const posts = Array.isArray(body.posts) ? body.posts : [];
          const run = body.run ?? {};

          if (!profileId || !ownerUsername) {
            return Response.json(
              { ok: false, error: "profileId e username sono obbligatori" },
              { status: 400 },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: profileRow } = await supabaseAdmin
            .from("instagram_monitored_profiles")
            .select("id, kind, industry, first_checked_at")
            .eq("id", profileId)
            .maybeSingle();

          // Conta i post davvero nuovi in questa run confrontando gli
          // shortcode già presenti PRIMA di fare l'upsert (più affidabile di
          // dedurlo dal risultato dell'upsert stesso).
          const shortcodes = posts.map((p) => p.shortcode);
          const { data: existingRows } =
            shortcodes.length > 0
              ? await supabaseAdmin
                  .from("instagram_posts")
                  .select("shortcode")
                  .in("shortcode", shortcodes)
              : { data: [] as { shortcode: string }[] };
          const existingShortcodes = new Set((existingRows ?? []).map((r) => r.shortcode));
          const newPostsCount = posts.filter((p) => !existingShortcodes.has(p.shortcode)).length;

          let collabsFoundCount = 0;
          const newInfluencerUsernames = new Set<string>();

          for (const post of posts) {
            const { data: postRow, error: postError } = await supabaseAdmin
              .from("instagram_posts")
              .upsert(
                {
                  shortcode: post.shortcode,
                  url: post.url,
                  owner_username: ownerUsername,
                  published_at: post.publishedAt ?? null,
                  discovered_via_profile_id: profileId,
                  raw: (post.raw ?? null) as Json,
                },
                { onConflict: "shortcode" },
              )
              .select("id")
              .single();

            if (postError || !postRow) continue;

            const collaborators = [...new Set(post.collaborators ?? [])];
            if (collaborators.length >= 2) collabsFoundCount++;

            if (collaborators.length > 0) {
              const collabRows = collaborators.map((username) => ({
                post_id: postRow.id,
                username,
              }));
              await supabaseAdmin
                .from("instagram_post_collaborators")
                .upsert(collabRows, { onConflict: "post_id,username", ignoreDuplicates: true });
            }

            for (const username of collaborators) {
              if (username === ownerUsername) continue;
              if (looksLikeSameBrandFamily(ownerUsername, username)) continue;
              newInfluencerUsernames.add(username);
            }
          }

          // Promuove i nuovi collaboratori a profili monitorati
          // (kind='influencer'), solo se non già presenti — non tocca
          // profili già monitorati (potrebbero già essere un brand, es. una
          // collab tra due brand clienti).
          for (const username of newInfluencerUsernames) {
            const { data: existing } = await supabaseAdmin
              .from("instagram_monitored_profiles")
              .select("id")
              .eq("username", username)
              .maybeSingle();

            if (!existing) {
              await supabaseAdmin.from("instagram_monitored_profiles").insert({
                username,
                kind: "influencer",
                discovered_via_profile_id: profileId,
              });
            }

            // L'industry si propaga solo se il profilo controllato è un
            // brand con industry assegnata: un influencer non ha
            // un'industry propria da propagare a un altro influencer con
            // cui collabora.
            if (profileRow?.kind === "brand" && profileRow.industry) {
              await supabaseAdmin
                .from("instagram_influencer_industries")
                .upsert(
                  { influencer_username: username, industry: profileRow.industry },
                  { onConflict: "influencer_username,industry", ignoreDuplicates: true },
                );
            }
          }

          const nowIso = new Date().toISOString();
          await supabaseAdmin
            .from("instagram_monitored_profiles")
            .update({
              last_checked_at: nowIso,
              first_checked_at: profileRow?.first_checked_at ?? nowIso,
            })
            .eq("id", profileId);

          await supabaseAdmin.from("instagram_monitoring_runs").insert({
            profile_id: profileId,
            posts_found: run.postsFound ?? posts.length,
            new_posts: run.newPosts ?? newPostsCount,
            collabs_found: run.collabsFound ?? collabsFoundCount,
            status: run.status ?? "ok",
            error_message: run.errorMessage ?? null,
            started_at: run.startedAt ?? nowIso,
            finished_at: run.finishedAt ?? nowIso,
          });

          return Response.json({
            ok: true,
            postsUpserted: posts.length,
            newPosts: newPostsCount,
            collabsFound: collabsFoundCount,
            newInfluencers: [...newInfluencerUsernames],
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
