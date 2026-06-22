-- Piano Editoriale: visual multipli e ordinabili per ogni post.

create table public.editorial_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.editorial_posts(id) on delete cascade,
  url text not null,
  type text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index editorial_post_media_post_id_idx on public.editorial_post_media (post_id);

alter table public.editorial_post_media enable row level security;

create policy "public full access" on public.editorial_post_media for all using (true) with check (true);

-- Porta i visual già caricati (colonna singola) nella nuova tabella, così non si perde nulla.
insert into public.editorial_post_media (post_id, url, type, position)
select id, visual_url, visual_type, 0
from public.editorial_posts
where visual_url is not null;
