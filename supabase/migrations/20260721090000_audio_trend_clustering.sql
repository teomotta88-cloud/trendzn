-- Trend Virali: rilevamento "audio in trend" tra i Reel dei Canali Inspo —
-- 3+ Reel diversi che usano lo stesso audio_url (Fase F,
-- 20260720120000_viral_trend_content_reel_audio.sql), pubblicati da almeno
-- 3 canali distinti, nella stessa finestra di 7gg già usata per il feed
-- (VIRALITY_WINDOW_DAYS).
--
-- Stesso pattern già in uso per il trend cross-profilo testuale
-- (cross_profile_topic/cross_profile_channel_count): annotazione diretta
-- sulle righe di viral_trend_content invece di un nuovo monitored_topics —
-- qui a maggior ragione, perché il match è per URL esatto (non serve un
-- LLM per capire se due Reel condividono lo stesso audio, lo dice l'URL).
--
-- Limite noto (non risolvibile con un match testuale/LLM, vedi
-- sync-audio-trends.ts): un audio riscaricato e ricaricato come "audio
-- originale" da un altro utente ottiene un audio_url NUOVO e un
-- audio_name generico legato al nuovo profilo — nessun segnale condiviso
-- da abbinare senza un vero riconoscimento acustico del contenuto audio,
-- fuori scopo qui.
alter table public.viral_trend_content add column if not exists audio_trend_reel_count integer;
alter table public.viral_trend_content add column if not exists audio_trend_channel_count integer;
