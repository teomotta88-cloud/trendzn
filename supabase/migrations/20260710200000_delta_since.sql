-- La "Variazione (Xgg)" mostrata in UI (VariationBadge, trend-virali.tsx)
-- mostrava sempre il testo fisso "ultimi 7gg" (VIRALITY_WINDOW_DAYS), anche
-- quando lo snapshot più vecchio usato per calcolare delta_engagement/
-- delta_reach (computeDeltaMetrics) era molto più recente — un post visto la
-- prima volta 18 ore fa mostrava comunque "ultimi 7gg", fuorviante.
--
-- delta_since salva il captured_at dello snapshot di riferimento (il più
-- vecchio in viral_trend_metrics_history entro la finestra di
-- VIRALITY_WINDOW_DAYS), così la UI può mostrare l'intervallo reale invece
-- del tetto massimo della finestra.
alter table public.viral_trend_content
  add column if not exists delta_since timestamptz;
