-- Piano Editoriale: canale diventa multi-selezione e il copy diventa specifico per canale.

alter table public.editorial_posts add column if not exists canali text[] not null default '{}';
alter table public.editorial_posts add column if not exists channel_copies jsonb not null default '{}'::jsonb;

-- Porta i dati esistenti nelle nuove colonne, così non si perde nulla.
update public.editorial_posts
set canali = array[canale]
where canale is not null and canali = '{}';

update public.editorial_posts
set channel_copies = jsonb_build_object('IG', copy)
where copy is not null and channel_copies = '{}'::jsonb;

alter table public.editorial_posts drop column if exists canale;
alter table public.editorial_posts drop column if exists copy;
