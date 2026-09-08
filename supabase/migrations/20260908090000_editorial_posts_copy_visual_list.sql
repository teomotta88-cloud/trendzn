-- Piani Editoriali IHC: permette più campi "copy visual" per post (bottone
-- "+" nel form), usati per popolare più colonne nell'export Story per Canva
-- Bulk Create. copy_visual (singolare) resta invariato per compatibilità con
-- il Piano Editoriale originale e con l'editing rapido inline della card.

alter table public.editorial_posts add column copy_visual_list text[];
