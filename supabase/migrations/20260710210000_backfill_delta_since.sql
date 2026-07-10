-- Backfill di delta_since (introdotta in 20260710200000_delta_since.sql) per
-- i contenuti già sincronizzati PRIMA che la colonna esistesse: senza
-- questo, quei post continuano a mostrare il fallback "ultimi 7gg" in UI
-- (VariationBadge, trend-virali.tsx) anche quando hanno crescita rilevata,
-- perché delta_since resta null finché non arriva un nuovo sync/recheck per
-- quello stesso post — che con la cadenza attuale può volerci ore.
--
-- Stessa identica selezione usata da computeDeltaMetrics in
-- src/lib/virality.ts (snapshot più vecchio entro VIRALITY_WINDOW_DAYS = 7
-- giorni), così il valore retroattivo è coerente con quello che
-- sync-viral-trends.ts/recheck-viral-engagement.ts avrebbero scritto se la
-- colonna fosse esistita al momento del calcolo. Non tocca le righe che
-- hanno già un delta_since (nessuna, oggi, ma idempotente per sicurezza).
update public.viral_trend_content vtc
set delta_since = sub.oldest_captured_at
from (
  select content_id, min(captured_at) as oldest_captured_at
  from public.viral_trend_metrics_history
  where captured_at >= now() - interval '7 days'
  group by content_id
) sub
where vtc.id = sub.content_id
  and vtc.delta_since is null;
