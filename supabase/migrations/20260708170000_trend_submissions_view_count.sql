-- Views TikTok (best-effort, estratte durante lo scraping della pagina
-- hashtag da scripts/scrape-tiktok-hashtag.mjs) per i post già raccolti
-- dalla pipeline tiktok-hashtag — usate dal feed "Trend Virali" per
-- ordinare anche i contenuti TikTok per view reali, non solo Instagram.

alter table public.trend_submissions add column if not exists view_count bigint;
