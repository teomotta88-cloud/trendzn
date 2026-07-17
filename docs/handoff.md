# Handoff — Monitoraggio social X e Facebook per ASPI-monitoring

Documento di passaggio per questa specifica linea di lavoro (non sostituisce
`docs/recap.md`, che copre l'intero progetto). Copre la sessione dedicata
all'integrazione di X/Twitter e Facebook nella pagina **ASPI-monitoring**.

Ultimo aggiornamento: 2026-07-17.

---

## 1. Obiettivo — cosa stiamo cercando di costruire

La pagina **ASPI-monitoring** (`/aspi-monitoring`, store indipendente
`src/data/aspi-monitoring.json`) mostra un feed di post recenti per un elenco
di "canali" (account social) monitorati. Instagram e TikTok erano già
coperti via RSS-Bridge (`sync-aspi-monitoring.mjs`, orario). Mancavano **X
(Twitter)** e **Facebook**, entrambi senza API gratuita ufficialmente
disponibile per questo caso d'uso:

- **X**: l'API ufficiale è a pagamento; strada scelta, esplicitamente accettata
  dall'utente col rischio di fragilità, è un **account X dedicato** via la
  libreria non ufficiale `rettiwt-api` (reverse-engineering delle risposte
  GraphQL interne di X — si rompe se X cambia schema).
- **Facebook**: nessuna API gratuita per pagine di terzi senza app review.
  Strada scelta: scraping via **Playwright headless, accesso anonimo** (nessun
  login), accettando il limite reale della piattaforma (vedi §5).

L'obiettivo finale è che entrambe le piattaforme scrivano nuovi post nello
stesso store JSON, con lo stesso schema di IG/TikTok (`platform`, `handle`,
`url`, `date`, `caption`, `imageUrl`), così da comparire automaticamente nel
feed UI (`feed.index.tsx`, componente `TrendzFeed` condiviso) e nell'export
PPTX (`export-feed-pptx.ts`) senza modifiche aggiuntive.

## 2. Stato attuale — a che punto siamo

**Entrambe le pipeline sono in produzione e confermate funzionanti su dati
reali** (non solo probe):

- **X**: `scripts/sync-x-posts.mjs` + workflow `sync-x-posts.yml` (cron
  orario, minuto `:15`). Confermato: 80 tweet reali aggiunti al primo run
  reale (4 account monitorati), metriche di engagement lette correttamente,
  cap a 15 post/canale applicato per data reale.
- **Facebook**: `scripts/sync-facebook-posts.mjs` + workflow
  `sync-facebook-posts.yml` (cron ogni 2h, minuto `:45`). Dopo l'ultimo fix,
  12 pagine su 15 sincronizzate con successo in un run reale (le altre 3
  rientrano al giro successivo grazie allo shuffle, vedi §4).
- UI (`feed.index.tsx`) e export PPTX (`export-feed-pptx.ts`) già
  riconoscono `platform: "x"` e `platform: "facebook"` (badge, colori,
  fallback a thumbnail quando non c'è embed — Facebook non ha un embed
  pubblico semplice, X nemmeno).

Verificato **a fondo e chiuso** (nessun'altra azione prevista): la
possibilità di recuperare più di 1 post per pagina Facebook per singola
visita. Entrambe le alternative testate (RSS-Bridge, mbasic.facebook.com)
sono vicoli ciechi confermati con dati reali (dettaglio in §5). L'approccio
"poll frequente ogni 2h + accumula nel tempo" resta la strategia definitiva
per Facebook.

## 3. Su cosa stavo lavorando (ultimo task di questa sessione)

L'ultima richiesta esplicita dell'utente ("verifichiamo approfonditamente la
possibilità di recuperare fino a 5 post pubblicati su una pagina Facebook")
è stata **completata**: probe dedicato (`probe-facebook-alt-sources.mjs`,
PR #162, mergiata) ha testato RSS-Bridge e mbasic.facebook.com su 4 pagine
reali, risultato negativo per entrambi (§5). Non ci sono azioni di codice
pendenti su questo fronte. Il branch di lavoro
`claude/viral-content-formula-social-wpbhx9` è allineato a `main` (tutte le
PR di questa sessione mergiate: #157-#162).

## 4. Cosa ho cambiato (in ordine cronologico, PR #157→#162)

- **PR #157** — `probe-x-account.yml`: Node 20→22 (rettiwt-api 7.1.x
  dichiara `engines: node ^22.21.0`).
- **PR #158** — `probe-x-account.mjs`: fix lettura metriche engagement
  (campi piatti `tweet.likeCount`/`retweetCount`/ecc., non annidati come
  indovinato in origine); rimosse varianti `tweet.search({query: "from:..."})`
  confermate non funzionanti.
- **PR #159** — **due cose**:
  - Nuovo `scripts/sync-x-posts.mjs` + `sync-x-posts.yml`: sync di produzione
    per X, cron orario `:15`, usa `rettiwt-api` con `tweet.search({fromUsers})`.
  - **Bug critico corretto in `sync-facebook-posts.mjs`** (già in produzione
    da una PR precedente a questa sessione): il filtro cercava account con
    `platform === "facebook"`, ma **nessun account reale ha quel valore** —
    arrivano tutti da un import generico taggato `platform: "web"`. Il sync
    Facebook schedulato ogni 2h non aveva mai sincronizzato nulla. Fix:
    riconoscimento per host dell'URL (`facebook.com`/`fb.com`), non più per
    il campo `platform`. La stessa identica logica è stata applicata da
    subito a `sync-x-posts.mjs` per evitare lo stesso bug su X.
- **PR #160** — `sync-facebook-posts.mjs`: diagnostica (conteggio
  dialog/articoli DOM, titolo pagina) prima e dopo lo scroll + screenshot
  automatico solo sulle pagine con 0 post trovati, caricato come artifact
  del workflow.
- **PR #161** — `sync-facebook-posts.mjs`, due fix distinti trovati dai log
  della diagnostica sopra:
  - **Mitigazione rate-limit**: dopo ~8 pagine visitate in rapida sequenza
    dallo stesso IP del runner, Facebook iniziava a servire una pagina
    generica bloccata (titolo `"Facebook"`, 0 articoli) per il resto del
    run. Fix: ordine delle pagine mescolato (Fisher-Yates) ad ogni run +
    pausa randomizzata 3-6s tra una pagina e l'altra.
  - **Fix duplicati**: lo stesso post veniva salvato due volte, una con e
    una senza `?comment_id=...` in coda all'URL (deep-link a un commento
    dello stesso post, non un post diverso). Rimosso in
    `stripTrackingParams` + pulizia una tantum dei duplicati già scritti
    nello store da run precedenti al fix.
- **PR #162** — Nuovo `scripts/probe-facebook-alt-sources.mjs` +
  `probe-facebook-alt-sources.yml`: probe diagnostico (nessuna modifica al
  sync di produzione) per verificare RSS-Bridge e mbasic.facebook.com come
  possibili fonti di più post per pagina. Risultato: entrambi non
  funzionanti (§5). Nessun cambiamento alla pipeline di produzione ne è
  derivato — resta l'approccio Playwright + shuffle + delay di PR #161.

## 5. Cosa non ha funzionato (vicoli ciechi confermati, da non ritentare)

- **`tweet.search({ query: "from:X" })` / `"from:@X"`** (rettiwt-api): non
  filtra per utente, restituisce tweet irrilevanti. Solo
  `fromUsers: [screenName]` funziona.
- **rettiwt-api con Node 20**: fallisce con un generico "Unknown error"
  lato `FetcherService` — la libreria richiede Node `^22.21.0`, non è un
  problema di autenticazione/schema come sembrava all'inizio.
- **RSS-Bridge `FacebookBridge`**: fallisce con `"Bridge returned error 0!
  (20651)"` su ogni pagina testata. I suoi selettori CSS
  (`#pagelet_timeline_main_column`, classi hash tipo `._585r`) sono di una
  Facebook di anni fa, non più presente nel markup attuale. Non recuperabile
  senza riscrivere il bridge da zero — e avrebbe comunque lo stesso
  problema strutturale (Facebook cambia markup di continuo).
- **`mbasic.facebook.com`**: completamente bloccato dietro login per accesso
  anonimo (redirect a `login.php`/`m.facebook.com`, 0 contenuti pubblici
  visibili), sia via fetch semplice sia via Playwright. Non è una via
  "meno bloccata" come si pensava inizialmente — è sbarrata del tutto.
- **`sizing: contain` di pptxgenjs** (fix di una sessione precedente, non di
  questo filone X/Facebook ma stesso principio: non fidarsi delle opzioni
  della libreria senza leggerne la sorgente) — non misura mai le dimensioni
  reali di immagini base64, richiede calcolo manuale del contain-box.

## 6. Cosa avrei cambiato successivamente (prossimi passi ragionevoli)

Nessuna azione è bloccante o richiesta con urgenza — il sistema è stabile e
in produzione. Se si riprende questo filone, nell'ordine di valore/costo:

1. **Osservare 2-3 cicli di cron reali** di `sync-facebook-posts.yml` per
   confermare che lo shuffle+delay di PR #161 sia sufficiente a far
   ruotare tutte le 15 pagine nella finestra "sicura" nel tempo (oggi
   verificato solo su 1 run: 12/15). Se il tasso di successo resta
   costantemente sotto ~80%, valutare di allungare ulteriormente la pausa
   tra pagine o ridurre le pagine per run (a scapito della cadenza).
2. **Costruire un piccolo script di analisi/QA** sullo store
   `aspi-monitoring.json` che segnali anomalie strutturali (es. date
   mancanti, immagini rotte, altri duplicati sfuggiti) — utile ora che ci
   sono 3 pipeline di scrittura concorrenti (IG/TikTok, X, Facebook) sullo
   stesso file con retry-on-conflict.
3. **Se in futuro serve un feed Facebook più ricco** (più di ~1 post/2h per
   pagina), l'unica strada reale rimasta è la **Graph API ufficiale**, che
   richiede però Business Verification + app review per leggere pagine di
   terzi — probabilmente fuori scope per un utente singolo, ma è l'unica
   opzione non ancora esplorata concretamente (verificata solo a livello di
   "non fattibile con l'account attuale", non testata in pratica).
4. **Rimuovere gli script di probe una volta stabilizzato tutto**
   (`probe-x-account.mjs`, `probe-facebook-page.mjs`,
   `probe-facebook-alt-sources.mjs` e i relativi workflow) se non servono
   più come diagnostica — oggi li ho lasciati perché ancora utili per
   rieseguire verifiche mirate, ma sono debito accumulato nel repo se
   nessuno li tocca più.
5. **Monitorare la versione di `rettiwt-api`**: è una libreria non
   ufficiale, storicamente si è rotta più volte per cambi di schema lato X
   (vedi issue GitHub #620/#626/#862/#874 citate nella sessione). Il probe
   (`probe-x-account.mjs`, workflow con input `rettiwt_version`) resta lo
   strumento giusto per diagnosticare rapidamente se il sync X smette di
   funzionare.
