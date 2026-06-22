-- Piano Editoriale: stato "programmato" sul post (sì/no).

alter table public.editorial_posts add column if not exists programmato boolean not null default false;
