-- Fix di un limite noto e documentato (docs/trend-virali-recap.md, "Limiti
-- noti"): list-instagram-content-urls.ts non pagina né ruota — restituisce
-- sempre le stesse righe (ordine non esplicito, di fatto l'ordine fisico
-- della tabella) quando i contenuti Instagram nella finestra di 7gg superano
-- il limite (150 di default, 300 al massimo). I contenuti oltre quel numero
-- non venivano MAI ricontrollati da recheck-viral-engagement.mjs — niente
-- nuovo snapshot, quindi delta_engagement_6h restava fermo a 0 e is_viral
-- non si aggiornava più, indipendentemente da quanto il post continuasse
-- davvero a crescere. Un problema che peggiora proprio quando il volume di
-- contenuti scoperti cresce, cioè quando la rilevazione di viralità conta
-- di più.
--
-- Fix: updated_at, aggiornato esplicitamente ad ogni scrittura reale del
-- contenuto (sync-viral-trends.ts, recheck-viral-engagement.ts) — non un
-- trigger DB, per coerenza con monitored_topics.updated_at che segue lo
-- stesso pattern (impostato in codice applicativo, non a livello di
-- schema). list-instagram-content-urls.ts ordina per updated_at crescente:
-- i contenuti MAI ricontrollati (o ricontrollati da più tempo) escono
-- sempre per primi, garantendo che nel tempo tutti i contenuti vengano
-- ciclati, non solo i primi ~150 per ordine fisico.
alter table public.viral_trend_content add column if not exists updated_at timestamptz not null default now();

create index if not exists viral_trend_content_updated_at_idx on public.viral_trend_content (updated_at);
