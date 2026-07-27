-- Follower count e foto profilo per ogni profilo monitorato (brand o
-- influencer), aggiornati a ogni check periodico (scripts/sync-instagram-collab.mjs
-- via l'hook sync-instagram-collab) leggendo la pagina profilo pubblica —
-- vedi scripts/lib/instagram-profile-stats.mjs. Servono solo per l'UI
-- (elenco più leggibile/accattivante), non per la logica di rilevamento
-- collab.
alter table public.instagram_monitored_profiles
  add column followers_count bigint,
  add column profile_pic_url text;
