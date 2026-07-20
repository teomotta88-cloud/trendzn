-- Integrazione dei due sistemi di corroborazione cross-fonte costruiti in
-- parallelo in questo progetto: il matching semantico via LLM
-- (cross_source_trends, scripts/match-cross-source-trends.mjs) resta
-- l'identificazione "stesso argomento" — strettamente migliore del match
-- testuale a chiave canonica tentato in src/lib/topicAcceleration.ts
-- (buildCorroboration/canonicalKeyFor, rimosso qui), perché regge parafrasi,
-- lingue diverse e copre anche Canali Inspo. Quello che il match LLM da solo
-- non sa dire è se il gruppo trovato sta ACCELERANDO — un conteggio di fonti
-- è statico, non dice se il trend sta ancora crescendo o si è già stabilizzato.
--
-- is_accelerating: true se almeno uno dei topic del gruppo mostra
-- un'accelerazione (vedi computeAcceleration in topicAcceleration.ts, che
-- resta come unica parte riusata dal tentativo precedente) — la dimensione
-- che completa il conteggio fonti già esistente (source_count/tier).
alter table public.cross_source_trends
  add column is_accelerating boolean not null default false;
