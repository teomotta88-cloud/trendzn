-- Wizard di composizione post: "modifica visual con editor grafico" (segue
-- Fase 9). Il wizard finora salvava solo il PNG finale (editorial_post_media),
-- perdendo la struttura editabile del design una volta chiuso — riaprirlo
-- per modificarlo avrebbe richiesto di ricominciare da zero. post_visual_elements
-- salva l'istanza EFFETTIVA del design per quel post (valori reali già
-- inseriti, non i segnaposto del template), per formato/card_index — stesso
-- schema di riga di template_elements ma senza rubrica_id/formato: qui
-- l'ambito è il singolo post, non un template condiviso.
--
-- visual_rubrica_id/visual_formato su editorial_posts ricordano quale
-- rubrica/formato è stato usato per generare l'ultimo visual (per poter
-- riaprire il wizard già al passo di rifinitura). visual_media_ids ricorda
-- quali righe di editorial_post_media sono state caricate dall'ULTIMO
-- salvataggio del wizard, cosi un nuovo salvataggio può rimpiazzarle senza
-- toccare eventuali file caricati manualmente dall'utente nella galleria.

create table public.post_visual_elements (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.editorial_posts(id) on delete cascade,
  card_index integer not null default 1,
  layer_name text,
  tipo text not null,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  rotation double precision not null default 0,
  z_index integer not null default 0,
  style jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index post_visual_elements_post_card_idx
  on public.post_visual_elements (post_id, card_index);

alter table public.editorial_posts
  add column visual_rubrica_id uuid references public.rubriche(id) on delete set null,
  add column visual_formato text,
  add column visual_media_ids uuid[] not null default '{}';
