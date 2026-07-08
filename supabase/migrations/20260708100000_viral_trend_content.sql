-- Trend Virali: contenuti reali (non hashtag) trovati cercando, su
-- Twitter/X, Reddit, Instagram, LinkedIn (anysite) e YouTube, la keyword
-- ottenuta trasformando ogni hashtag TikTok in trend (es. #empirestatebuilding
-- -> "Empire State Building") tramite Claude. Riusa la stessa logica di
-- ricerca/normalizzazione di brand_mentions ma senza sentiment/crisis-alert,
-- che non hanno senso per keyword generiche non legate a un brand.

create table public.viral_trend_content (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('twitter', 'reddit', 'instagram', 'youtube', 'linkedin')),
  external_id text not null,
  url text not null,
  author text,
  content text,
  published_at timestamptz,
  source_hashtag text not null,
  keyword_matched text not null,
  engagement bigint not null default 0,
  reach bigint,
  is_viral boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

create index viral_trend_content_reach_idx on public.viral_trend_content (reach desc nulls last);
create index viral_trend_content_engagement_idx on public.viral_trend_content (engagement desc);
create index viral_trend_content_source_hashtag_idx on public.viral_trend_content (source_hashtag);

create table public.viral_trend_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_hashtag text,
  keyword_matched text,
  platform text,
  requests_used integer not null default 0,
  content_found integer not null default 0,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index viral_trend_runs_started_at_idx on public.viral_trend_runs (started_at desc);

alter table public.viral_trend_content enable row level security;
alter table public.viral_trend_runs enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.viral_trend_content for all using (true) with check (true);
create policy "public full access" on public.viral_trend_runs for all using (true) with check (true);
