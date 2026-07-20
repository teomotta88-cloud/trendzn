-- Trend Virali: gruppi di trend rilevati su più fonti indipendenti
-- (TikTok/Google Trends/X, che condividono già una chiave esatta via
-- monitored_topics.value, più Canali Inspo, che non la condivide — le sue
-- etichette cross-profilo sono testo libero generato da un LLM sulle
-- didascalie, vedi cross_profile_topic su viral_trend_content).
--
-- Il match tra le 4 fonti è fatto da uno step LLM dedicato
-- (scripts/match-cross-source-trends.mjs, matchTopicsAcrossSources in
-- scripts/lib/openrouter.mjs) invece che testualmente: le fonti fraseggiano
-- lo stesso argomento in modi troppo diversi per un confronto esatto o per
-- una semplice substring (es. "Mondiali 2026" vs "mondiali calcio 2026").
--
-- Tabella ricalcolata per intero ad ogni run (nessuno storico, nessuna
-- chiave di upsert): il chiamante cancella tutte le righe precedenti e
-- inserisce il nuovo risultato in un'unica chiamata.
create table public.cross_source_trends (
  id uuid primary key default gen_random_uuid(),
  -- Etichetta scelta dall'LLM per rappresentare il gruppo (una delle
  -- etichette di partenza, non necessariamente la più "ufficiale").
  label text not null,
  source_count integer not null check (source_count >= 1),
  -- null se la fonte non basta a mostrare un peperoncino (< 2 fonti, cioè
  -- < 50% delle 4 fonti tracciate) — non tutte le righe sono "in classifica"
  -- nella tab Trendzning Now, solo quelle con un tier.
  tier text check (tier in ('hot', 'spicy', 'super_spicy')),
  -- Quali delle 4 fonti fanno parte del gruppo: sottoinsieme di
  -- ('tiktok-hashtag', 'google-trends', 'x-trending', 'canali-inspo').
  sources text[] not null,
  -- monitored_topics.id delle righe TikTok/Google/X incluse nel gruppo
  -- (chiave esatta già esistente) — vuoto se il gruppo è solo Canali Inspo.
  topic_ids uuid[] not null default '{}',
  -- L'etichetta cross_profile_topic di Canali Inspo abbinata al gruppo, se
  -- presente — null se il gruppo non include quella fonte.
  canali_inspo_topic text,
  computed_at timestamptz not null default now()
);

create index cross_source_trends_computed_at_idx on public.cross_source_trends (computed_at desc);

alter table public.cross_source_trends enable row level security;

-- Sezione senza login, come le altre sezioni "anonime" già esistenti in trendzn.
create policy "public full access" on public.cross_source_trends for all using (true) with check (true);
