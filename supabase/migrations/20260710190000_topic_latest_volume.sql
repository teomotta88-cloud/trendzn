-- Fase 8 (UI): monitored_topics non aveva ancora un "volume attuale" da
-- mostrare — solo il tasso di crescita (Fase 6). latest_is_volume_exact
-- distingue il conteggio reale di TikTok da quello campionato di Instagram
-- (stesso significato di is_volume_exact in topic_metrics_history), per
-- mostrare "~" in UI quando il numero è solo una stima.
alter table public.monitored_topics
  add column latest_content_volume bigint,
  add column latest_total_engagement bigint,
  add column latest_is_volume_exact boolean not null default false;
