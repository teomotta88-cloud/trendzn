-- SBAM AutoGraphics: generazione automatica delle grafiche dei post del
-- Piano Editoriale a partire da template Figma preimpostati per rubrica,
-- con foto stock Getty Images dove previsto dal tipo di template.
--
-- Nota su "rubriche": editorial_posts.rubrica resta un campo testo libero
-- (categorie editoriali generiche, non tutte generano grafiche automatiche).
-- La nuova tabella rubriche è invece la configurazione strutturata usata
-- solo dalla pipeline AutoGraphics (template Figma, formati, vincoli).
-- Nessun concetto di cliente/tenant: coerente col resto di trendzn, un
-- deployment = un cliente implicito.

create table public.rubriche (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tipo_template text not null check (tipo_template in ('photo_card', 'text_icon_card')),
  figma_file_key text not null,
  figma_component_id text not null,
  attiva boolean not null default true,
  created_at timestamptz not null default now()
);

-- Formati di export richiesti per rubrica (es. feed 1:1, feed 4:5, story
-- 9:16, e altri definiti in Figma). Ogni formato può puntare a un component
-- Figma diverso (variante di formato) tramite figma_component_id; se nullo,
-- il plugin usa il component base della rubrica e lo ridimensiona.
create table public.rubrica_formati (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references public.rubriche(id) on delete cascade,
  formato text not null,
  figma_component_id text,
  width_px integer not null,
  height_px integer not null,
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (rubrica_id, formato)
);

create index rubrica_formati_rubrica_id_idx on public.rubrica_formati (rubrica_id);

-- Vincoli di caratteri/font per ciascun layer dinamico (#title, #body,
-- #photo, #icon, ...) del template di una rubrica. Usati sia dal frontend
-- (contatori live in fase di composizione) sia dal plugin Figma (ultima
-- linea di difesa anti-overflow prima del render).
create table public.template_constraints (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references public.rubriche(id) on delete cascade,
  layer_name text not null,
  max_chars integer,
  min_font_size numeric,
  max_font_size numeric,
  max_lines integer,
  obbligatorio boolean not null default true,
  created_at timestamptz not null default now(),
  unique (rubrica_id, layer_name)
);

create index template_constraints_rubrica_id_idx on public.template_constraints (rubrica_id);

-- Un job per post: raccoglie il copy validato e (se photo_card) la foto
-- Getty selezionata. Il render vero e proprio è per formato, vedi
-- graphic_job_formats sotto.
create table public.graphic_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.editorial_posts(id) on delete cascade,
  rubrica_id uuid not null references public.rubriche(id),
  copy_payload jsonb not null default '{}'::jsonb,
  getty_asset_id text,
  getty_image_url text,
  status text not null default 'pending_validation'
    check (status in ('pending_validation', 'pending_image', 'ready_for_render', 'rendering', 'done', 'error')),
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index graphic_jobs_post_id_idx on public.graphic_jobs (post_id);
create index graphic_jobs_status_idx on public.graphic_jobs (status);

-- Un render per formato richiesto dalla rubrica (snapshot di
-- rubrica_formati al momento dell'approvazione, così una modifica futura
-- ai formati non cambia job già in coda/completati).
create table public.graphic_job_formats (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.graphic_jobs(id) on delete cascade,
  formato text not null,
  figma_component_id text,
  width_px integer,
  height_px integer,
  status text not null default 'pending' check (status in ('pending', 'rendering', 'done', 'error')),
  output_url text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, formato)
);

create index graphic_job_formats_job_id_idx on public.graphic_job_formats (job_id);

-- Candidati Getty proposti per un job photo_card (top 6 da getty-search).
-- Il download che consuma la licenza avviene solo dopo che l'utente ha
-- messo selected = true su una riga.
create table public.getty_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.graphic_jobs(id) on delete cascade,
  asset_id text not null,
  preview_url text not null,
  title text,
  orientamento text,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

create index getty_candidates_job_id_idx on public.getty_candidates (job_id);

-- Collega opzionalmente un post a una rubrica AutoGraphics strutturata.
-- Il campo editorial_posts.rubrica (testo libero) resta invariato.
alter table public.editorial_posts
  add column rubrica_id uuid references public.rubriche(id) on delete set null;

create index editorial_posts_rubrica_id_idx on public.editorial_posts (rubrica_id);

alter table public.rubriche enable row level security;
alter table public.rubrica_formati enable row level security;
alter table public.template_constraints enable row level security;
alter table public.graphic_jobs enable row level security;
alter table public.graphic_job_formats enable row level security;
alter table public.getty_candidates enable row level security;

-- Stesso pattern di accesso pubblico del resto di Piano Editoriale
-- (nessun login nel progetto).
create policy "public full access" on public.rubriche for all using (true) with check (true);
create policy "public full access" on public.rubrica_formati for all using (true) with check (true);
create policy "public full access" on public.template_constraints for all using (true) with check (true);
create policy "public full access" on public.graphic_jobs for all using (true) with check (true);
create policy "public full access" on public.graphic_job_formats for all using (true) with check (true);
create policy "public full access" on public.getty_candidates for all using (true) with check (true);

-- Bucket pubblico per i PNG esportati dal plugin Figma
-- (graphics-output/{rubrica}/{post_id}-{formato}.png).
insert into storage.buckets (id, name, public)
values ('graphics-output', 'graphics-output', true)
on conflict (id) do nothing;

create policy "graphics-output public read" on storage.objects
  for select using (bucket_id = 'graphics-output');

create policy "graphics-output public insert" on storage.objects
  for insert with check (bucket_id = 'graphics-output');

create policy "graphics-output public update" on storage.objects
  for update using (bucket_id = 'graphics-output');

create policy "graphics-output public delete" on storage.objects
  for delete using (bucket_id = 'graphics-output');
