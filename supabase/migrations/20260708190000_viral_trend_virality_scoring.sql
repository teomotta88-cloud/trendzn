-- Calcolo di viralità per "Trend Virali": finestra fissa di 7 giorni sia per
-- l'eleggibilità del contenuto (published_at, vedi src/lib/viralTrends.ts) sia
-- per il calcolo della variazione (delta_reach/delta_engagement). Serve uno
-- storico delle metriche nel tempo perché finora sync-viral-trends.ts faceva
-- solo upsert (sovrascrive), perdendo il valore precedente di ogni post già
-- visto — senza storico non si può calcolare nessun "aumento".
--
-- discovery_source distingue le due fonti indipendenti di scoperta topic
-- (vedi scripts/sync-viral-trends.mjs): 'tiktok-hashtag' (hashtag TikTok in
-- trend, flusso esistente) e 'google-trends' (ricerche in tendenza Google
-- Trends per l'Italia, nuova fonte indipendente dal workflow hashtag).

alter table public.viral_trend_content
  add column discovery_source text not null default 'tiktok-hashtag'
    check (discovery_source in ('tiktok-hashtag', 'google-trends')),
  add column virality_score double precision not null default 0,
  add column delta_engagement bigint not null default 0,
  add column delta_reach bigint not null default 0;

create index viral_trend_content_virality_score_idx
  on public.viral_trend_content (virality_score desc);

alter table public.viral_trend_runs
  add column discovery_source text;

-- Uno snapshot per ogni sync di un contenuto già noto (append, mai upsert):
-- serve a ricostruire il valore di 7 giorni fa per calcolare la variazione.
-- Righe più vecchie di 7 giorni vengono cancellate a fine di ogni sync
-- (vedi sync-viral-trends.ts) perché la finestra è sempre e solo l'ultima
-- settimana, non serve conservarle oltre.
create table public.viral_trend_metrics_history (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.viral_trend_content (id) on delete cascade,
  engagement bigint not null default 0,
  reach bigint,
  captured_at timestamptz not null default now()
);

create index viral_trend_metrics_history_content_captured_idx
  on public.viral_trend_metrics_history (content_id, captured_at);

alter table public.viral_trend_metrics_history enable row level security;

create policy "public full access" on public.viral_trend_metrics_history for all using (true) with check (true);
