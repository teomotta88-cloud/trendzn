# Trend Virali v2 — Recap per una nuova sessione

Questo documento sostituisce integralmente la versione precedente (v1, 2026-07-08):
da allora il flusso è stato ricostruito da zero (v2) su richiesta esplicita
dell'utente. Scritto per essere letto senza contesto pregresso — se stai
riprendendo questo progetto in una sessione nuova, parti da qui.

## Obiettivo del progetto v2

Scoprire e monitorare hashtag/keyword "virali" da due fonti indipendenti
(hashtag TikTok in trend, ricerche Google Trends per l'Italia), seguirne il
ciclo di vita (quanto restano rilevanti), misurarne il tasso di crescita
reale (non solo una % ingannevole), e mostrare in `/trend-virali` sia i
topic in classifica sia i singoli post virali trovati su Instagram/TikTok
che li riguardano.

Principio guida ripetuto più volte dall'utente durante lo sviluppo: **le
metriche devono riflettere una realtà stabile e confrontabile nel tempo**,
non il rumore di una singola rilevazione — vale per la formula di crescita,
per cosa resta visibile in UI, per i filtri di qualità (lingua) applicati ai
contenuti.

## Stato di avanzamento

| Fase | Cosa | Stato |
|---|---|---|
| 1 | Schema: `monitored_topics`, `topic_metrics_history`, link `viral_trend_content.topic_id` | ✅ |
| 2 | Motore ciclo di vita (top-N + grazia 24h) | ✅ |
| 3 | Storico volumi TikTok (post_count/view_count reali) + cron più frequente | ✅ |
| 4 | Discovery gratuita Instagram via pagina hashtag, in produzione | ✅ |
| 4a | Probe su campione reale di hashtag prima di portarla in produzione | ✅ |
| 5 | Cadenza anysite più frequente, collegata a `monitored_topics` | ✅ |
| 6 | Tasso di crescita volumi/engagement a livello di topic | ✅ (rivisto più volte, vedi sotto) |
| 7 | Regole di viralità post singoli a soglie esplicite | ✅ |
| 8 | Redesign UI `/trend-virali` (toggle TikTok/Google Trends + feed post) | ✅ |
| 9 | Predisposizione monitoraggio audio (solo schema, seed manuale) | ⬜ non iniziata |
| 10 | Canali Inspo: rilevamento cross-canale (topic e audio) | ⬜ non iniziata, richiede uno spike di fattibilità sull'estrazione audio prima di poter stimare la fase |

Il piano originale a 10 fasi è stato concordato con l'utente all'inizio del
lavoro v2 e seguito in ordine. Le fasi 9 e 10 sono le uniche rimaste, a
priorità bassa e con più incertezza (soprattutto la 10).

## Architettura della pipeline

```
Fonte 1: TikTok Creative Center (hashtag reali in trend, IT)
  scripts/tiktok-cc-session.mjs / tiktok-cc-bootstrap-session.mjs
  scripts/sync-trending-it.mjs (orchestratore)
    → src/routes/api/public/hooks/sync-trending-hashtags.ts
      → tabella tiktok_trending_hashtags (rank, post_count, view_count REALI)
      → topic_metrics_history (platform=tiktok, is_volume_exact=true)
  workflow: tiktok-trending-it.yml, ogni 4h

Fonte 2: Google Trends IT (ricerche in tendenza, già in linguaggio naturale)
  scripts/lib/google-trends.mjs

Entrambe le fonti confluiscono in:
  scripts/sync-viral-trends.mjs (orchestratore principale)
    1. legge top hashtag TikTok (top-tiktok-hashtags.ts, MAX_HASHTAGS=15)
       e top Google Trends (MAX_TRENDS=15)
    2. converte hashtag→keyword leggibile (hashtagsToKeywords: OpenRouter,
       fallback offline word-segment.mjs) e keyword→hashtag derivato
       (keywordToHashtag, solo se ≤2 parole — MAX_GOOGLE_TRENDS_WORDS)
    3. registra tutti i topic in monitor-topics.ts (ciclo di vita)
    4. per ogni topic: cerca la keyword su Instagram via anysite
       (fetchInstagramContent — filtro looksItalian + containsKeyword),
       e riusa i video TikTok già raccolti dalla Fonte 1 per lo stesso
       hashtag esatto (fetchTikTokContent)
    5. sincronizza tutto via sync-viral-trends.ts → viral_trend_content
  workflow: sync-viral-trends.yml, ogni 6h

Fonte 3: Discovery gratuita Instagram via pagina hashtag (complementare ad
anysite, nessun credit, per i topic già monitorati da monitor-topics)
  scripts/discover-instagram-hashtag-content.mjs
    - naviga /explore/tags/<hashtag>/, scrolla fino a MAX_POSTS_PER_HASHTAG=100
    - estrae link a post/carosello/Reel (non solo Reel)
    - per ciascuno: scripts/lib/instagram-public-metrics.mjs
      (fetchMetricsDetailed) legge il meta tag description (nessun login)
      → likes, comments, publishedAt, caption (didascalia)
    - filtro recency: solo pubblicati negli ultimi RECENCY_WINDOW_DAYS=7
    - filtro lingua: looksItalian(caption) — scarta contenuti non italiani
    - sincronizza via sync-viral-trends.ts (stesso endpoint della Fonte
      principale), registra volume/engagement via record-topic-volume.ts
  workflow: discover-instagram-hashtag-content.yml, ogni 6h, matrix a 2
    shard (SHARD_COUNT/SHARD_INDEX) — vedi "Blocco Instagram" sotto

Ricontrollo periodico (gratuito, indipendente dalla discovery)
  scripts/recheck-viral-engagement.mjs
    - rivisita ogni post Instagram già noto nella finestra di 7gg
    - aggiorna engagement (likes+comments) via recheck-viral-engagement.ts
    - applica anche looksItalian(caption): cancella (non aggiorna) i post
      che risultano non italiani — backfix retroattivo del filtro lingua
      per contenuti sincronizzati prima che esistesse
  workflow: recheck-viral-engagement.yml, ogni 6h
```

## Schema del database (tabelle create/estese in questo lavoro)

- **`monitored_topics`** — hashtag TikTok / keyword Google Trends monitorati.
  `status` 'active' mentre nei top-N, +24h di grazia dall'ultima volta vista
  in classifica (`monitoring_stops_at`), poi 'expired'. `last_seen_in_top5_at`
  aggiornato SOLO quando il topic è confermato nei top-N ad ogni sync — è il
  campo usato per distinguere "davvero in classifica ora" da "in periodo di
  grazia" (vedi `isCurrentlyRanked` sotto). Include già `trending-audio` come
  `topic_type` per la Fase 9 (nessuna discovery reale ancora).
- **`topic_metrics_history`** — snapshot di volume/engagement per topic nel
  tempo, distingue `platform` (tiktok/instagram) e `is_volume_exact` (TikTok
  = conteggio reale da Creative Center, Instagram = campione).
- **`viral_trend_content`** — singoli post/contenuti. `topic_id` collega al
  topic che li ha scoperti. `delta_engagement_6h` + `is_viral` (soglie, non
  più uno score continuo). `delta_since` = timestamp dello snapshot di
  riferimento usato per calcolare il delta mostrato in UI (non il tetto
  massimo della finestra).
- **`viral_trend_metrics_history`** — snapshot engagement/reach per singolo
  post, usato per calcolare i delta (7gg per la UI, 6h per la viralità).

Migration rilevanti, in ordine: `20260710120000_monitored_topics.sql`,
`20260710150000_topic_growth.sql`, `20260710170000_post_virality_thresholds.sql`,
`20260710190000_topic_latest_volume.sql`, `20260710200000_delta_since.sql`,
`20260710210000_backfill_delta_since.sql`.

**Nota sui tipi TypeScript**: i tipi Supabase generati (`src/integrations/supabase/types.ts`)
sono sempre un po' indietro rispetto alle migration appena mergiate — gli
errori `tsc` su tabelle/colonne nuove non ancora note ai tipi sono attesi e
si risolvono da soli quando i tipi vengono rigenerati dopo che la migration è
applicata in produzione. Verificato ripetutamente in questo lavoro
diffando il conteggio errori prima/dopo ogni PR: mai una regressione vera,
sempre la stessa categoria.

## Formule chiave

### Crescita a livello di topic — `src/lib/topicGrowth.ts`

Richiesta esplicita dell'utente: niente percentuale ingannevole su hashtag
troppo piccoli (2 contenuti → +2 non è "+100%, viralità") o troppo grandi
(10M contenuti, +1000 non è viralità anche se l'assoluto sembra grande).

- Finestra fissa: `TOPIC_GROWTH_WINDOW_HOURS = 24`
- Soglia di rumore: `MIN_ABSOLUTE_DELTA = 20` — sotto questo delta assoluto
  (volumi o engagement) il risultato è `null` ("dati insufficienti"), non
  una percentuale calcolata su un campione troppo piccolo
- Soglia "in aumento": `GROWTH_THRESHOLD_PCT = 1` (1%)
- Calcolata separatamente per `volumeGrowthPct` e `engagementGrowthPct`,
  per topic+piattaforma (un hashtag TikTok può avere crescita sia da TikTok
  che da Instagram, non comparabili tra loro)
- `isStrongGrowthSignal()`: true solo se ENTRAMBE volume ED engagement
  crescono ≥1% nella stessa finestra — "viralità marcata" (badge fiamma
  arancione in UI), più forte di uno solo dei due che cresce

**Importante — fix del 2026-07-11**: per Instagram, `content_volume`/
`total_engagement` NON vengono più calcolati dal singolo scrape di un run
(`discover-instagram-hashtag-content.mjs` trova fino a 100 contenuti per
giro, ma la pagina hashtag non garantisce di mostrare sempre "gli stessi +
eventuali nuovi" — un run può perdere post ancora validi solo per come
Instagram riordina la pagina). `record-topic-volume.ts` ricalcola invece
l'aggregato da **tutto ciò che conosciamo per quel topic** in
`viral_trend_content` (accumulato via upsert, tenuto aggiornato da
`recheck-viral-engagement.mjs`), filtrato alla stessa finestra di recency
del feed — una base di confronto stabile, non un campione che cambia ad
ogni scrape. TikTok non ha questo problema: `post_count` è già un conteggio
reale fornito da Creative Center.

### Viralità del singolo post — `src/lib/virality.ts`

Sostituisce un vecchio punteggio continuo (`virality_score`, rimosso) con
soglie esplicite, su richiesta esplicita ("sostituisci del tutto con le
soglie"):

- `VIRAL_DELTA_WINDOW_HOURS = 6`, `VIRAL_DELTA_THRESHOLD = 1000`,
  `VIRAL_TOTAL_THRESHOLD = 5000`
- `isViral = deltaEngagement6h > 1000 OPPURE engagement totale > 5000`
- `VIRALITY_WINDOW_DAYS = 7` — finestra di eleggibilità nel feed e per il
  badge "Variazione" (delta_engagement/delta_reach su 7gg, mostrato con
  l'intervallo reale via `delta_since`, non più un fisso "ultimi 7gg")

### Topic "davvero in classifica" — `src/lib/monitoredTopics.ts`

`isCurrentlyRanked()`: confronta `last_seen_in_top5_at` con la cadenza di
sync (6h) + margine → `TOP5_FRESHNESS_HOURS = 7`. Oltre questa soglia il
topic è ancora `status='active'` (periodo di grazia, continua ad essere
monitorato in background) ma NON va più mostrato come "in classifica" nel
toggle TikTok/Google Trend di `/trend-virali` — filtro applicato lato
client, l'endpoint `list-monitored-topics` continua a restituire tutti gli
`active` perché la discovery Instagram ne ha bisogno per continuare durante
la grazia.

## Filtro lingua italiana

`looksItalian()` in `scripts/lib/social-search.mjs` — euristica a parole
funzionali italiane comuni (richiede ≥2 hit), usata dove non esiste un
filtro lingua nativo. Applicato in TRE punti:
1. `sync-viral-trends.mjs` (percorso anysite) — già presente da prima
2. `discover-instagram-hashtag-content.mjs` (percorso gratuito via hashtag)
   — aggiunto perché un hashtag "in trend su TikTok Italia" non implica che
   chi lo usa su Instagram scriva in italiano
3. `recheck-viral-engagement.mjs` — backfix retroattivo: cancella (invece di
   aggiornare) i post già sincronizzati prima del punto 2 che risultano non
   italiani, rivisitando ogni post Instagram ogni 6h

Limite noto e accettato: didascalie molto brevi o solo emoji/hashtag
possono dare un falso negativo (scartate anche se genuinamente italiane) —
compromesso preferito a mostrare contenuto chiaramente non italiano.

## UI `/trend-virali` (`src/routes/trend-virali.tsx`)

- **Toggle in cima**: "TikTok Trend" / "Google Trend" — card per ogni topic
  monitorato con volume attuale, crescita volumi ed engagement
  (`GrowthIndicator`), badge "Viralità marcata" se `isStrongGrowthSignal`.
  Mostra solo topic con `isCurrentlyRanked() === true`.
- **Feed dei post sotto**: filtri (piattaforma, hashtag origine, fonte,
  tipologia trending-topic/audio, ricerca testuale), ordinamento
  (viralità/data/engagement/views). Paginato: 20 alla volta
  (`PAGE_SIZE`), bottone "Carica altri" (+20), si resetta ad ogni cambio
  filtro.
- **`SocialEmbed`**: niente più lazy-load a scroll (rimosso
  l'`IntersectionObserver` che causava box neri prima del caricamento) per
  Instagram/YouTube/LinkedIn — montano l'iframe subito. TikTok è diverso e
  NON toccato: mostra sempre una thumbnail leggera via oEmbed, iframe vero
  solo al click su play (meccanismo separato, già pensato per evitare
  autoplay multipli).

## Il blocco Instagram ("login-wall") e come è stato affrontato

Un run reale con tutti gli hashtag monitorati in un'unica sessione
Playwright ha mostrato Instagram bloccare (redirect su login/challenge su
ogni richiesta successiva) dopo circa 500 richieste di dettaglio-post
consecutive nella stessa sessione — 0 blocchi nei primi ~10 hashtag, 100%
bloccato negli ultimi 3-4, sempre gli stessi per posizione in coda.

Diagnostica aggiunta prima di agire (`fetchMetricsDetailed` in
`instagram-public-metrics.mjs` ritorna `{metrics, reason}` con motivo del
fallimento: `login-wall`, `no-description`, `pattern-mismatch`,
`count-parse-fail`, `error:...`), poi fix strutturale: il workflow
`discover-instagram-hashtag-content.yml` è ora una **matrix a 2 shard**,
ogni job su un runner (quindi sessione/IP) diverso con metà degli hashtag
ciascuno (partizione deterministica via sort alfabetico, non l'ordine non
garantito dell'API). **Non ancora verificato con un run reale post-fix** —
vedi "Cosa verificare al prossimo avvio" sotto.

## Limiti noti, non ancora risolti

- **anysite Instagram search**: un run reale ha trovato 0/18 risultati per
  ogni keyword cercata (anche keyword molto comuni). Diagnosticato che
  `searchAnysite()` non lancia errori ma il post-processing (filtri lingua/
  keyword) scarta tutto — probabile che `normalizeAnysiteResult()` non trovi
  più il campo giusto nel payload anysite attuale. Log diagnostico già
  aggiunto (`[diagnostica] anysite: X raw (...) -> ...`), root cause non
  ancora confermata: serve leggere l'output del prossimo run reale.
- **`extractCaption`** (parsing della didascalia dalla description
  Instagram, usato per il filtro lingua) non è stato validato su tanti casi
  reali quanto il resto — copre il formato osservato finora (IT+EN, con e
  senza data riconosciuta), ma è la parte meno testata delle recenti
  aggiunte.
- **`list-instagram-content-urls.ts`** (usato da `recheck-viral-engagement.mjs`)
  non pagina/ruota: se ci sono più di 150 post Instagram nella finestra di
  7gg, gli stessi primi ~150 (ordine non esplicito, probabilmente per
  inserimento) vengono sempre ricontrollati e quelli oltre non vengono mai
  raggiunti. Non ancora un problema pratico ai volumi attuali, ma da tenere
  d'occhio se il numero di contenuti cresce.

## Cosa verificare al prossimo avvio di una nuova sessione

1. **Log del prossimo run reale di "Discover Instagram Hashtag Content"**
   (2 job separati dopo il fix a shard): il `login-wall` è sparito o molto
   ridotto? Ogni shard copre ~metà degli hashtag senza sovrapposizioni?
2. **Log dei prossimi 1-2 cicli di "Recheck Viral Engagement"**: compare la
   voce "non italiani -> da cancellare" e il conteggio scende nei run
   successivi (backfix che si esaurisce)?
3. **Log del prossimo "Sync Trend Virali"**: il diagnostico anysite mostra
   finalmente DOVE si perdono i risultati Instagram (0/18 ancora
   irrisolto)?
4. Se una check-in schedulata di questa sessione è ancora attiva (via
   `send_later`/Routine), potrebbe già aver risposto ad alcuni di questi
   punti — controllare la cronologia della conversazione prima di rifare
   lavoro già fatto.

## Convenzioni di sviluppo osservate in questo lavoro

- Branch di lavoro: `claude/viral-content-formula-social-wpbhx9` (su
  entrambi i repo collegati, `trendzn` e `trendzn-starhotels`)
- Prima di ogni nuova modifica: `git fetch origin main`, poi
  `git checkout -B <branch> origin/main` — il branch feature viene sempre
  ripartito da `main` aggiornato, mai accumulato su una base vecchia
  (ogni PR precedente viene mergiata singolarmente prima di iniziare la
  successiva)
- Verifica prima di ogni commit: `npx eslint <file> --fix`, poi
  `npx tsc --noEmit -p tsconfig.json` diffato contro un conteggio baseline
  (`git stash` / `git stash pop` per confrontare prima/dopo — nuovi errori
  sono accettabili solo se nella categoria "tabella/colonna non ancora nei
  tipi generati"), poi `npx vite build` come controllo di compilazione
  aggiuntivo (rigenera anche `routeTree.gen.ts` se serve)
- `rm -f package-lock.json` dopo qualunque `npm install`/`vite build`
  locale (il repo usa `bun.lock`)
- Ogni modifica → commit descrittivo (perché, non cosa) → push → PR via
  `mcp__github__create_pull_request` con summary/test plan → l'utente
  mergia manualmente
- **Non è possibile triggerare i workflow GitHub Actions da qui**:
  `mcp__github__actions_run_trigger` ritorna sempre 403 "Resource not
  accessible by integration" — l'utente deve lanciarli manualmente da
  GitHub Actions dopo il merge
- Migration SQL sempre come file in `supabase/migrations/`, mai applicate
  direttamente al DB di produzione da questa sessione (un tentativo di
  applicarle via MCP Supabase è stato esplicitamente negato dall'utente) —
  passano dal merge della PR come tutto il resto

## Riferimento rapido ai file principali

```
scripts/
  sync-viral-trends.mjs                  orchestratore principale (TikTok+Google Trends → Instagram/TikTok)
  sync-trending-it.mjs                   orchestratore TikTok Creative Center (hashtag reali IT)
  discover-instagram-hashtag-content.mjs discovery gratuita via pagina hashtag Instagram (matrix 2 shard)
  recheck-viral-engagement.mjs           ricontrollo gratuito engagement + backfix lingua
  lib/
    social-search.mjs                    ricerca/normalizzazione anysite+YouTube, looksItalian, containsKeyword
    instagram-public-metrics.mjs          fetchMetricsDetailed (likes/comments/data/caption, no login)
    word-segment.mjs                     hashtagToKeyword / keywordToHashtag (offline, EN+IT)
    openrouter.mjs                        conversione hashtag→keyword via LLM gratuito (con fallback)
    google-trends.mjs                     ricerche Google Trends IT

src/routes/api/public/hooks/
  monitor-topics.ts                      ciclo di vita monitored_topics (upsert + sweep)
  list-monitored-topics.ts               elenco topic monitorati (per UI e per discover script)
  record-topic-volume.ts                 snapshot volumi/engagement + calcolo crescita
  sync-viral-trends.ts                   upsert viral_trend_content (contenuti singoli)
  sync-trending-hashtags.ts              upsert tiktok_trending_hashtags + storico volumi TikTok
  recheck-viral-engagement.ts            aggiorna engagement post + cancella non italiani
  list-instagram-content-urls.ts         elenco URL Instagram da ricontrollare

src/lib/
  topicGrowth.ts                         formula di crescita a livello di topic
  virality.ts                            soglie di viralità post singolo
  viralTrends.ts                         data layer feed post (listViralTrendContent)
  monitoredTopics.ts                     data layer topic monitorati (isCurrentlyRanked)

src/routes/trend-virali.tsx               pagina principale
src/components/SocialEmbed.tsx            embed social (no lazy-load tranne TikTok)

supabase/migrations/                      vedi elenco sopra, tutte con timestamp 2026-0710-11
```

## Cronologia PR di questo lavoro (in ordine)

108–111: probe diagnostici Instagram (pre-v2, propedeutici).
112: probe su campione reale hashtag + Fasi 1-3.
113: recupero lavoro Fasi 1-8 dopo un merge anticipato di #112 (cherry-pick).
114: diagnostica 0 risultati anysite Instagram.
115: discovery Instagram — post oltre ai reel, filtro 7gg, 100/hashtag.
116: `isStrongGrowthSignal` + fix UI (engagement growth non mostrato).
117: rimozione lazy-load embed + paginazione feed post.
118: diagnostica motivi post Instagram non raggiungibili (login-wall ecc.).
119: intervallo reale nel badge variazione (non più "ultimi 7gg" fisso).
120: discovery Instagram su 2 job paralleli (fix login-wall).
121: backfill `delta_since` per contenuti pre-esistenti.
122: filtro lingua italiana anche sulla discovery gratuita via hashtag.
123: backfix lingua (recheck) + nasconde topic fuori classifica in UI.
124: crescita Instagram su base di confronto stabile (DB) invece di scrape singolo.

Tutte mergiate in `main` al momento della stesura di questo documento.
