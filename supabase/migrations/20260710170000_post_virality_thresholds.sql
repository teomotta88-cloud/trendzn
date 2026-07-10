-- Fase 7: sostituisce il punteggio di viralità continuo (virality_score) con
-- due soglie esplicite (vedi src/lib/virality.ts, computePostVirality):
-- is_viral = delta_engagement (finestra 6h) > 1000 OPPURE engagement
-- totale > 5000. delta_engagement_6h sostituisce virality_score come chiave
-- di ordinamento "per viralità" — prima chi supera le soglie (ordinati per
-- delta_engagement_6h), poi gli altri per engagement totale.
--
-- delta_engagement e delta_reach (finestra di 7 giorni) restano invariati:
-- alimentano la "Variazione (7gg)" mostrata in UI, un'indicazione diversa
-- dalla viralità del post.
alter table public.viral_trend_content drop column virality_score;

alter table public.viral_trend_content
  add column delta_engagement_6h bigint not null default 0;

drop index if exists viral_trend_content_virality_score_idx;
create index viral_trend_content_delta_engagement_6h_idx
  on public.viral_trend_content (is_viral desc, delta_engagement_6h desc, engagement desc);
