-- Fase 6: tasso di crescita per i topic monitorati (vedi src/lib/topicGrowth.ts
-- per la formula — percentuale su 24h, valida solo sopra una soglia minima
-- di delta assoluto per non scambiare rumore statistico su topic piccoli
-- per viralità). Ricalcolato ad ogni nuovo snapshot in topic_metrics_history
-- (da record-topic-volume.ts per Instagram, sync-trending-hashtags.ts per
-- TikTok) — growth_platform indica quale fonte ha prodotto l'ultimo calcolo,
-- perché lo stesso topic può avere dati sia da TikTok (volume esatto) sia da
-- Instagram (campione), a cadenze diverse.
alter table public.monitored_topics
  add column volume_growth_pct double precision,
  add column engagement_growth_pct double precision,
  add column growth_platform text check (growth_platform in ('tiktok', 'instagram')),
  add column growth_computed_at timestamptz;
