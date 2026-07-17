-- Trend Virali: nuova fonte di discovery "x-trending" (x.com/explore/tabs/trending,
-- letta da account autenticato — vedi scripts/discover-x-trending.mjs). A
-- differenza di TikTok/Google Trends, X non fornisce qui alcun volume/conteggio
-- utilizzabile (solo rank + categoria mostrati in pagina): per richiesta
-- esplicita, questa fonte serve solo a scoprire hashtag/nomi da cercare su
-- Instagram con la pipeline già esistente (discover-instagram-hashtag-content.mjs),
-- non a tracciare crescita/volumi come le altre due fonti.
alter table public.monitored_topics drop constraint if exists monitored_topics_topic_type_check;
alter table public.monitored_topics
  add constraint monitored_topics_topic_type_check
  check (topic_type in ('tiktok-hashtag', 'google-trends', 'trending-audio', 'x-trending'));

-- Categoria mostrata da X accanto al trend (es. "Politics", "Sports") — solo
-- per topic_type='x-trending'; null se X non ne mostra una (i trend con solo
-- "Trending in Italy"/"Trending worldwide" non hanno una categoria reale).
alter table public.monitored_topics add column if not exists category text;

alter table public.viral_trend_content drop constraint if exists viral_trend_content_discovery_source_check;
alter table public.viral_trend_content
  add constraint viral_trend_content_discovery_source_check
  check (discovery_source in ('tiktok-hashtag', 'google-trends', 'trending-audio', 'x-trending'));
