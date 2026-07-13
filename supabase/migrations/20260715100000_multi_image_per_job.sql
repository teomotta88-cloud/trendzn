-- SBAM AutoGraphics: supporto a più campi immagine per job (es. #image1,
-- #image2, #image3 di un carousel). Finora graphic_jobs.getty_asset_id /
-- getty_image_url ospitavano una sola foto per job, quindi con più campi
-- #image la stessa foto finiva su tutte le colonne immagine dell'export.
--
-- getty_candidates guadagna layer_name per scopare la ricerca/selezione
-- Getty al singolo campo invece che all'intero job. graphic_job_images è la
-- nuova tabella che tiene l'immagine "attiva" per ciascun layer del job, sia
-- essa una selezione Getty sia un caricamento manuale (l'utente può sempre
-- caricare a mano un file al posto della ricerca Getty).
--
-- graphic_jobs.getty_asset_id/getty_image_url restano in tabella (non
-- droppati per non essere distruttivi) ma non vengono più scritti dal nuovo
-- flusso: sono legacy dei job con un solo campo immagine creati prima di
-- questa migration.

-- IF NOT EXISTS / DO block ovunque possibile: la migration deve poter
-- essere rieseguita in sicurezza se un run precedente si è fermato a metà
-- (es. per un problema di copia/incolla nell'SQL editor).

alter table public.getty_candidates
  add column if not exists layer_name text not null default '';

create index if not exists getty_candidates_job_layer_idx on public.getty_candidates (job_id, layer_name);

create table if not exists public.graphic_job_images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.graphic_jobs(id) on delete cascade,
  layer_name text not null,
  source text not null check (source in ('getty', 'upload')),
  image_url text not null,
  asset_id text,
  created_at timestamptz not null default now(),
  unique (job_id, layer_name)
);

create index if not exists graphic_job_images_job_id_idx on public.graphic_job_images (job_id);

alter table public.graphic_job_images enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'graphic_job_images' and policyname = 'public full access'
  ) then
    create policy "public full access" on public.graphic_job_images for all using (true) with check (true);
  end if;
end $$;
