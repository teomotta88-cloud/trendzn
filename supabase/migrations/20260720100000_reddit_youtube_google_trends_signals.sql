-- Trend Virali: prerequisito per tre nuove fonti di discovery/segnale
-- (Reddit, YouTube, Google Trends con magnitudine reale). Solo estensione
-- degli enum esistenti — nessuna tabella nuova, il modello
-- monitored_topics/topic_metrics_history/topic_signals è già generico per
-- piattaforma, come dimostrato dall'aggiunta precedente di x-trending.
--
-- Reddit e YouTube diventano fonti di *discovery* (nuovi topic_type, come
-- x-trending) e di *segnale nativo* (nuovi platform in topic_metrics_history/
-- topic_signals: upvote+commenti per Reddit, views per YouTube) — MA non
-- diventano piattaforme del feed contenuti (viral_trend_content.platform
-- resta invariato, ristretto a instagram/tiktok da
-- 20260708150000_viral_trend_content_allow_tiktok.sql: quella scelta di
-- prodotto non cambia qui). discovery_source va comunque esteso: un post
-- Instagram può essere stato scoperto perché il suo hashtag/keyword era in
-- trend su Reddit o YouTube, esattamente come già accade per x-trending.
--
-- google-trends come *platform* di topic_metrics_history/topic_signals è
-- nuovo (finora google-trends era solo un topic_type, senza serie storica
-- della propria magnitudine — solo presenza/assenza nel top-25 RSS): da qui
-- in poi può avere anche un proprio storico di interest-over-time reale,
-- accanto a instagram/tiktok/reddit/youtube.

alter table public.monitored_topics drop constraint if exists monitored_topics_topic_type_check;
alter table public.monitored_topics
  add constraint monitored_topics_topic_type_check
  check (topic_type in (
    'tiktok-hashtag', 'google-trends', 'trending-audio', 'x-trending',
    'reddit-trending', 'youtube-trending'
  ));

alter table public.topic_metrics_history drop constraint if exists topic_metrics_history_platform_check;
alter table public.topic_metrics_history
  add constraint topic_metrics_history_platform_check
  check (platform in ('tiktok', 'instagram', 'reddit', 'youtube', 'google-trends'));

alter table public.topic_signals drop constraint if exists topic_signals_platform_check;
alter table public.topic_signals
  add constraint topic_signals_platform_check
  check (platform in ('tiktok', 'instagram', 'reddit', 'youtube', 'google-trends'));

alter table public.viral_trend_content drop constraint if exists viral_trend_content_discovery_source_check;
alter table public.viral_trend_content
  add constraint viral_trend_content_discovery_source_check
  check (discovery_source in (
    'tiktok-hashtag', 'google-trends', 'trending-audio', 'x-trending',
    'reddit-trending', 'youtube-trending', 'canali-inspo'
  ));
