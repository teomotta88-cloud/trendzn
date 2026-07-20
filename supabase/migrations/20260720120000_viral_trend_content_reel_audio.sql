-- Trend Virali — Fase F: nome traccia audio + URL (/reels/audio/<id>/) del
-- singolo Reel, estratti in Playwright dalla stessa pagina già visitata per
-- like/commenti (vedi fetchMetricsDetailed in
-- scripts/lib/instagram-public-metrics.mjs) — nessuna richiesta aggiuntiva,
-- solo un altro selettore sulla pagina già caricata. Null per i contenuti
-- non-Reel (foto/carosello, che non hanno audio) o quando Instagram non
-- espone il link (es. audio non attribuito).
--
-- Popola per la prima volta con dati reali il concetto "audio" già
-- predisposto in monitored_topics.topic_type='trending-audio' (finora solo
-- schema, nessuna discovery) — il rilevamento di un audio che ricorre su
-- più Reel diversi (== audio in trend) resta un passo successivo separato,
-- non ancora implementato qui: questa migration aggiunge solo la
-- registrazione per-post, propedeutica a quel rilevamento.
alter table public.viral_trend_content add column if not exists audio_name text;
alter table public.viral_trend_content add column if not exists audio_url text;
