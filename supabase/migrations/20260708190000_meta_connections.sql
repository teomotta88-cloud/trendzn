-- Connessioni OAuth ufficiali Meta (Facebook Login for Business) per i canali
-- cliente di Piano Editoriale: sostituisce, per i canali collegati, lo
-- scraping RSS-Bridge + il matching euristico per similarità del copy in
-- editorial_published_posts con letture dirette da Instagram Graph API
-- (post reali + insights reali).
--
-- SICUREZZA: questa tabella contiene access token OAuth. A differenza delle
-- altre tabelle editorial_* NON ha una policy "public full access": nessuna
-- policy = accesso negato di default a anon/authenticated, raggiungibile solo
-- da supabaseAdmin (service role, bypassa RLS) nelle server route.
create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  client_channel_id uuid references public.editorial_client_channels(id) on delete cascade,
  platform text not null default 'instagram' check (platform in ('instagram', 'facebook')),
  fb_page_id text not null,
  fb_page_name text,
  ig_business_account_id text,
  ig_username text,
  -- Token utente long-lived (60gg): usato solo per il refresh periodico e
  -- per ri-derivare il page token, mai per chiamate dirette alla Graph API.
  user_access_token text not null,
  -- Page access token: usato per le chiamate a {ig-business-account-id}/media
  -- e insights.
  page_access_token text not null,
  scopes text[] not null default '{}',
  token_expires_at timestamptz not null,
  -- 'needs_reauth': il refresh del token utente è fallito (es. cliente ha
  -- revocato l'accesso, o i 60gg sono scaduti senza refresh) — il canale
  -- resta visibile ma va ricollegato dal cliente.
  status text not null default 'active' check (status in ('active', 'needs_reauth')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fb_page_id)
);

create index meta_connections_client_channel_id_idx on public.meta_connections (client_channel_id);
create index meta_connections_status_idx on public.meta_connections (status);

alter table public.meta_connections enable row level security;

-- Nessuna riga sincronizzata da fonti non ufficiali (n8n/RSS-Bridge) traccia
-- l'origine: aggiungiamo campi per i post/insights reali da Graph API, così
-- l'UI può distinguere "dato reale" da "matchato per similarità testo".
alter table public.editorial_published_posts
  add column external_id text,
  add column like_count integer,
  add column comments_count integer,
  add column impressions integer,
  add column reach integer,
  add column source text not null default 'n8n' check (source in ('n8n', 'meta_api'));
