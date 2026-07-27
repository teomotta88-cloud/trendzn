// Worker di sync per il monitoraggio collab Instagram (Fase 3 del piano):
// per ogni profilo monitorato "dovuto" per un check (in base al suo
// check_interval_minutes, vedi
// supabase/migrations/20260727100000_instagram_collab_monitoring.sql),
// recupera i post recenti via RSS-Bridge e rileva i collaboratori su
// ciascuno, poi invia il risultato all'hook sync-instagram-collab, che fa
// l'upsert su Supabase (stesso pattern di sync-brand-mentions.mjs: script
// esterno -> hook pubblico -> supabaseAdmin, così lo script non deve
// conoscere la service role key).
//
// Eseguito da .github/workflows/sync-instagram-collab.yml su schedule. Un
// cron frequente è innocuo: la GET dell'hook restituisce solo i profili
// effettivamente dovuti in base al loro intervallo, gli altri vengono
// saltati senza consumare risorse.
//
// ATTENZIONE — accumulo nel tempo, non backfill: né lo scroll anonimo del
// profilo né RSS-Bridge (verificato sul sorgente di InstagramBridge.php)
// permettono di risalire oltre gli ultimi ~6-10 post di un account. Ogni
// run vede solo la finestra più recente; la storia più lunga si costruisce
// accumulando i risultati delle run successive.

import { chromium } from "playwright";
import { fetchRecentPosts } from "./lib/instagram-rssbridge-feed.mjs";
import { detectCollaborators } from "./lib/instagram-collab-detector.mjs";
import { fetchProfileStats } from "./lib/instagram-profile-stats.mjs";

const HOOK_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-instagram-collab";

// Timeout esplicito: senza, una richiesta bloccata (hook lento/non
// risponde) fa restare lo script in attesa fino al timeout dell'intero job
// (20 minuti, vedi .github/workflows/sync-instagram-collab.yml) invece di
// fallire in modo leggibile — stessa prudenza già usata per RSS-Bridge in
// scripts/lib/instagram-rssbridge-feed.mjs.
const HOOK_TIMEOUT_MS = 20000;

async function callHook(init) {
  const res = await fetch(HOOK_ENDPOINT, { ...init, signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) });
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  return { res, body, text };
}

async function fetchDueProfiles() {
  const { res, body, text } = await callHook();
  if (!res.ok || !body?.ok) {
    throw new Error(`GET profili dovuti fallita (${res.status}): ${body?.error ?? text}`);
  }
  return body.profiles ?? [];
}

async function sendResults(payload) {
  const { res, body, text } = await callHook({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !body?.ok) {
    throw new Error(`POST risultati fallita (${res.status}): ${body?.error ?? text}`);
  }
  return body;
}

async function checkProfile(context, profile) {
  const startedAt = new Date().toISOString();
  console.log(`\n[${profile.username}] check in corso...`);

  const { posts: feedPosts, error: feedError } = await fetchRecentPosts(profile.username);
  if (feedError) throw new Error(`RSS-Bridge: ${feedError}`);

  console.log(`  ${feedPosts.length} post trovati nel feed`);

  const posts = [];
  for (const feedPost of feedPosts) {
    const page = await context.newPage();
    try {
      await page.goto(feedPost.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);

      const { collaborators, reason } = await detectCollaborators(page);
      if (reason) {
        console.log(`  ${feedPost.url}: ${reason}, salto`);
        continue;
      }

      posts.push({
        shortcode: feedPost.shortcode,
        url: feedPost.url,
        publishedAt: feedPost.publishedAt,
        collaborators,
      });
    } catch (err) {
      console.log(`  ${feedPost.url}: errore (${String(err).slice(0, 150)}), salto`);
    } finally {
      await page.close();
    }
  }

  const collabsFound = posts.filter((p) => p.collaborators.length >= 2).length;
  console.log(`  ${posts.length} post analizzati, ${collabsFound} in collab`);

  const { stats: profileStats, reason: profileStatsReason } = await fetchProfileStats(
    profile.username,
  );
  if (profileStatsReason) {
    console.log(`  Follower/foto profilo non recuperati: ${profileStatsReason}`);
  }

  const result = await sendResults({
    profileId: profile.id,
    username: profile.username,
    posts,
    followersCount: profileStats?.followersCount ?? null,
    profilePicUrl: profileStats?.profilePicUrl ?? null,
    run: {
      postsFound: posts.length,
      collabsFound,
      status: "ok",
      startedAt,
      finishedAt: new Date().toISOString(),
    },
  });

  console.log(
    `  Nuovi influencer scoperti: ${(result.newInfluencers ?? []).join(", ") || "nessuno"}`,
  );
}

// --- Main ---
console.log("=== TRENDZN — Monitoraggio collab Instagram ===");

const profiles = await fetchDueProfiles();
console.log(`Profili da controllare in questa run: ${profiles.length}`);

if (profiles.length === 0) {
  console.log("Nessun profilo dovuto per un check ora.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

try {
  for (const profile of profiles) {
    try {
      await checkProfile(context, profile);
    } catch (err) {
      console.error(`[${profile.username}] ERRORE: ${String(err)}`);
      await sendResults({
        profileId: profile.id,
        username: profile.username,
        posts: [],
        run: {
          status: "error",
          errorMessage: String(err).slice(0, 500),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      }).catch(() => {});
    }
  }
} finally {
  await browser.close();
}

console.log("\nFatto.");
