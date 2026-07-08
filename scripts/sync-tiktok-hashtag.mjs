// Esegue lo scraping dell'hashtag TikTok e invia i nuovi URL (con le views,
// quando disponibili) all'endpoint server di Lovable
// (src/routes/api/public/hooks/sync-tiktok-hashtag.ts), che si occupa
// di scriverli su Supabase usando supabaseAdmin lato server.
//
// Variabile d'ambiente richiesta:
//   TIKTOK_HASHTAG  default "starhotels"
//
// Eseguito da .github/workflows/tiktok-hashtag.yml su schedule.

import { scrapeHashtag } from "./scrape-tiktok-hashtag.mjs";

const HASHTAG = process.env.TIKTOK_HASHTAG || "starhotels";
const SYNC_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/sync-tiktok-hashtag";

const posts = await scrapeHashtag(HASHTAG);
console.log(`Trovati ${posts.length} URL per #${HASHTAG}`);

if (posts.length > 0) {
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posts, hashtag: HASHTAG }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync endpoint failed: ${res.status} ${body}`);
  }

  const result = await res.json();
  console.log(`Sync completato: ${JSON.stringify(result)}`);
} else {
  console.log("Nessun URL trovato, nessuna richiesta inviata.");
}
