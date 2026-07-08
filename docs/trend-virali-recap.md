# Trend Virali — Recap per una nuova sessione

Questo documento spiega da zero il flusso "Trend Virali" (pagina `/trend-virali`):
cosa fa, come è costruito, cosa riusa dalla pagina "Reputazione Brand", e i due
problemi aperti da risolvere. Scritto per essere letto senza contesto pregresso.

## Obiettivo del flusso

Trovare contenuti Instagram e TikTok **reali**, ordinati per **views/engagement
reali**, partendo dagli hashtag TikTok che sono in trend in Italia in questo
momento — indipendentemente dall'hashtag stesso (non è "tutti i post con
#luglio", è "cosa sta girando ORA legato al tema di #luglio").

L'idea alla base: un hashtag TikTok in trend (es. `#lafavolapersempre`) non è
una parola di ricerca comoda per altre piattaforme — va prima trasformato in
una keyword leggibile ("La favola per sempre"), poi quella keyword viene
cercata altrove per trovare contenuti reali con metriche reali.

## Pipeline, passo per passo

```
1. TikTok Trending IT (pipeline già esistente, indipendente)
   → hashtag reali in trend, salvati in trend_submissions

2. top-tiktok-hashtags (endpoint)
   → legge i 5 hashtag più frequenti degli ultimi 3 giorni da trend_submissions

3. hashtag → keyword (scripts/sync-viral-trends.mjs)
   → OpenRouter (LLM gratuito) con fallback offline a dizionario

4. ricerca della keyword
   → Instagram via anysite (stessa infra di Reputazione Brand)
   → TikTok riusando i video già raccolti dalla pipeline del punto 1

5. sync-viral-trends (endpoint) → tabella viral_trend_content

6. pagina /trend-virali → mostra i contenuti ordinati per views/engagement
```

### 1. Scoperta hashtag TikTok in trend

Pipeline **indipendente e preesistente**, non toccata in questo lavoro:

- `scripts/discover-trending-hashtags.mjs` — legge gli hashtag in trend da
  TikTok Creative Center (login richiesto, sessione persistita via cache di
  GitHub Actions)
- `scripts/scrape-tiktok-hashtag.mjs` — per ogni hashtag, apre
  `tiktok.com/tag/<hashtag>` con Playwright e legge dal DOM gli URL dei video
  mostrati. **Ora estrae anche le views** di ogni video (vedi "Problema 1"
  sotto)
- `scripts/sync-trending-it.mjs` — orchestratore, chiama i due sopra e scrive
  su Supabase via l'endpoint `sync-tiktok-hashtag`
- Workflow: `.github/workflows/tiktok-trending-it.yml`, ogni 12h

Scrive in `trend_submissions` (`section = 'tiktok-hashtag'`), con `tags =
[hashtag]`. **Attenzione**: questa stessa tabella/section è condivisa con uno
scraper per il brand cliente Starhotels (`TIKTOK_HASHTAG=starhotels`, ogni 30
min, workflow `tiktok-hashtag.yml`) — l'hashtag `starhotels` va sempre escluso
quando si aggregano gli hashtag "in trend" (già fatto in `top-tiktok-hashtags.ts`).

### 2. Endpoint `top-tiktok-hashtags`

`src/routes/api/public/hooks/top-tiktok-hashtags.ts` — legge da
`trend_submissions` i tag più frequenti negli ultimi 3 giorni (esclude
`starhotels`), ne restituisce i primi N (default 5, `MAX_HASHTAGS`).

Perché non legge da `tiktok_trending_hashtags` (la tabella con rank/views
della tabella-hashtag mostrata in cima a `/tiktok-hashtag`)? Perché non è mai
stato confermato che quella migration sia applicata al DB di produzione;
`trend_submissions` invece è sicuramente popolata e viva.

### 3. Conversione hashtag → keyword

`scripts/sync-viral-trends.mjs`, funzione `hashtagsToKeywords`:

1. Prova `scripts/lib/openrouter.mjs` — chiama un modello **gratuito** su
   OpenRouter (`meta-llama/llama-3.3-70b-instruct:free` di default, env
   `OPENROUTER_MODEL`), un'unica chiamata batch per tutti gli hashtag.
   Nessuna carta di credito richiesta per la chiave. **Problema noto**: il
   modello free è spesso congestionato (429 "temporarily rate-limited
   upstream") — capitato in entrambi i run reali fatti finora.
2. Se OpenRouter non è configurato o fallisce, ripiega su
   `scripts/lib/word-segment.mjs`: un segmentatore Viterbi scritto da zero,
   offline, che combina un dizionario inglese (126k parole, da wordsninja) e
   uno italiano (25k parole più frequenti, da
   [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)).
   Funziona bene su parole comuni ("lafavolapersempre" → "La favola per
   sempre"), **fallisce sui nomi propri/toponimi** non a dizionario
   ("torvergata" → "Tor Verg At A" invece di "Tor Vergata") — è per risolvere
   proprio questo caso che è stato aggiunto OpenRouter.

### 4. Ricerca della keyword

**Instagram** — `fetchInstagramContent` in `sync-viral-trends.mjs`, usa
`searchAnysite()` da `scripts/lib/social-search.mjs` (stessa funzione condivisa
con Reputazione Brand, vedi sotto). Nessun filtro di data applicato qui.

**TikTok** — anysite **non supporta la ricerca TikTok per keyword** (verificato
leggendo la loro documentazione). Quindi per TikTok non si cerca la keyword:
si riusano i video già raccolti al passo 1 per lo **stesso hashtag esatto**
(non la keyword derivata), tramite l'endpoint `tiktok-hashtag-posts.ts`. Le
uniche metriche disponibili sono le views (se lo scraping del passo 1 le ha
estratte con successo — vedi "Problema 1").

### 5. Scrittura su Supabase

`src/routes/api/public/hooks/sync-viral-trends.ts` — upsert su
`viral_trend_content` (schema: `platform, external_id, url, author, content,
published_at, source_hashtag, keyword_matched, engagement, reach, is_viral,
raw`). **Fix recente**: anysite a volte restituisce lo stesso post due volte
nello stesso batch, il che faceva fallire l'intero upsert Postgres ("ON
CONFLICT DO UPDATE command cannot affect row a second time") — ora c'è un
dedup per `platform:external_id` prima dell'upsert.

### 6. Pagina `/trend-virali`

`src/routes/trend-virali.tsx` + `src/lib/viralTrends.ts`. Fetcha da
`viral_trend_content`, filtro `created_at >= now() - sinceDays` (default 14
giorni — **attenzione, vedi Problema 2**), ordina per `reach desc, engagement
desc`. Filtri UI: piattaforma, hashtag di origine, intervallo giorni, ricerca
testuale.

## Come funziona Reputazione Brand (infrastruttura condivisa)

`/reputazione-brand` è il flusso "gemello" più vecchio, da cui Trend Virali
riusa la logica di ricerca. Serve capirlo perché **la stessa infrastruttura
sostiene entrambe le feature**, e un fix a una spesso vale anche per l'altra.

**Scopo**: monitorare le menzioni di un brand cliente (oggi: `hyundai`,
`hyundai_italia`, keyword statiche) su Twitter/X, Reddit, Instagram, LinkedIn
(via anysite) e YouTube (via Data API v3 ufficiale, gratuita), classificarne il
sentiment, alertare su anomalie.

**Pipeline**:
- `scripts/sync-brand-mentions.mjs` — per ogni combinazione
  piattaforma×keyword, cerca e normalizza i risultati usando le stesse
  funzioni di `scripts/lib/social-search.mjs` usate da Trend Virali
  (`searchAnysite`, `searchYouTube`, `normalizeAnysiteResult`,
  `normalizeYouTubeResult`), poi aggiunge la classificazione sentiment
  (`classifySentiment`, euristica a parole chiave positive/negative) — questo
  è l'unico pezzo NON condiviso con Trend Virali, perché non ha senso per
  keyword generiche non legate a un brand.
- `src/routes/api/public/hooks/sync-brand-mentions.ts` — upsert su
  `brand_mentions` (stesso schema di `viral_trend_content` + `sentiment` e
  `category`), stesso dedup fix applicato di recente, più logica di crisis
  alert (`brand_sentiment_alerts`): confronta il volume di oggi con la
  baseline a 7 giorni per piattaforma, alert se >2-3x o se il sentiment
  negativo supera il 30-50%.
- Workflow: `.github/workflows/sync-brand-mentions.yml`, cron giornaliero.

**Pagina**: `src/routes/reputazione-brand.index.tsx` + `src/lib/brandReputation.ts`
(`listMentions`) + componenti in `src/components/ReputazioneBrand/`
(`MentionsTable`, `SentimentTrendChart`, `AlertBanner`). **Ordinamento
attuale: solo `created_at desc`** — nessun ordinamento per engagement, a
differenza di Trend Virali che ordina per `reach`/`engagement`. Filtri UI:
piattaforma, sentiment, intervallo giorni (7/14/30/90).

**Perché è rilevante per Trend Virali**: `scripts/lib/social-search.mjs` è il
cuore di ricerca condiviso da entrambi i flussi. Un fix ai path anysite (solo
`/api/twitter/search/posts` è stato confermato reale da un run; reddit/
instagram/linkedin sono dedotti per coerenza di naming e mai confermati da
documentazione ufficiale — vedi commento `ANYSITE_ENDPOINTS` nel file) vale
per entrambe le pipeline.

## Problema 1 — TikTok: niente engagement/views affidabili

L'utente lo definisce "inutile" così com'è. Le views TikTok vengono estratte
in `scripts/scrape-tiktok-hashtag.mjs`, funzione `extractLinksWithViews`,
best-effort:

1. Prova i selettori `[data-e2e="video-views"]` e
   `[data-e2e="common-Video-Count"]` vicino al link del video (il secondo è
   confermato reale ma per la pagina **profilo utente**, da TikTokBridge.php
   di RSS-Bridge — non è mai stato verificato se vale anche per la pagina
   **hashtag**, che è quella usata qui)
2. Fallback generico: cerca un testo tipo "129.5K" tra i discendenti del link

**Non c'è mai stata conferma diretta** che questa estrazione funzioni sulla
pagina hashtag reale — i log del workflow stampano `Views estratte per N/M
video` ma quel numero non è stato ancora ispezionato in dettaglio in
conversazione. Ipotesi da verificare nella prossima sessione:

- Controllare i log reali di `tiktok-hashtag.yml` / `tiktok-trending-it.yml`
  per vedere quante views vengono davvero estratte (`grep "Views estratte"`)
- Se il numero è sistematicamente basso/zero, i selettori vanno corretti —
  serve ispezionare l'HTML reale della pagina hashtag (impossibile da questo
  ambiente di sviluppo, rete verso tiktok.com bloccata: va fatto scaricando
  l'HTML in un run reale, es. salvandolo come artifact, come già fatto altrove
  nel progetto per il debug di TikTok Creative Center — vedi
  `discover-trending-hashtags.mjs` per il pattern)
- Anche quando le views ci sono, **manca comunque like/commenti** — TikTok
  resta strutturalmente più povero di dati di Instagram, che invece riceve
  `engagement` reale (like+share+commenti) da anysite

**Decisione da prendere**: vale la pena investire per rendere affidabile
l'estrazione views, o è più sensato togliere TikTok dal feed "Trend Virali"
(tenerlo solo nella pagina `/tiktok-hashtag` esistente, che non pretende di
ordinare per engagement)? L'utente ha detto "tiktok non ha dati di engagement
e views, è inutile" — probabile che la risposta preferita sia la seconda, ma
va confermato.

## Problema 2 — Instagram: contenuti troppo vecchi

`fetchInstagramContent` in `sync-viral-trends.mjs` non applica **nessun
filtro di data** ai risultati di `searchAnysite()`: anysite restituisce
risultati per rilevanza rispetto alla keyword, non necessariamente recenti, e
lo script li accetta tutti.

Il filtro `sinceDays` che esiste in `src/lib/viralTrends.ts`
(`listViralTrendContent`) filtra su `created_at` (quando **noi** abbiamo
sincronizzato la riga), non su `published_at` (quando il post è stato
**pubblicato**) — quindi un post di un anno fa, sincronizzato oggi per la
prima volta, passa comunque il filtro "ultimi 14 giorni" perché la riga in DB
è stata creata oggi.

**Fix plausibili per la prossima sessione** (da valutare, non ancora
implementati):
1. Scartare a monte (in `fetchInstagramContent`, prima di mandare tutto a
   `sendToHook`) i risultati con `published_at` più vecchio di N giorni
2. Cambiare il filtro in `listViralTrendContent` per usare `published_at`
   invece di (o in aggiunta a) `created_at`
3. Verificare se anysite offre un parametro di ordinamento/filtro data nella
   request (`searchAnysite` in `scripts/lib/social-search.mjs` oggi manda solo
   `{[param]: query, count: maxResults}` — nessun parametro di data)

## Terza richiesta esplicita: ordinamento per data/engagement

L'utente ha chiesto di poter ordinare per data O per engagement (oggi
`/trend-virali` ordina *solo* per `reach desc, engagement desc`, senza
possibilità di cambiare). Da aggiungere: un controllo UI (select/toggle,
stesso pattern dei filtri già presenti in `trend-virali.tsx`) che cambi
l'`order()` della query in `listViralTrendContent` tra:
- `reach desc, engagement desc` (attuale, default)
- `published_at desc` (più recenti prima)

Nota: anche `/reputazione-brand` potrebbe beneficiare dello stesso
miglioramento (oggi ordina solo per `created_at desc`, mai per engagement) —
da valutare se estendere lì pure, dato che condivide l'infrastruttura.

## File coinvolti (riferimento rapido)

```
scripts/
  sync-viral-trends.mjs          orchestratore Trend Virali
  sync-brand-mentions.mjs        orchestratore Reputazione Brand
  sync-tiktok-hashtag.mjs        scraper brand Starhotels (ogni 30 min)
  sync-trending-it.mjs           orchestratore TikTok Trending IT (ogni 12h)
  scrape-tiktok-hashtag.mjs      scraping pagina hashtag TikTok + views
  discover-trending-hashtags.mjs discovery hashtag da TikTok Creative Center
  lib/
    social-search.mjs            ricerca/normalizzazione condivisa (anysite + YouTube)
    word-segment.mjs             segmentatore offline EN+IT (fallback)
    openrouter.mjs                conversione hashtag->keyword via LLM gratuito

src/routes/api/public/hooks/
  top-tiktok-hashtags.ts         top hashtag in trend (esclude starhotels)
  tiktok-hashtag-posts.ts        video TikTok + views per un hashtag
  sync-viral-trends.ts           upsert viral_trend_content (con dedup)
  sync-tiktok-hashtag.ts         upsert trend_submissions (con view_count)
  sync-brand-mentions.ts         upsert brand_mentions (con dedup)

src/routes/
  trend-virali.tsx               pagina Trend Virali
  reputazione-brand.index.tsx    pagina Reputazione Brand

src/lib/
  viralTrends.ts                 data layer Trend Virali
  brandReputation.ts             data layer Reputazione Brand

src/components/ReputazioneBrand/
  MentionsTable.tsx, SentimentTrendChart.tsx, AlertBanner.tsx

supabase/migrations/
  20260706160000_brand_reputation_monitoring.sql   brand_mentions e affini
  20260708100000_viral_trend_content.sql           viral_trend_content
  20260708150000_viral_trend_content_allow_tiktok.sql
  20260708170000_trend_submissions_view_count.sql  views TikTok

.github/workflows/
  sync-viral-trends.yml          cron giornaliero (03:00 UTC)
  sync-brand-mentions.yml        cron giornaliero
  tiktok-trending-it.yml         cron ogni 12h
  tiktok-hashtag.yml             cron ogni 30 min (brand Starhotels)
```

## Stato attuale (2026-07-08)

- Pipeline **tecnicamente funzionante**: ultimo run reale ha sincronizzato 99
  contenuti (54 Instagram + 45 TikTok) senza errori
- OpenRouter fallisce sistematicamente con 429 sul modello gratuito di
  default — il fallback funziona ma produce keyword peggiori sui nomi propri
- Nessuna verifica ancora fatta su quante views TikTok vengono realmente
  estratte con successo
- Instagram non filtra per recency — contenuti vecchi mescolati a quelli
  freschi
- Nessun controllo UI per cambiare l'ordinamento (solo reach/engagement,
  hardcoded)
