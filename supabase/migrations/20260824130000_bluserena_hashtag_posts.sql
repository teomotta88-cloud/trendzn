-- Storage persistente per i post scoperti dagli hashtag monitorati su
-- Bluserena-monitoring (Instagram/TikTok/X, vedi
-- scripts/sync-bluserena-hashtags.mjs) — sostituisce la scrittura dei post
-- dentro bluserena-monitoring.json (un file git non supporta retry
-- persistente per-post, query/filtri, o aggiornamenti senza commit).
--
-- Il file JSON resta la fonte per la LISTA degli hashtag da monitorare
-- (config): ogni riga qui si collega al suo hashtag tramite hashtag_url
-- (= canale.urls[0] nel JSON), non un id numerico — stesso accoppiamento
-- debole già usato altrove nel progetto tra JSON e Supabase (vedi
-- trend_submissions.section).
create table if not exists public.bluserena_hashtag_posts (
  id uuid primary key default gen_random_uuid(),
  hashtag_url text not null,
  platform text not null check (platform in ('instagram', 'tiktok', 'x')),
  tag text not null,
  url text not null,
  author text,
  published_at timestamptz,
  caption text,
  -- Geotag (nome del luogo) — Instagram e TikTok, mai X (nessun campo di
  -- geolocalizzazione confermato in rettiwt-api, vedi sync-bluserena-hashtags.mjs).
  location text,
  views bigint,

  -- Fase 2 (analisi LLM, non ancora implementata): tutti e tre null finché
  -- il post non viene classificato.
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  sentiment_source text check (sentiment_source in ('llm', 'manual')),
  topic text,

  -- Coda di retry: un post "pending" o "failed" viene riproposto dalla
  -- prossima run (vedi list-bluserena-hashtag-pending.ts) finché non
  -- raggiunge 'ok' o supera il tetto di tentativi (5, applicato lato query,
  -- non qui) — copre esplicitamente il caso login-wall Instagram/TikTok,
  -- che è best-effort e può richiedere più di un tentativo.
  detail_status text not null default 'pending' check (detail_status in ('pending', 'ok', 'failed')),
  detail_attempt_count integer not null default 0,
  detail_last_attempt_at timestamptz,
  detail_fail_reason text,

  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (platform, url)
);

create index if not exists bluserena_hashtag_posts_hashtag_idx
  on public.bluserena_hashtag_posts (hashtag_url, platform);

create index if not exists bluserena_hashtag_posts_pending_idx
  on public.bluserena_hashtag_posts (detail_status, detail_attempt_count);

create index if not exists bluserena_hashtag_posts_published_at_idx
  on public.bluserena_hashtag_posts (published_at);

-- Stesso modello di accesso già usato per brand_mentions e le altre tabelle
-- pubbliche di questo progetto (nessuna autenticazione utente): scrittura
-- solo dagli hook server (supabaseAdmin, bypassa comunque RLS), lettura
-- pubblica per la UI (bluserena-monitoring.$id.tsx).
alter table public.bluserena_hashtag_posts enable row level security;
create policy "public full access" on public.bluserena_hashtag_posts for all using (true) with check (true);
