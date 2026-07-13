-- SBAM AutoGraphics: distingue i layer di testo dai layer immagine nei
-- vincoli del template. Serve perché i layer immagine (es. #photo, #foto,
-- #immagine) NON si compilano digitando testo: vengono riempiti dalla foto
-- Getty selezionata dall'utente (graphic_jobs.getty_image_url). Senza questa
-- distinzione un layer immagine "obbligatorio" bloccava il salvataggio della
-- bozza (il suo valore testuale è sempre vuoto) creando un cortocircuito col
-- fatto che la selezione Getty compare solo dopo il salvataggio.
--
-- Default 'text' così i vincoli già esistenti restano invariati.

alter table public.template_constraints
  add column layer_type text not null default 'text'
  check (layer_type in ('text', 'image'));

-- Marca come immagine i layer già registrati con i nomi immagine più comuni
-- (italiano/inglese), così le rubriche già create non vanno ritoccate a mano.
update public.template_constraints
set layer_type = 'image'
where layer_name ~* '^#(photo|foto|image|immagine|img|icon|icona|bg|sfondo)';
