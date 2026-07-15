-- Fase 2 del redesign Trend Virali: separare i segnali di crescita per
-- (topic, piattaforma) per eliminare il clobbering.
--
-- Finora i tassi di crescita vivevano su tre colonne SINGOLE in
-- monitored_topics (volume_growth_pct, engagement_growth_pct, growth_platform,
-- più i latest_*). Ci scrivevano DUE flussi su piattaforme diverse:
--   - TikTok  → sync-trending-hashtags.ts, ogni ora
--   - Instagram → record-topic-volume.ts, ogni 6h
-- e si sovrascrivevano a vicenda. TikTok, essendo orario, vinceva quasi
-- sempre: il segnale Instagram — l'unico legato alla viralità per-post reale —
-- restava leggibile solo per pochi minuti ogni 6h prima di essere cancellato.
--
-- topic_signals dà a ogni flusso la propria riga: niente più clobbering, e
-- i due segnali (TikTok esatto, Instagram campionato) diventano leggibili in
-- parallelo. is_volume_exact viaggia con la riga come livello di confidenza.
create table public.topic_signals (
  topic_id uuid not null references public.monitored_topics (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  volume_growth_pct double precision,
  engagement_growth_pct double precision,
  latest_content_volume bigint,
  latest_total_engagement bigint,
  -- Confidenza del volume: TikTok = conteggio reale da Creative Center (true),
  -- Instagram = campione della pagina hashtag, mai il totale (false).
  is_volume_exact boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (topic_id, platform)
);

create index topic_signals_topic_idx on public.topic_signals (topic_id);

-- Backfill best-effort: porta l'ultimo valore noto (una sola piattaforma per
-- topic, quella che aveva vinto il clobbering) in topic_signals, così la UI
-- non resta senza segnali fino al primo run dopo il deploy. I run successivi
-- riempiranno anche l'altra piattaforma.
insert into public.topic_signals (
  topic_id, platform, volume_growth_pct, engagement_growth_pct,
  latest_content_volume, latest_total_engagement, is_volume_exact, computed_at
)
select
  id, growth_platform, volume_growth_pct, engagement_growth_pct,
  latest_content_volume, latest_total_engagement, latest_is_volume_exact,
  coalesce(growth_computed_at, now())
from public.monitored_topics
where growth_platform is not null
on conflict (topic_id, platform) do nothing;

-- Le vecchie colonne su monitored_topics (volume_growth_pct,
-- engagement_growth_pct, growth_platform, growth_computed_at,
-- latest_content_volume, latest_total_engagement, latest_is_volume_exact)
-- restano in tabella ma da qui in poi NON vengono più scritte né lette
-- (deprecate). La rimozione è rimandata a una migration successiva, quando
-- nessun deployment le referenzia più — evita di rompere un rollback rapido.
