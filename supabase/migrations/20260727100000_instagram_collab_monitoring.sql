-- Monitoraggio collaborazioni Instagram: brand caricati manualmente, i loro
-- post vengono controllati periodicamente per rilevare collab (due o più
-- account co-autori dello stesso post — vedi euristica validata in
-- scripts/probe-instagram-collab.mjs). Ogni nuovo collaboratore trovato
-- entra in questa stessa tabella come profilo "influencer" da monitorare a
-- sua volta, con le industry dei brand con cui ha collaborato.
--
-- IMPORTANTE — accumulo nel tempo, non backfill "un colpo solo": né lo
-- scroll anonimo della pagina profilo (probe-instagram-profile-feed.mjs) né
-- RSS-Bridge (probe-instagram-rssbridge-collab.mjs — il bridge Instagram usa
-- GraphQL con "first":10 e nessun end_cursor/page_info, verificato sul
-- sorgente di InstagramBridge.php) permettono di risalire oltre gli ultimi
-- ~6-10 post di un profilo: quel cursore esiste solo per sessioni
-- autenticate. Un profilo appena aggiunto parte quindi con solo gli ultimi
-- post visibili; la storia più lunga (fino a un anno) si costruisce
-- accumulando i risultati dei check periodici nel tempo, non recuperandola
-- retroattivamente.

create table public.instagram_monitored_profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  kind text not null check (kind in ('brand', 'influencer')),
  -- valorizzata solo per kind='brand', assegnata a mano quando si carica il
  -- brand; per kind='influencer' le industry si trovano invece in
  -- instagram_influencer_industries (un influencer può collaborare con brand
  -- di industry diverse)
  industry text,
  display_name text,
  active boolean not null default true,
  -- ogni quanti minuti ricontrollare questo profilo: i profili ad alta
  -- cadenza di pubblicazione (es. più post/giorno) rischiano di far uscire
  -- post dalla finestra degli ultimi ~6-10 prima del prossimo check se
  -- l'intervallo è troppo lungo — va tarato per profilo, non un valore
  -- unico per tutti
  check_interval_minutes integer not null default 1440 check (check_interval_minutes > 0),
  first_checked_at timestamptz,
  last_checked_at timestamptz,
  -- valorizzato solo per kind='influencer': il brand la cui collab ha
  -- rivelato questo profilo per la prima volta
  discovered_via_profile_id uuid references public.instagram_monitored_profiles(id),
  created_at timestamptz not null default now()
);

create index instagram_monitored_profiles_kind_idx on public.instagram_monitored_profiles (kind);
-- per trovare velocemente "quali profili attivi sono da ricontrollare adesso"
create index instagram_monitored_profiles_active_last_checked_idx
  on public.instagram_monitored_profiles (active, last_checked_at);

create table public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  shortcode text not null unique,
  url text not null,
  owner_username text not null,
  caption text,
  published_at timestamptz,
  likes bigint,
  comments bigint,
  discovered_via_profile_id uuid references public.instagram_monitored_profiles(id),
  raw jsonb,
  created_at timestamptz not null default now()
);

create index instagram_posts_owner_username_idx on public.instagram_posts (owner_username);
create index instagram_posts_published_at_idx on public.instagram_posts (published_at desc);

create table public.instagram_post_collaborators (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.instagram_posts(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  unique (post_id, username)
);

create index instagram_post_collaborators_username_idx on public.instagram_post_collaborators (username);

create table public.instagram_influencer_industries (
  id uuid primary key default gen_random_uuid(),
  influencer_username text not null,
  industry text not null,
  first_seen_post_id uuid references public.instagram_posts(id),
  created_at timestamptz not null default now(),
  unique (influencer_username, industry)
);

create table public.instagram_monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.instagram_monitored_profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  posts_found integer not null default 0,
  new_posts integer not null default 0,
  collabs_found integer not null default 0,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index instagram_monitoring_runs_profile_started_idx
  on public.instagram_monitoring_runs (profile_id, started_at desc);

alter table public.instagram_monitored_profiles enable row level security;
alter table public.instagram_posts enable row level security;
alter table public.instagram_post_collaborators enable row level security;
alter table public.instagram_influencer_industries enable row level security;
alter table public.instagram_monitoring_runs enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.instagram_monitored_profiles for all using (true) with check (true);
create policy "public full access" on public.instagram_posts for all using (true) with check (true);
create policy "public full access" on public.instagram_post_collaborators for all using (true) with check (true);
create policy "public full access" on public.instagram_influencer_industries for all using (true) with check (true);
create policy "public full access" on public.instagram_monitoring_runs for all using (true) with check (true);
