// Esegue lo scraping dell'hashtag TikTok e carica i nuovi post su Supabase
// nella tabella trend_submissions (section="tiktok-hashtag", status="approved").
//
// Variabili d'ambiente richieste:
//   SUPABASE_URL              es. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY service role key (bypassa RLS, mai esporla al client)
//   TIKTOK_HASHTAG            default "starhotels"
//
// Eseguito da .github/workflows/tiktok-hashtag.yml su schedule.

import { scrapeHashtag } from "./scrape-tiktok-hashtag.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HASHTAG = process.env.TIKTOK_HASHTAG || "starhotels";
const SECTION = "tiktok-hashtag";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY nell'ambiente.");
  process.exit(1);
}

async function insertNewUrls(urls) {
  if (urls.length === 0) return { inserted: 0 };

  const rows = urls.map((url) => ({
    url,
    section: SECTION,
    category: "TikTok Hashtag",
    tags: [HASHTAG],
    status: "approved",
    submitted_by: "tiktok-hashtag-scraper",
  }));

  // Richiede un vincolo UNIQUE su trend_submissions.url (vedi migration
  // 20260619120000_unique_url_trend_submissions.sql). Con questo header,
  // Postgres ignora silenziosamente le righe già esistenti invece di fallire.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trend_submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${body}`);
  }

  return { inserted: rows.length };
}

const urls = await scrapeHashtag(HASHTAG);
console.log(`Trovati ${urls.length} URL per #${HASHTAG}`);

const { inserted } = await insertNewUrls(urls);
console.log(`Inviati ${inserted} URL a Supabase (i duplicati esistenti vengono ignorati).`);
