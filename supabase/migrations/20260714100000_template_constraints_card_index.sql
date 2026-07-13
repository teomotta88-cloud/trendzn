-- SBAM AutoGraphics: editor visuale delle rubriche (card + campi tipizzati)
-- al posto dell'inserimento SQL manuale. card_index tiene traccia di quale
-- "card" (slide di un carousel) appartiene ciascun campo, cosi' l'editor
-- puo' ricostruire il raggruppamento quando si riapre una rubrica esistente
-- per modificarla. Non influisce sull'export (che lavora comunque su un
-- elenco piatto di layer_name -> valore).

alter table public.template_constraints
  add column card_index integer not null default 1;
