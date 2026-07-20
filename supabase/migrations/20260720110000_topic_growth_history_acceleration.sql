-- Trend Virali — Fase E: motore di accelerazione + corroborazione cross-fonte.
--
-- topic_signals tiene solo l'ULTIMO tasso di crescita calcolato per (topic,
-- piattaforma) — sufficiente per "sta crescendo", non per "sta accelerando":
-- serve confrontare ALMENO due letture successive dello stesso tasso per
-- sapere se il tasso stesso sta aumentando (accelerazione) o diminuendo
-- (plateau). topic_metrics_history ha solo 48h di retention (vedi
-- HISTORY_RETENTION_HOURS in record-topic-volume.ts/sync-trending-hashtags.ts),
-- insufficiente per estrarre due finestre di crescita da 24h consecutive dai
-- dati grezzi.
--
-- topic_growth_history è invece un log append-only del tasso GIÀ CALCOLATO,
-- scritto nello stesso momento in cui topic_signals viene sovrascritto:
-- l'accelerazione si legge confrontando le ultime due righe per (topic,
-- piattaforma) invece di dover ricalcolare tutto dai dati grezzi. Righe
-- molto più leggere di topic_metrics_history (un tasso già ridotto a un
-- numero, non uno snapshot di volumi), può permettersi una retention più
-- lunga (14gg, per dare margine al backtest del lag cross-fonte in una fase
-- successiva).
create table public.topic_growth_history (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.monitored_topics (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram', 'reddit', 'youtube', 'google-trends')),
  volume_growth_pct double precision,
  engagement_growth_pct double precision,
  computed_at timestamptz not null default now()
);

create index topic_growth_history_topic_platform_computed_idx
  on public.topic_growth_history (topic_id, platform, computed_at);

alter table public.topic_growth_history enable row level security;

create policy "public full access" on public.topic_growth_history for all using (true) with check (true);
