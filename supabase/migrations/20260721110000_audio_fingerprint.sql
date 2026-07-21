-- Rilevamento "audio in trend" via fingerprint acustico (Chromaprint) —
-- completa il match esatto su audio_url già in sync-audio-trends.ts
-- (20260721090000_audio_trend_clustering.sql) per i casi in cui lo stesso
-- audio è stato ricaricato con un audio_url diverso (audio "originale"
-- ripubblicato da un altro utente, verificato non recuperabile con un
-- match testuale/LLM: perde anche il segnale testuale, non solo l'URL).
--
-- Un fingerprint grezzo di Chromaprint è un array di interi a 32bit, uno
-- ogni ~1/3 di secondo di audio (integer[] nativo Postgres, non una
-- stringa JSON — più semplice da leggere lato Supabase JS). Calcolato solo
-- per un sottoinsieme dei Reel Canali Inspo (vedi
-- MAX_FINGERPRINTS_PER_RUN in discover-canali-inspo-content.mjs) — null
-- per tutti gli altri contenuti.
alter table public.viral_trend_content add column if not exists audio_fingerprint integer[];

-- Quale dei due meccanismi ha promosso questo Reel a "audio in trend" —
-- 'exact' (stesso audio_url, deterministico) o 'fingerprint' (similarità
-- acustica sopra soglia, euristico — vedi FINGERPRINT_MATCH_THRESHOLD in
-- src/lib/audioFingerprintSimilarity.ts, dichiaratamente da calibrare).
-- Utile in fase di verifica per distinguere i cluster "certi" da quelli
-- trovati con una soglia ancora da tarare su dati reali. null se il Reel
-- non fa parte di nessun cluster.
alter table public.viral_trend_content add column if not exists audio_trend_matched_by text
  check (audio_trend_matched_by in ('exact', 'fingerprint'));
