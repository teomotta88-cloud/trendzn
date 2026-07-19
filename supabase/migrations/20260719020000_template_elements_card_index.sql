-- Editor grafico interno (Fase 8): frame multipli per rubrica, come un
-- carousel Instagram. card_index distingue a quale frame appartiene ogni
-- elemento — stessa convenzione già usata da template_constraints.card_index
-- per il copy (vedi migration 20260714100000_template_constraints_card_index.sql),
-- così il concetto di "card/frame" è coerente in tutto il progetto.
--
-- Niente concetto di "elemento condiviso tra tutti i frame" per ora (a
-- differenza di formato, che ammette null = comune a tutti i formati):
-- ogni frame ha il suo set di elementi indipendente. Se in futuro serve
-- riusare un logo/decorazione su più frame, si duplica l'elemento — tenere
-- semplice lo schema ora, aggiungere quella scelta solo se emerge un bisogno
-- concreto.

alter table public.template_elements
  add column card_index integer not null default 1;

create index template_elements_rubrica_formato_card_idx
  on public.template_elements (rubrica_id, formato, card_index);
