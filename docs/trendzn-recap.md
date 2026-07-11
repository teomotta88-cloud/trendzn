# TRENDZN — Recap del progetto (per una nuova sessione)

Panoramica dell'intero progetto TRENDZN, non solo della feature Trend
Virali (per quella, molto più dettagliata, vedi
`docs/trend-virali-recap.md`). Scritto per essere letto senza contesto
pregresso.

## Cos'è TRENDZN

App **TanStack Start** (React 19 + TanStack Router v1 + SSR) con
**Supabase** come backend (DB Postgres + Storage), stile **Tailwind CSS v4**
+ shadcn/ui (Radix). Buildata con Vite 7 tramite un preset gestito da
**Lovable.dev** (`@lovable.dev/vite-tanstack-config`), che include anche
Nitro con **Cloudflare Workers** come target di deploy — niente
`wrangler.toml` esplicito in repo, la config Cloudflare è implicita nel
preset. `package.json` ha ancora il nome generico del template
(`tanstack_start_ts`); il prodotto si chiama TRENDZN nella UI
(`src/routes/__root.tsx`).

Nessun `CLAUDE.md` nel repo. `README.md` è vuoto/placeholder. C'è un
`linkedin-sync/` a parte: un prototipo Python/Playwright per scraping
LinkedIn (nessuna sessione persistita in produzione), esplicitamente
etichettato "da verificare prima di produzione" nel suo stesso README — non
è agganciato a nessun workflow GitHub Actions.

**Non è multi-tenant** (vedi sezione dedicata più sotto) — è un singolo
deployment con default hardcoded diversi per feature/cliente.

## Le feature, una per una

### Trend Virali (`/trend-virali`)
La feature più recente e complessa, costruita/rifatta da zero in questa
serie di sessioni (v2). **Vedi `docs/trend-virali-recap.md` per il dettaglio
completo** — qui solo un cenno: scopre e monitora hashtag TikTok/keyword
Google Trends in trend, ne segue il ciclo di vita, calcola tassi di
crescita e soglie di viralità sui singoli post, mostra tutto in una UI con
toggle topic + feed.

### Canali Inspo (`/canali-inspo`, `/canali-inspo/:id`, dentro `/feed`)
Directory di canali social "di ispirazione" (non di un cliente specifico).
Fonte dati **doppia**: un file `trends.json` in un repo GitHub (letto via
`raw.githubusercontent.com`, aggiornato dal workflow `sync-canali-feed.yml`)　
**+** righe Supabase `trend_submissions` (`section='canali-inspo'`,
`status='approved'`, inserite via mail o manualmente). `canali-inspo.$id.tsx`
mostra il dettaglio di un canale coi singoli post embeddati; `feed.index.tsx`
aggiunge un secondo tab "Feed" che appiattisce tutti i post di tutti i
canali in un unico flusso cronologico filtrabile, con un bottone di sync
manuale (`trigger-sync-canali-feed` → dispatch del workflow) e un'azione
"segna come trend" per promuovere un post in Trend Real Time/Attuali/
Evergreen. Feature reale e attiva, non uno stub.

### Influencer (`/influencer`, `/influencer/:id`, `/influencer-feed`)
Stesso identico pattern di Canali Inspo ma per profili influencer
(`influencer_profiles` in `trends.json` + `trend_submissions` sezione
`influencer`), con l'aggiunta di un tag `cliente` per profilo e, sulla
pagina di dettaglio, un filtro di data (7/30/90gg/personalizzato) assente
nella controparte Canali Inspo.

### LinkedIn (`/linkedin`)
Più semplice delle altre pagine "social": legge SOLO da
`trend_submissions` (`section='linkedin'`), nessun merge con `trends.json`,
nessuna sync automatica — coerente col fatto che `linkedin-sync/` è ancora
un prototipo non in produzione. L'unico modo per far entrare contenuti oggi
è mail (`poll-gmail`) o inserimento manuale.

### Piano Editoriale (`/piano-editoriale`)
La feature più completa e complessa dopo Trend Virali: calendario
editoriale mensile con tre tab — **Calendario** (card per post pianificato,
copy per canale, approvazioni, galleria media), **Feed Instagram** (mock
della griglia IG del mese), **Canali cliente** (CRUD degli handle social
ufficiali del cliente). Backend interamente Supabase (`editorial_plans`,
`editorial_posts`, `editorial_post_approvals`, `editorial_post_comments`,
`editorial_post_media`, `editorial_client_channels`,
`editorial_published_posts`), data layer in `src/lib/editorialPlan.ts`
(usa `as any` sul client Supabase perché queste tabelle non sono ancora nei
tipi generati). Include anche un matching automatico tra i post
effettivamente pubblicati (letti da `trends.json`) e quelli pianificati,
via similarità testuale (`src/lib/textSimilarity.ts`, coefficiente Dice a
bigrammi).

### Reputazione Brand (`/reputazione-brand`)
Monitoraggio sentiment di un brand cliente (oggi configurato per
**Hyundai** — vedi `sync-brand-mentions.mjs`, `KEYWORDS` default
`"hyundai,hyundai_italia"`) su Twitter/Reddit/Instagram/LinkedIn (anysite) e
YouTube (Data API ufficiale). Grafico sentiment giornaliero, banner di
alert crisi non risolti, tabella menzioni. Stessa infrastruttura di ricerca
condivisa con Trend Virali (`scripts/lib/social-search.mjs`). Pipeline:
`sync-brand-mentions.yml` (cron giornaliero) → `sync-brand-mentions.mjs` →
hook `sync-brand-mentions.ts` → upsert `brand_mentions` + calcolo alert
crisi (confronto volume/sentiment negativo di oggi vs baseline 7gg).

### TikTok Hashtag (`/tiktok-hashtag`)
Scraper TikTok specifico per un hashtag cliente — oggi configurato per
**Starhotels** (`TIKTOK_HASHTAG` default `"starhotels"` in
`sync-tiktok-hashtag.mjs` e nel workflow `tiktok-hashtag.yml`, ogni 30
minuti). Mostra sia i singoli video (via `trend_submissions`,
`section='tiktok-hashtag'`) sia una tabella hashtag aggregata con
sparkline (`tiktok_trending_hashtags`, popolata da
`sync-trending-hashtags.ts`/Fase 3 di Trend Virali — la stessa tabella è
condivisa tra le due feature).

### Trend Attuali / Evergreen / Real Time
Tre pagine quasi identiche tra loro (probabilmente le più "vecchie" del
progetto): merge di `trend_submissions` (per la propria `section`) con una
lista statica bundlata da `src/data/trends.json`, griglia condivisa
(`TrendGrid`), inserimento manuale via `ManualSubmitDialog`. Il canale di
ingresso principale è la pipeline Gmail (`poll-gmail.ts`), non uno scraping
automatico dedicato.

### Home (`/`)
Statica: hero + card verso ogni feature. I conteggi per card sono
commentati nel codice (`//count: trendRealTime.length` ecc.) — rifinitura
mai completata, non blocca nulla.

## Infrastruttura condivisa

### Ingresso contenuti: il pattern "GitHub come storage" + Gmail
Molte feature (Canali Inspo, Influencer, in parte Trend Attuali/Evergreen/
Real Time) non hanno una vera tabella-per-tutto: usano un file
`trends.json` versionato su GitHub come sorgente semi-statica (letto
client-side via raw.githubusercontent.com), aggiornato da:
- `poll-gmail.ts` — pipeline principale di ingresso: legge una casella
  Gmail connessa (via il connector gateway di Lovable), instrada le mail
  in base a un tag `[sezione]` nell'oggetto, estrae URL social (risolve gli
  short-link TikTok), deduplica, inserisce in `trend_submissions` e,
  per canali-inspo/influencer, sincronizza anche `trends.json` su GitHub
- `submit-manual.ts` — stessa logica ma per inserimento manuale
  (`ManualSubmitDialog`, usato ovunque)
- `sync-canali-feed.mjs` (workflow ogni 3h) — rifà un vecchio workflow n8n:
  rilegge gli account da `trends.json`, li interroga via un'istanza
  self-hosted di RSS-Bridge (avviata come service container nel workflow
  stesso), aggiunge i post nuovi trovati direttamente su `trends.json`
- `add-client-channel.ts` / `delete-canale.ts` — scritture dirette su
  `trends.json` (con retry su conflitto SHA per `delete-canale.ts`)

### Componenti condivisi (`src/components/`)
- `SocialEmbed.tsx` — embed universale (Instagram/TikTok/YouTube/LinkedIn),
  usato ovunque ci sia un post da mostrare
- `TrendGrid.tsx` — griglia filtrabile condivisa da Trend Real Time/
  Attuali/Evergreen, TikTok Hashtag, LinkedIn
- `ManualSubmitDialog.tsx` — modale di inserimento manuale condivisa,
  configurazione per sezione che rispecchia i tag `[sezione]` di
  `poll-gmail.ts`
- `TrendingHashtagsTable.tsx` — tabella hashtag aggregati con sparkline SVG
  (solo per `/tiktok-hashtag`)
- `PianoEditoriale/` (9 file) — tutta la UI del calendario editoriale
  (`PostCard`, `NewPostCard`, `InstagramFeedPreview`, `PostNumberRail`,
  `PostReviewBlock`, `PostMediaGallery`+`MediaLightbox`, `EditableText`,
  `ClientChannelsPanel`)
- `ReputazioneBrand/` (3 file) — `AlertBanner`, `MentionsTable`,
  `SentimentTrendChart`

### `src/lib/` condivisi (oltre a quelli di Trend Virali)
- `editorialPlan.ts` — data layer completo di Piano Editoriale (il file
  più grande del progetto)
- `brandReputation.ts` — data layer di Reputazione Brand
- `textSimilarity.ts` — similarità testuale (Dice/bigrammi), usata solo dal
  matching automatico di Piano Editoriale
- `base64.ts` — decodifica base64 UTF-8-safe, usata ovunque si legga un
  file da GitHub (contenuti API sono base64)
- `utils.ts` — `cn()`, helper standard shadcn
- `config.server.ts` — placeholder quasi vuoto (solo `NODE_ENV` oggi)
- `error-capture.ts` / `error-page.ts` / `lovable-error-reporting.ts` —
  infrastruttura di gestione errori SSR (cattura errori globali perché h3
  a volte li inghiotte in un 500 generico, pagina di fallback statica,
  reporting lato client verso la telemetria di Lovable)

### Supabase (`src/integrations/supabase/`, generati automaticamente)
- `client.ts` — client pubblico/browser (chiave publishable)
- `client.server.ts` — `supabaseAdmin`, service-role, bypassa RLS — usato
  da quasi tutti gli hook API
- `auth-attacher.ts` / `auth-middleware.ts` — infrastruttura di
  autenticazione Supabase scaffoldata dal template Lovable, ma **non
  risulta usata da nessuna route reale** in questo momento (nessuna pagina
  passa da `requireSupabaseAuth`) — probabile boilerplate inattivo, non
  cancellarlo per errore pensando sia morto senza prima verificare
- `types.ts` — tipi generati, sempre un po' indietro rispetto alle
  migration appena mergiate (stesso discorso già documentato nel recap di
  Trend Virali) — `editorialPlan.ts` in particolare usa `as any` perché le
  sue tabelle non ci sono ancora

## Schema del database, per gruppo di feature

- **`trend_submissions`** (la tabella più vecchia/generica) — backing di
  quasi tutte le pagine "a sezione": `section` discrimina tra
  trend-real-time / trend-attuali / trend-evergreen / canali-inspo /
  linkedin / influencer / tiktok-hashtag. `url` unique.
- **Piano Editoriale**: `editorial_plans`, `editorial_posts`,
  `editorial_post_approvals`, `editorial_post_comments`,
  `editorial_post_media`, `editorial_client_channels`,
  `editorial_published_posts`
- **Reputazione Brand**: `brand_keywords`, `brand_mentions`,
  `brand_monitoring_runs`, `brand_sentiment_alerts`
- **TikTok trending hashtags**: `tiktok_trending_hashtags` (condivisa tra
  `/tiktok-hashtag` e Trend Virali Fase 3)
- **Trend Virali**: `viral_trend_content`, `viral_trend_runs`,
  `viral_trend_metrics_history`, `monitored_topics`,
  `topic_metrics_history` — vedi `docs/trend-virali-recap.md`

**Pattern RLS**: ogni tabella da metà 2026 in poi usa la stessa policy
permissiva ovunque: `create policy "public full access" on public.<table>
for all using (true) with check (true)` — CRUD completamente aperto alla
chiave anon/pubblica. Solo `trend_submissions` (la più vecchia) restringe a
`TO authenticated`. Il modello di sicurezza si è quindi progressivamente
allentato nel tempo, standardizzandosi su "accesso pubblico completo" per
ogni feature aggiunta dopo Piano Editoriale.

## Workflow GitHub Actions e cadenze

| Workflow | Script | Cadenza | Cosa fa |
|---|---|---|---|
| `tiktok-trending-it.yml` | `sync-trending-it.mjs` → `discover-trending-hashtags.mjs` | ogni 4h | hashtag TikTok reali in trend IT (TikTok Creative Center, sessione persistita) |
| `sync-viral-trends.yml` | `sync-viral-trends.mjs` | ogni 6h | Trend Virali: hashtag/keyword → ricerca Instagram/TikTok |
| `discover-instagram-hashtag-content.yml` | `discover-instagram-hashtag-content.mjs` | ogni 6h, 2 shard | Trend Virali: discovery gratuita Instagram via pagina hashtag |
| `recheck-viral-engagement.yml` | `recheck-viral-engagement.mjs` | ogni 6h | Trend Virali: ricontrollo engagement + backfix lingua |
| `sync-brand-mentions.yml` | `sync-brand-mentions.mjs` | giornaliero (06:00 UTC) | Reputazione Brand (oggi: Hyundai) |
| `tiktok-hashtag.yml` | `sync-tiktok-hashtag.mjs` → `scrape-tiktok-hashtag.mjs` | ogni 30 min | TikTok Hashtag cliente (oggi: Starhotels) |
| `sync-canali-feed.yml` | `sync-canali-feed.mjs` (+ service container RSS-Bridge) | ogni 3h | aggiorna `trends.json` per Canali Inspo/Influencer |
| `probe-instagram-*.yml` (5 workflow) | vari `probe-*.mjs` | solo `workflow_dispatch` | diagnostici usa-e-getta, non in produzione |

**Nota**: nessun workflow può essere triggerato da una sessione Claude Code
(`workflow_dispatch` via MCP ritorna sempre 403) — vanno lanciati
manualmente dall'utente da GitHub Actions dopo ogni merge.

## "Multi-tenancy": non esiste, è hardcoded per feature

Non c'è alcun concetto di tenant/cliente nel codice — nessuna env var
`CLIENT_ID`/`BRAND_ID`, nessuna tabella tenant, nessuna risoluzione del
cliente a runtime. Ogni feature ha invece un cliente diverso **cablato nei
default** dello script/workflow che la alimenta:
- TikTok Hashtag → **Starhotels** (`TIKTOK_HASHTAG=starhotels`)
- Reputazione Brand → **Hyundai** (`KEYWORDS=hyundai,hyundai_italia`)
- Piano Editoriale → un solo cliente implicito per deployment
  (`editorial_client_channels` è una lista piatta, non per-cliente)

Il repo gemello **`trendzn-starhotels`** (in scope in questa sessione
insieme a `trendzn`) è quasi certamente un **fork/deployment separato** di
questo stesso codebase, personalizzato per il cliente Starhotels — non un
codebase condiviso pilotato da configurazione a runtime. Il lavoro su
Trend Virali in questa sessione è stato infatti replicato su entrambi i
repo, stesso branch, stesse modifiche.

## Cose non finite / solo scaffolding

- Home page: conteggi per card commentati, mai attivati
- `auth-middleware.ts`/`auth-attacher.ts`: infrastruttura di auth Supabase
  presente ma non agganciata a nessuna route reale
- `linkedin-sync/`: prototipo Python/Playwright, esplicitamente "da
  verificare prima di produzione" nel suo README, non in nessun workflow
- `config.server.ts`: placeholder quasi vuoto
- I 5 workflow `probe-instagram-*`: diagnostici usa-e-getta di Trend
  Virali, mai stati parte della pipeline di produzione

## Convenzioni di sviluppo (valide per l'intero progetto, non solo Trend Virali)

- Repository in scope per questa sessione: `teomotta88-cloud/trendzn` e
  `teomotta88-cloud/trendzn-starhotels`, branch di lavoro
  `claude/viral-content-formula-social-wpbhx9` su entrambi
- Prima di ogni modifica: `git fetch origin main` →
  `git checkout -B <branch> origin/main` (mai accumulare su una base
  vecchia — ogni PR precedente va mergiata prima di iniziare la successiva)
- Verifica prima di ogni commit: `npx eslint <file> --fix`, poi
  `npx tsc --noEmit -p tsconfig.json` diffato contro un conteggio baseline
  (`git stash`/`git stash pop`) — nuovi errori accettabili solo se della
  categoria "tabella/colonna non ancora nei tipi Supabase generati", poi
  `npx vite build` come controllo di compilazione aggiuntivo
- `rm -f package-lock.json` dopo qualunque `npm install`/build locale (il
  repo usa `bun.lock`)
- Ogni modifica → commit descrittivo (il perché, non il cosa) → push → PR
  via `mcp__github__create_pull_request` → merge manuale dell'utente
- Migration SQL sempre come file in `supabase/migrations/`, mai applicate
  direttamente al DB di produzione da una sessione (richiesto
  esplicitamente dall'utente)
- Impossibile triggerare workflow GitHub Actions da qui (403) — sempre
  l'utente, manualmente

## Documenti correlati

- `docs/trend-virali-recap.md` — recap approfondito della sola feature
  Trend Virali (architettura dettagliata, formule, PR history, problemi
  aperti)
