# TRENDZN — Recap completo del progetto (handoff per una nuova sessione)

Documento unico e aggiornato per riprendere il progetto senza contesto
pregresso. **Consolida e supera** i due recap precedenti
(`docs/trend-virali-recap.md` e `docs/trendzn-recap.md`), rimasti indietro
rispetto ai cambi recenti (rimozione anysite, scaling discovery, fix
rilevamento lingua, monitoraggio X). In caso di conflitto, **questo file è
l'autorità**.

Ultimo aggiornamento: 2026-07-13.

---

## 1. Cos'è TRENDZN

App **TanStack Start** (React 19 + TanStack Router v1, SSR) con **Supabase**
(Postgres + Storage) come backend, Tailwind v4 + shadcn/ui. Build via preset
**Lovable.dev** (`@lovable.dev/vite-tanstack-config`) con Nitro/**Cloudflare
Workers** come target. `package.json` ha ancora il nome generico del template
(`tanstack_start_ts`); il prodotto si chiama TRENDZN nella UI.

Non è multi-tenant: è un singolo deployment con default hardcoded diversi per
feature/cliente (es. TikTok Hashtag → `starhotels`, Reputazione Brand →
`hyundai`). Esiste un repo gemello `trendzn-starhotels`, probabile fork
dedicato al cliente Starhotels (il lavoro su Trend Virali è stato replicato su
entrambi, stesso branch).

Ambiente: rete verso instagram/tiktok/google/x bloccata dall'ambiente di
sviluppo → lo scraping va verificato solo tramite run reali dei workflow
(probe), mai da qui.

---

## 2. Le feature (pagine)

- **Trend Virali** (`/trend-virali`) — la feature su cui si è lavorato di più.
  Vedi sezioni 3-8. Scopre e monitora hashtag/keyword in trend, ne traccia i
  volumi/engagement, mostra i contenuti virali reali.
- **Canali Inspo** (`/canali-inspo`, dentro `/feed`) — directory di canali
  social "di ispirazione". Fonte doppia: `trends.json` su GitHub (aggiornato
  da `sync-canali-feed.yml`) + `trend_submissions` (section canali-inspo).
- **Influencer** (`/influencer`, `/influencer-feed`) — come Canali Inspo ma per
  profili influencer, con tag `cliente`.
- **LinkedIn** (`/linkedin`) — legge solo `trend_submissions` (section
  linkedin); nessuna sync automatica (il `linkedin-sync/` è un prototipo
  Python non in produzione).
- **Piano Editoriale** (`/piano-editoriale`) — calendario editoriale mensile
  (post pianificati, copy per canale, approvazioni, media, canali cliente).
  Backend Supabase `editorial_*`. La feature più complessa dopo Trend Virali.
- **Reputazione Brand** (`/reputazione-brand`) — sentiment di un brand cliente
  (oggi Hyundai) via anysite + YouTube API. **NB: questo flusso usa ancora
  anysite** (`sync-brand-mentions`) — Trend Virali no (vedi §3).
- **TikTok Hashtag** (`/tiktok-hashtag`) — scraper di un hashtag cliente (oggi
  `starhotels`, ogni 30 min) + tabella hashtag aggregata (`tiktok_trending_hashtags`).
- **Trend Attuali / Evergreen / Real Time** — pagine più vecchie; merge di
  `trend_submissions` + lista statica, ingresso via mail (`poll-gmail`) o manuale.
- **Home** (`/`) — statica, card verso le feature.

### Ingresso contenuti "GitHub come storage"
Molte pagine (Canali Inspo, Influencer, in parte Trend Attuali/Evergreen/Real
Time) usano un file `trends.json` versionato su GitHub come sorgente
semi-statica, aggiornato da `poll-gmail.ts` (mail → sezioni), `submit-manual.ts`
(inserimento manuale), `sync-canali-feed.mjs` (RSS-Bridge).

---

## 3. Trend Virali — architettura ATTUALE (dopo i cambi recenti)

⚠️ Cambio importante rispetto ai vecchi recap: **anysite è stato RIMOSSO** da
Trend Virali (PR #136). Non si cerca più contenuto a pagamento per keyword. I
contenuti arrivano **solo dallo scraping gratuito delle pagine hashtag** (sia
Instagram che TikTok). Decisione esplicita dell'utente.

```
DISCOVERY (oraria, gratuita) — quali topic monitorare
  ├─ TikTok Creative Center ("TikTok Ads")
  │    scripts/discover-trending-hashtags.mjs (sessione CC persistita)
  │    scripts/sync-trending-it.mjs (orchestratore)
  │      → sync-trending-hashtags.ts → tiktok_trending_hashtags (rank, post_count)
  │        + topic_metrics_history (volumi TikTok, is_volume_exact=true)
  │    workflow: tiktok-trending-it.yml — cron ORARIO (minuto 0)
  │    Nota: la tabella rank riceve TUTTI gli hashtag col loro rank; MAX_HASHTAGS
  │    limita solo per quanti si scaricano anche i VIDEO (default 30).
  │
  ├─ Google Trends IT (feed RSS pubblico)
  │    scripts/lib/google-trends.mjs (ora estrae anche pubDate)
  │
  └─ sync-viral-trends.mjs (orchestratore discovery)
       - legge top 100 hashtag TikTok PER RANK (top-tiktok-hashtags.ts)
       - legge 50 keyword Google PER DATA più recente (pubDate)
       - registra tutti in monitored_topics (monitor-topics.ts)
       - riusa i video TikTok già raccolti (tiktok-hashtag-posts.ts) → contenuto
       workflow: sync-viral-trends.yml — cron ORARIO (minuto 30, sfalsato dopo TikTok)

CONTENUTI (scraping pagina hashtag, gratuito)
  ├─ Instagram: discover-instagram-hashtag-content.mjs
  │    scraping /explore/tags/<hashtag>/, matrix a 2 SHARD, ogni 6h
  │    → likes/comments/data/caption via meta tag (instagram-public-metrics.mjs)
  │    → sync-viral-trends.ts (viral_trend_content) + record-topic-volume.ts
  └─ TikTok: riuso dei video scrapati (in sync-viral-trends.mjs)

RICONTROLLO (gratuito, ogni 6h)
  └─ recheck-viral-engagement.mjs
       - riaggiorna engagement dei post Instagram in finestra 7gg
       - applica il filtro lingua e CANCELLA i post non italiani (anche via
         didascalia salvata, se il re-fetch è bloccato dal login-wall)
```

### Endpoint API principali (`src/routes/api/public/hooks/`)
- `monitor-topics.ts` — ciclo di vita monitored_topics (upsert + sweep scaduti)
- `list-monitored-topics.ts` — elenco topic (per UI e per lo script discovery);
  espone `last_seen_in_top5_at`
- `record-topic-volume.ts` — snapshot volumi/engagement + calcolo crescita. **Per
  Instagram ricalcola l'aggregato da viral_trend_content** (non dal singolo
  scrape — vedi §5)
- `sync-viral-trends.ts` — upsert dei contenuti in viral_trend_content
- `sync-trending-hashtags.ts` — upsert tiktok_trending_hashtags + storico volumi TikTok
- `recheck-viral-engagement.ts` — aggiorna engagement + cancella non italiani
- `list-instagram-content-urls.ts` — URL Instagram da ricontrollare (restituisce
  anche `content` per la pulizia lingua sotto login-wall)
- `top-tiktok-hashtags.ts` — hashtag PER RANK da tiktok_trending_hashtags
  (fallback frequenza da trend_submissions), cap 100

---

## 4. Filtro lingua italiana

`looksItalian()` distingue italiano da **spagnolo** (la trappola: molte
stopword "italiane" come la/un/una/con/se sono identiche in spagnolo). Usa
**marker discriminanti** — parole comuni in una lingua e assenti nell'altra
(di/de, che/que, per/por, è/es, più/más...) — e accetta solo se i marker
italiani sono ≥2 E superano quelli spagnoli.

Due copie da tenere allineate (non condivisibili a runtime: .mjs node vs .ts
Vite):
- `scripts/lib/social-search.mjs` — usata dagli script (discovery, recheck)
- `src/lib/language.ts` — usata dal frontend

Applicato in **tre punti**:
1. Ingestione (discover-instagram-hashtag-content.mjs) — non aggiunge spagnolo
2. Ricontrollo (recheck-viral-engagement.mjs) — cancella lo spagnolo già in DB
   (anche via didascalia salvata quando Instagram blocca il re-fetch)
3. **Lettura** (listViralTrendContent in viralTrends.ts) — nasconde subito i
   post non italiani nel feed, senza aspettare la pulizia del DB

Limite noto: didascalie cortissime/solo emoji possono dare falsi negativi.

---

## 5. Formule chiave

### Crescita a livello di topic — `src/lib/topicGrowth.ts`
- Finestra fissa 24h (`TOPIC_GROWTH_WINDOW_HOURS`)
- Soglia di rumore `MIN_ABSOLUTE_DELTA = 20`: sotto questo delta assoluto il
  risultato è `null` ("dati insufficienti"), non una % su campione minuscolo
- Soglia "in aumento" `GROWTH_THRESHOLD_PCT = 1` (1%)
- `isStrongGrowthSignal()` = crescono ENTRAMBI volume ED engagement ≥1% → badge
  "Viralità marcata"
- **Instagram: base di confronto stabile.** `record-topic-volume.ts` per
  Instagram NON usa il conteggio del singolo scrape (la pagina hashtag riordina
  i post tra un giro e l'altro → volumi ballerini) ma **ricalcola l'aggregato
  da tutto viral_trend_content** per quel topic in finestra 7gg. TikTok invece
  usa post_count di Creative Center (conteggio reale).

### Viralità del singolo post — `src/lib/virality.ts`
- Soglie esplicite (non più uno score): `isViral = deltaEngagement6h > 1000
  OPPURE engagement > 5000`
- `VIRALITY_WINDOW_DAYS = 7` (finestra feed + badge variazione)
- Il badge variazione mostra l'intervallo REALE (`delta_since`), non un fisso
  "ultimi 7gg"

### Topic "davvero in classifica" — `src/lib/monitoredTopics.ts`
- `isCurrentlyRanked()`: `last_seen_in_top5_at` fresco entro ~7h (cadenza sync +
  margine). Oltre → è nel periodo di grazia (24h, ancora `active` e monitorato
  in background) ma NON mostrato nel toggle UI.

---

## 6. UI `/trend-virali` (`src/routes/trend-virali.tsx`)
- **Toggle** in cima: "TikTok Trend" / "Google Trend" — card con volume attuale,
  crescita volumi ed engagement, badge "Viralità marcata". Mostra solo topic
  `isCurrentlyRanked`.
- **Feed** post sotto: filtri + ordinamento (viralità/data/engagement/views),
  **paginato** (20 + "Carica altri").
- **`SocialEmbed`**: niente lazy-load a scroll (rimosso, causava box neri) per
  Instagram/YouTube/LinkedIn; TikTok resta col suo meccanismo thumbnail+click.

---

## 7. X.com — stato e decisione

**X blocca l'accesso anonimo.** Il probe (PR #137) ha confermato: la pagina
`x.com/explore/tabs/trending` redirige a `x.com/i/jf/onboarding/web?...&mode=login`
(schermata login), zero trend/post leggibili senza account.

**Decisione dell'utente: opzione 1 — aggregatore pubblico gratuito.** Prendere
la lista dei trend X Italia + i volumi da un aggregatore che ripubblica i trend
senza login (getdaytrends.com/italy o trends24.in/italy). Questo dà **volumi
degli hashtag** (per il delta), NON i singoli post né l'engagement per-post su X
(strutturalmente bloccato senza account — accettato).

**Stato**: PR #142 ha aggiunto un **probe degli aggregatori**
(`scripts/probe-x-trends-aggregator.mjs` + workflow) per vedere quale espone
lista+volumi in modo pulito e con quali selettori. **DA FARE**: l'utente deve
lanciare il workflow "Probe X Trends Aggregator (diagnostico)" e passare il log;
poi si costruisce la pipeline X (vedi §9).

---

## 8. Problemi noti aperti

- **Login-wall Instagram (grave, non risolto).** `discover-instagram-hashtag-content.mjs`
  viene bloccato da Instagram (redirect login/challenge) in modo crescente:
  primi run OK, poi 100% bloccato — anche con la matrix a 2 shard (runner/IP
  diversi). I dati suggeriscono un blocco per reputazione dell'intervallo IP dei
  runner GitHub Actions (Azure) che peggiora nel tempo, non un limite
  per-sessione. Lo sharding non lo risolve. **Da decidere**: proxy/IP
  residenziali, ridurre frequenza, o accettare copertura Instagram parziale.
- **Contenuto video TikTok** limitato ai top 30 hashtag (scraping per-hashtag con
  45s di pausa non regge 100/ora). Il monitoraggio VOLUMI copre tutti i 100 (dai
  metadati CC). Servirebbe sharding come Instagram per più copertura video.
- **Sessione TikTok CC oraria**: più frequente di prima → un po' più di rischio
  rate-limit/blocco sul login persistito. Da tenere d'occhio.
- **`extractCaption`** (Instagram) poco validato su casi reali.
- **`list-instagram-content-urls`** senza paginazione (cap 150); si auto-risolve
  perché le cancellazioni fanno avanzare la finestra.

---

## 9. Cosa manca / prossimi passi

1. **Pipeline X (dopo il log del probe #142)**: nuovo `topic_type` es. `x-hashtag`
   (migration su monitored_topics + check discovery_source), scraper
   dell'aggregatore scelto, registrazione in monitored_topics, calcolo delta
   volumi con `topicGrowth.ts`, tab "X Trend" nella UI. Solo volumi (no
   engagement per-post, vedi §7).
2. **Login-wall Instagram**: decisione architetturale (vedi §8).
3. Fasi 9-10 del piano originale (audio predisposto; Canali Inspo cross-canale)
   — non iniziate, bassa priorità.

---

## 10. Convenzioni di sviluppo (importanti)

- Repo in scope: `teomotta88-cloud/trendzn` e `teomotta88-cloud/trendzn-starhotels`.
- **Un branch/PR per cambio logico.** Non si può avere più di una PR aperta sullo
  stesso branch → per lavori paralleli si usano branch distinti (`claude/<tema>-wpbhx9`).
- Prima di ogni cambio: `git fetch origin main` → `git checkout -B <branch> origin/main`.
  Se un cambio dipende da una PR non ancora mergiata, si fa lo **stack** sul suo
  branch (e si segnala l'ordine di merge nella PR).
- Verifica prima di ogni commit: `npx eslint <file> --fix` → `npx tsc --noEmit -p
  tsconfig.json` **diffato contro baseline** (`git stash`/`pop`; nuovi errori OK
  solo se categoria "tipi Supabase generati non ancora aggiornati") → `npx vite build`.
  - Nota: `vite build` può fallire su `exceljs` (feature SBAM) se non installato
    localmente — è preesistente, non tuo. `npm install exceljs` per una build pulita.
- `rm -f package-lock.json` dopo ogni `npm install`/build locale (il repo usa `bun.lock`).
- Migration SQL sempre come file in `supabase/migrations/`, **mai** applicate al DB
  di produzione dalla sessione (l'utente ha negato esplicitamente un tentativo).
- **Impossibile triggerare i workflow GitHub Actions da qui** (403). L'utente li
  lancia a mano dopo il merge e passa i log.
- Ogni PR via `mcp__github__create_pull_request`, l'utente mergia.
- Identità modello: NON metterla in commit/PR/codice.

---

## 11. Schema DB (Trend Virali) e migration

Tabelle: `monitored_topics` (lifecycle topic; `status` active/expired,
`last_seen_in_top5_at`, `monitoring_stops_at`; include già `trending-audio`),
`topic_metrics_history` (snapshot volumi/engagement per topic+piattaforma,
`is_volume_exact`), `viral_trend_content` (contenuti; `topic_id`,
`delta_engagement_6h`, `is_viral`, `delta_since`, `content`),
`viral_trend_metrics_history` (snapshot per post), `tiktok_trending_hashtags`
(classifica CC con `rank`, `post_count`).

Migration Trend Virali (in `supabase/migrations/`, timestamp 2026-0710-11):
monitored_topics, topic_growth, post_virality_thresholds, topic_latest_volume,
delta_since, backfill_delta_since.

**Nota tipi Supabase**: i tipi generati (`src/integrations/supabase/types.ts`)
sono sempre un po' indietro rispetto alle migration → errori tsc su
tabelle/colonne nuove sono attesi e si risolvono da soli quando i tipi si
rigenerano. Verificato via diff prima/dopo ad ogni PR.

---

## 12. Cronologia PR di questo blocco di lavoro

- 108–124: build v2 (schema, lifecycle, discovery Instagram, crescita, viralità,
  UI, fix vari) — vedi commit history.
- **125**: recap docs (i due file ora superati da questo).
- **130**: fix rilevamento lingua italiano vs spagnolo (marker discriminanti).
- **132**: filtro lingua in lettura (nasconde subito lo spagnolo nel feed).
- **136**: rimuove anysite (contenuti solo da scraping pagina hashtag).
- **137**: probe X.com → conferma login-wall.
- **139**: discovery oraria + 100 hashtag per rank + 50 keyword Google per data.
- **142**: probe aggregatori trend X (getdaytrends/trends24).
- **Prossima**: pipeline X (dopo il log del probe #142).

Tutte le PR fino alla #142 sono mergiate in `main`.

---

## 13. Riferimento rapido ai file

```
scripts/
  sync-viral-trends.mjs                  discovery topic (TikTok+Google) + riuso video TikTok (NO anysite)
  sync-trending-it.mjs                   orchestratore TikTok Creative Center
  discover-trending-hashtags.mjs         scraping hashtag CC (rank/volumi)
  discover-instagram-hashtag-content.mjs contenuti IG via pagina hashtag (2 shard)
  recheck-viral-engagement.mjs           ricontrollo engagement + pulizia lingua
  probe-x-trending.mjs                   probe X.com (conferma login-wall)
  probe-x-trends-aggregator.mjs          probe getdaytrends/trends24
  lib/
    social-search.mjs                    looksItalian (script), toIsoDate, ecc.
    google-trends.mjs                    feed RSS Google Trends IT (+ pubDate)
    instagram-public-metrics.mjs         fetchMetricsDetailed (likes/comments/data/caption)
    word-segment.mjs                     hashtag<->keyword offline
    openrouter.mjs                       hashtag->keyword via LLM (con fallback)

src/lib/
  topicGrowth.ts        crescita topic (+ isStrongGrowthSignal)
  virality.ts           soglie viralità post
  viralTrends.ts        data layer feed (+ filtro lingua in lettura)
  monitoredTopics.ts    data layer topic (+ isCurrentlyRanked)
  language.ts           looksItalian (frontend, speculare a social-search.mjs)

src/routes/trend-virali.tsx     pagina principale
src/components/SocialEmbed.tsx  embed social (no lazy-load tranne TikTok)
src/routes/api/public/hooks/    endpoint (vedi §3)

.github/workflows/
  tiktok-trending-it.yml               ORARIO (min 0) — discovery TikTok CC
  sync-viral-trends.yml                ORARIO (min 30) — discovery topic
  discover-instagram-hashtag-content.yml  ogni 6h, 2 shard — contenuti IG
  recheck-viral-engagement.yml         ogni 6h — ricontrollo/pulizia
  probe-x-trending.yml                 probe X (usa-e-getta)
  probe-x-trends-aggregator.yml        probe aggregatori (usa-e-getta)

docs/
  recap.md                 QUESTO FILE (autorità)
  trend-virali-recap.md    superato
  trendzn-recap.md         superato
  sbam-autographics-canva.md  feature separata (non Trend Virali)
```
