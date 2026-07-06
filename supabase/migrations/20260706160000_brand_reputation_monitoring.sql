-- Reputazione Brand: monitoraggio menzioni e sentiment del brand su
-- Twitter/X, Reddit, Instagram, YouTube, LinkedIn (via anysite REST API),
-- con storico run e alert di crisi (soglie Level 1-4).

create table public.brand_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique,
  platforms text[] not null default '{}', -- vuoto = tutte le piattaforme
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.brand_mentions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('twitter', 'reddit', 'instagram', 'youtube', 'linkedin')),
  external_id text not null,
  url text not null,
  author text,
  content text,
  published_at timestamptz,
  keyword_matched text not null,
  sentiment text not null check (sentiment in ('positive', 'negative', 'neutral')),
  category text,
  engagement bigint not null default 0,
  reach bigint,
  is_viral boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

create index brand_mentions_platform_published_at_idx on public.brand_mentions (platform, published_at desc);
create index brand_mentions_sentiment_idx on public.brand_mentions (sentiment);

create table public.brand_monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  platform text,
  keyword text,
  requests_used integer not null default 0,
  mentions_found integer not null default 0,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index brand_monitoring_runs_started_at_idx on public.brand_monitoring_runs (started_at desc);

create table public.brand_sentiment_alerts (
  id uuid primary key default gen_random_uuid(),
  level smallint not null check (level between 1 and 4),
  platform text,
  reason text not null,
  metrics jsonb,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index brand_sentiment_alerts_unresolved_idx on public.brand_sentiment_alerts (triggered_at desc) where resolved_at is null;

alter table public.brand_keywords enable row level security;
alter table public.brand_mentions enable row level security;
alter table public.brand_monitoring_runs enable row level security;
alter table public.brand_sentiment_alerts enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.brand_keywords for all using (true) with check (true);
create policy "public full access" on public.brand_mentions for all using (true) with check (true);
create policy "public full access" on public.brand_monitoring_runs for all using (true) with check (true);
create policy "public full access" on public.brand_sentiment_alerts for all using (true) with check (true);

insert into public.brand_keywords (keyword) values ('hyundai'), ('hyundai_italia')
on conflict (keyword) do nothing;
