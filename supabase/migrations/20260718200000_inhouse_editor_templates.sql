-- Editor grafico interno (sostituisce progressivamente il percorso Canva
-- Bulk Create/Figma plugin, vedi docs/sbam-autographics-canva.md): definisce
-- il design vero e proprio di una rubrica come albero di elementi
-- posizionati, invece di dipendere da un template esterno (Figma/Canva).
--
-- template_elements e' l'unica fonte di verita' sia per l'editor visuale
-- (DOM/React, drag-resize-rotate) sia per il motore di rendering headless
-- (satori + resvg-wasm, vedi src/lib/design-render.ts): stesso albero,
-- nessun disallineamento fra anteprima ed export.
--
-- layer_name si aggancia alla stessa chiave gia' usata da
-- template_constraints.layer_name/copy_payload: un elemento "possiede" la
-- rappresentazione visiva di un campo dinamico, template_constraints ne
-- possiede la validazione (max_chars, obbligatorio, ...). Un elemento senza
-- layer_name è contenuto fisso del design (logo, sfondo, decorazioni) e non
-- viene mai sostituito dai dati del job.
create table public.template_elements (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references public.rubriche(id) on delete cascade,
  -- null = elemento comune a tutti i formati della rubrica; valorizzato solo
  -- per gli elementi il cui posizionamento cambia tra formati (es. 1:1 vs
  -- 9:16 richiedono layout diversi dello stesso campo).
  formato text,
  layer_name text,
  tipo text not null check (tipo in ('text', 'image', 'icon', 'shape')),
  x numeric not null default 0,
  y numeric not null default 0,
  width numeric not null default 100,
  height numeric not null default 100,
  rotation numeric not null default 0,
  z_index integer not null default 0,
  -- text: { fontFamily, fontSize, fontWeight, color, align, lineHeight }
  -- image: { objectFit, borderRadius }
  -- icon: { name (lucide), color, strokeWidth }
  -- shape: { fill, borderRadius }
  style jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index template_elements_rubrica_id_idx on public.template_elements (rubrica_id);
create index template_elements_rubrica_formato_idx on public.template_elements (rubrica_id, formato);

-- Font caricati dall'utente (oltre al set curato self-hostato in
-- public/fonts): il file va conservato come bytes recuperabili dal motore di
-- rendering, che li passa a satori esplicitamente (satori non legge
-- @font-face, vuole i buffer dei font in input).
create table public.custom_fonts (
  id uuid primary key default gen_random_uuid(),
  family_name text not null,
  weight integer not null default 400,
  style text not null default 'normal' check (style in ('normal', 'italic')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (family_name, weight, style)
);

alter table public.template_elements enable row level security;
alter table public.custom_fonts enable row level security;

-- Stesso pattern di accesso pubblico del resto di Piano Editoriale/SBAM
-- AutoGraphics (nessun login nel progetto).
create policy "public full access" on public.template_elements for all using (true) with check (true);
create policy "public full access" on public.custom_fonts for all using (true) with check (true);

-- Bucket pubblico per i font custom caricati dall'editor.
insert into storage.buckets (id, name, public)
values ('custom-fonts', 'custom-fonts', true)
on conflict (id) do nothing;

create policy "custom-fonts public read" on storage.objects
  for select using (bucket_id = 'custom-fonts');

create policy "custom-fonts public insert" on storage.objects
  for insert with check (bucket_id = 'custom-fonts');

create policy "custom-fonts public delete" on storage.objects
  for delete using (bucket_id = 'custom-fonts');
