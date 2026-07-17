-- Trend Virali: nuova fonte di contenuti "canali-inspo" — post Instagram dei
-- Canali Inspo già raccolti da RSS-Bridge (trends.json), a cui applicare le
-- stesse regole di viralità degli altri contenuti (vedi
-- scripts/discover-canali-inspo-content.mjs), più il rilevamento di un trend
-- "cross-profilo" quando 3+ canali diversi pubblicano nello stesso periodo
-- sullo stesso argomento (cross_profile_topic/cross_profile_channel_count).
alter table public.viral_trend_content drop constraint if exists viral_trend_content_discovery_source_check;
alter table public.viral_trend_content
  add constraint viral_trend_content_discovery_source_check
  check (discovery_source in ('tiktok-hashtag', 'google-trends', 'trending-audio', 'x-trending', 'canali-inspo'));

-- Valorizzate solo per i post che fanno parte di un cluster cross-profilo
-- promosso a trend (vedi MIN_CROSS_PROFILE_CHANNELS in
-- discover-canali-inspo-content.mjs) — null per tutti gli altri contenuti,
-- comprese le altre fonti.
alter table public.viral_trend_content add column if not exists cross_profile_topic text;
alter table public.viral_trend_content add column if not exists cross_profile_channel_count integer;
