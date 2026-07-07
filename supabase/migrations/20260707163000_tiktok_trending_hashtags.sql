-- Classifica hashtag in trend su TikTok (da Creative Center), mostrata
-- come tabella prima del feed nella pagina "TikTok Trending Italia".
-- Ogni sync sovrascrive l'istantanea precedente per region+period_days
-- (delete + insert dallo stesso endpoint): la tabella riflette sempre
-- l'ultima rilevazione, non uno storico cumulativo.

create table public.tiktok_trending_hashtags (
  id uuid primary key default gen_random_uuid(),
  hashtag text not null,
  rank smallint,
  category text[] not null default '{}',
  post_count bigint,
  view_count bigint,
  trend_points jsonb,
  region text not null default 'IT',
  period_days smallint not null default 7,
  captured_at timestamptz not null default now(),
  raw jsonb
);

create index tiktok_trending_hashtags_rank_idx
  on public.tiktok_trending_hashtags (region, period_days, rank);

alter table public.tiktok_trending_hashtags enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.tiktok_trending_hashtags for all using (true) with check (true);
