-- Piano Editoriale: canali ufficiali del cliente ("Canali cliente") e post
-- pubblicati importati automaticamente da n8n, per il match con i post del
-- piano e il recupero automatico dell'URL pubblicato.

create table public.editorial_client_channels (
  id uuid primary key default gen_random_uuid(),
  canale text not null,
  handle text not null,
  url text not null,
  created_at timestamptz not null default now(),
  unique (canale, handle)
);

create index editorial_client_channels_canale_idx on public.editorial_client_channels (canale);

alter table public.editorial_client_channels enable row level security;

create policy "public full access" on public.editorial_client_channels for all using (true) with check (true);

create table public.editorial_published_posts (
  id uuid primary key default gen_random_uuid(),
  canale text not null,
  url text not null,
  published_date date not null,
  caption text,
  matched_post_id uuid references public.editorial_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (canale, url)
);

create index editorial_published_posts_canale_idx on public.editorial_published_posts (canale);
create index editorial_published_posts_matched_post_id_idx on public.editorial_published_posts (matched_post_id);

alter table public.editorial_published_posts enable row level security;

create policy "public full access" on public.editorial_published_posts for all using (true) with check (true);
