-- SBAM AutoGraphics: pivot da plugin Figma a export CSV per Canva Bulk
-- Create. Il rendering non passa più da un plugin che gira dentro Figma
-- (richiede di aprire l'app, non automatizzabile via API): il copywriter
-- esporta un CSV da trendzn e lo carica in Canva Bulk Create, che genera le
-- grafiche a partire da un Brand Template coi campi collegati.
--
-- figma_file_key/figma_component_id diventano opzionali: restano utilizzabili
-- per rubriche che vogliono ancora il vecchio percorso plugin (non rimosso),
-- ma non sono più richiesti per registrare una rubrica basata su Canva.

alter table public.rubriche
  alter column figma_file_key drop not null,
  alter column figma_component_id drop not null;
