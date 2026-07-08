-- Il feed "Trend Virali" deve contenere solo Instagram e TikTok (non più
-- Twitter/Reddit/LinkedIn/YouTube): TikTok va aggiunto al vincolo CHECK
-- sulla piattaforma, assente dalla migration originale perché anysite non
-- supporta la ricerca TikTok (i contenuti TikTok arrivano da una fonte
-- diversa, senza engagement/views — vedi scripts/sync-viral-trends.mjs).

alter table public.viral_trend_content drop constraint if exists viral_trend_content_platform_check;
alter table public.viral_trend_content
  add constraint viral_trend_content_platform_check
  check (platform in ('twitter', 'reddit', 'instagram', 'youtube', 'linkedin', 'tiktok'));
