-- "Trend Virali v2": ciclo di vita di monitoraggio per hashtag TikTok e
-- keyword Google Trends. Finora ogni sync di sync-viral-trends.mjs cercava
-- SEMPRE i top-5 del momento, senza nessuna nozione di "questo topic è
-- ancora rilevante" — un hashtag che esce dai primi 5 smetteva di essere
-- cercato dal giorno successivo, senza un periodo di transizione.
--
-- monitored_topics traccia ogni hashtag/keyword scoperto nei top-5 (TikTok
-- o Google Trends) e per quanto tempo va ancora monitorato: resta 'active'
-- finché è nei top-5, poi per altre 24h dall'ultima volta vista in classifica
-- (monitoring_stops_at = last_seen_in_top5_at + 24h, ricalcolato ogni volta
-- che il topic rientra nei top-5), poi passa a 'expired'.
--
-- topic_type include già 'trending-audio' in previsione del monitoraggio
-- audio (predisposizione, non ancora implementato: nessuna discovery
-- automatica di audio in trend esiste ancora, solo lo schema pronto a
-- riceverla in futuro).
create table public.monitored_topics (
  id uuid primary key default gen_random_uuid(),
  topic_type text not null check (topic_type in ('tiktok-hashtag', 'google-trends', 'trending-audio')),
  -- hashtag TikTok (senza #) o frase Google Trends in linguaggio naturale o
  -- id/url dell'audio, a seconda di topic_type.
  value text not null,
  -- Google Trends: hashtag derivato dalla keyword (slugify, vedi
  -- keywordToHashtag in scripts/lib/word-segment.mjs) per poter usare anche
  -- la discovery gratuita via pagina hashtag. Null per tiktok-hashtag (value
  -- è già l'hashtag) e per trending-audio (non applicabile).
  derived_hashtag text,
  -- tiktok-hashtag: keyword ricavata dall'hashtag (OpenRouter o fallback
  -- offline, vedi hashtagsToKeywords in sync-viral-trends.mjs), usata per la
  -- ricerca anysite. Null per google-trends (value è già la keyword) e per
  -- trending-audio.
  derived_keyword text,
  first_seen_in_top5_at timestamptz not null default now(),
  last_seen_in_top5_at timestamptz not null default now(),
  monitoring_stops_at timestamptz not null default (now() + interval '24 hours'),
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_type, value)
);

create index monitored_topics_status_idx on public.monitored_topics (status, monitoring_stops_at);
create index monitored_topics_type_idx on public.monitored_topics (topic_type, status);

-- Uno snapshot per ogni ricontrollo di un topic monitorato: serve a
-- calcolare il tasso di crescita di volumi/engagement nel tempo (vedi
-- Fase 6 del piano). platform distingue le fonti perché non sono
-- confrontabili tra loro: TikTok (Creative Center) dà un conteggio totale
-- reale, Instagram (pagina hashtag gratuita) solo un campione approssimato
-- (~12-20 post recenti, mai il vero totale) — is_volume_exact lo segnala
-- esplicitamente per non trattarli come lo stesso tipo di dato in UI o nella
-- formula di crescita.
create table public.topic_metrics_history (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.monitored_topics (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  content_volume bigint,
  is_volume_exact boolean not null default false,
  total_engagement bigint,
  captured_at timestamptz not null default now()
);

create index topic_metrics_history_topic_platform_captured_idx
  on public.topic_metrics_history (topic_id, platform, captured_at);

-- Collega ogni contenuto scoperto al topic che lo ha portato alla luce,
-- invece del solo match testuale su source_hashtag/keyword_matched (fragile
-- su maiuscole/accenti/derivazioni). Nullable: righe già esistenti e righe
-- scoperte da flussi non ancora collegati (Fase 2/4/5) non ce l'hanno.
alter table public.viral_trend_content
  add column topic_id uuid references public.monitored_topics (id) on delete set null;

create index viral_trend_content_topic_id_idx on public.viral_trend_content (topic_id);

-- Predisposizione audio (Fase 9): discovery_source deve poter distinguere
-- anche questa fonte quando verrà implementata.
alter table public.viral_trend_content drop constraint if exists viral_trend_content_discovery_source_check;
alter table public.viral_trend_content
  add constraint viral_trend_content_discovery_source_check
  check (discovery_source in ('tiktok-hashtag', 'google-trends', 'trending-audio'));

alter table public.monitored_topics enable row level security;
alter table public.topic_metrics_history enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.monitored_topics for all using (true) with check (true);
create policy "public full access" on public.topic_metrics_history for all using (true) with check (true);
