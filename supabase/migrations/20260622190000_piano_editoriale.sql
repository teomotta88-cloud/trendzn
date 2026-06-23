-- Piano Editoriale: calendario mensile di post (copy / copy visual / visual)
-- con approvazioni e commenti anonimi (nessun login) per ogni componente.

create table public.editorial_plans (
  id uuid primary key default gen_random_uuid(),
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  created_at timestamptz not null default now(),
  unique (year, month)
);

create table public.editorial_posts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.editorial_plans(id) on delete cascade,
  post_date date not null,
  rubrica text,
  topic text,
  canale text,
  formato text,
  copy text,
  copy_visual text,
  visual_url text,
  visual_type text,
  disclaimer text,
  obiettivo_media text,
  budget_media numeric,
  created_at timestamptz not null default now()
);

create index editorial_posts_plan_id_idx on public.editorial_posts (plan_id);

create table public.editorial_post_approvals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.editorial_posts(id) on delete cascade,
  component text not null check (component in ('copy', 'copy_visual', 'visual')),
  created_at timestamptz not null default now()
);

create index editorial_post_approvals_post_id_idx on public.editorial_post_approvals (post_id);

create table public.editorial_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.editorial_posts(id) on delete cascade,
  component text not null check (component in ('copy', 'copy_visual', 'visual')),
  body text not null,
  created_at timestamptz not null default now()
);

create index editorial_post_comments_post_id_idx on public.editorial_post_comments (post_id);

alter table public.editorial_plans enable row level security;
alter table public.editorial_posts enable row level security;
alter table public.editorial_post_approvals enable row level security;
alter table public.editorial_post_comments enable row level security;

-- Sezione senza login: accesso pubblico in lettura/scrittura, come le altre
-- sezioni "anonime" già esistenti in trendzn (es. canali-inspo via email).
create policy "public full access" on public.editorial_plans for all using (true) with check (true);
create policy "public full access" on public.editorial_posts for all using (true) with check (true);
create policy "public full access" on public.editorial_post_approvals for all using (true) with check (true);
create policy "public full access" on public.editorial_post_comments for all using (true) with check (true);

-- Bucket pubblico per i visual (jpeg/png/mp4) caricati manualmente dall'utente.
insert into storage.buckets (id, name, public)
values ('piano-editoriale', 'piano-editoriale', true)
on conflict (id) do nothing;

create policy "piano-editoriale public read" on storage.objects
  for select using (bucket_id = 'piano-editoriale');

create policy "piano-editoriale public insert" on storage.objects
  for insert with check (bucket_id = 'piano-editoriale');

create policy "piano-editoriale public update" on storage.objects
  for update using (bucket_id = 'piano-editoriale');

create policy "piano-editoriale public delete" on storage.objects
  for delete using (bucket_id = 'piano-editoriale');
