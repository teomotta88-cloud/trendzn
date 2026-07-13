# SBAM AutoGraphics — Plugin Figma

Plugin Figma che genera le grafiche finali dei post del Piano Editoriale a
partire da template preimpostati per rubrica, popolandoli con il copy
approvato e (per le rubriche `photo_card`) con una foto Getty selezionata.
Vedi `../supabase/migrations/20260711100000_sbam_autographics.sql` per lo
schema completo e `../src/lib/autographics.ts` per il data layer lato app.

## Setup in dev mode

```sh
cd figma-plugin
npm install
npm run build       # oppure `npm run watch` durante lo sviluppo
```

In Figma desktop: **Menu → Plugins → Development → Import plugin from
manifest…** e seleziona `figma-plugin/manifest.json`. Il plugin compare in
Plugins → Development → "SBAM AutoGraphics".

Alla prima apertura, incolla **URL** e **anon/publishable key** del progetto
Supabase nel pannello "Connessione Supabase" e premi "Salva credenziali"
(persistite in `figma.clientStorage`, locali a questa installazione di
Figma — non finiscono mai nel codice del plugin).

## Come funziona il flusso

1. **"Carica job"** interroga `graphic_jobs` con `status=ready_for_render`
   (creati da `approve-job.ts` quando un post viene approvato nel Piano
   Editoriale), con l'embed di `rubriche` e `graphic_job_formats`, e i
   `template_constraints` della rubrica.
2. **"Genera tutti"** invia i job al thread sandbox (`code.ts`), che per
   ciascun formato: clona il component del template nella pagina
   "🤖 AutoGraphics Output", popola i layer dinamici, applica il fit-to-box
   anti-overflow, esporta un PNG @2x.
3. Il thread UI (`ui.ts`) — l'unico con accesso alla rete — carica il PNG
   sul bucket Storage `graphics-output` e aggiorna lo stato del job/formato
   su Supabase.
4. Se un job appartiene a una rubrica il cui `figma_file_key` non è il file
   attualmente aperto, viene **saltato** con un avviso nel log ("apri quel
   file e riprova") — il plugin non ha modo di aprire file Figma diversi da
   quello in cui gira.

## Convenzione di naming dei layer (per chi prepara i template)

- Ogni layer che deve essere popolato automaticamente **deve** avere il nome
  che inizia con `#`, es. `#title`, `#body`, `#cta`, `#photo`, `#icon`. Il
  nome del layer è la chiave usata in `copy_payload` (jsonb) e in
  `template_constraints.layer_name` — devono coincidere esattamente,
  maiuscole/minuscole comprese.
- **Layer di testo** (`#title`, `#body`, `#cta`, …): il plugin scrive
  `characters` e applica il fit-to-box se in `template_constraints` sono
  impostati `min_font_size`/`max_font_size` (riduce il font di 1pt alla
  volta finché il testo entra nel box, senza mai troncare o deformare — se
  a `min_font_size` non basta ancora, il job va in errore con il dettaglio
  di quale layer e quanto testo in eccesso, così torna al copywriter).
- **Layer immagine** (`#photo`, `#icon`, …): qualunque tipo di nodo che
  supporti un `fill` (rettangolo, frame, ellisse, vettore). Se il valore
  corrispondente in `copy_payload` è un URL `http(s)://…`, il plugin lo
  scarica (tramite la UI) e lo applica come fill `IMAGE` con
  `scaleMode: FILL`. Se il valore non è un URL, il layer viene ignorato con
  un avviso nel log.
- **Tutto il resto del template** (logo, sfondi, elementi fissi, layer
  senza `#`) **non viene mai toccato** dal plugin.
- Imposta `min_font_size`/`max_font_size`/`max_lines`/`max_chars` in
  `template_constraints` per ogni layer di testo dinamico: senza vincoli il
  plugin scrive comunque il testo ma non applica alcun fit-to-box.

## Come registrare una nuova rubrica

1. In Figma, prepara (o apri) il file con il component master del template
   e i suoi layer `#…`.
2. Seleziona il component, **Copy link to selection**: l'URL contiene
   `node-id=123%3A456` — il node id è `123:456` (sostituisci `%3A` con
   `:`). Questo è il valore per `rubriche.figma_component_id`.
   **Nota**: è l'ID del nodo nel file corrente, non una "component key" da
   libreria pubblicata — il plugin usa `figma.getNodeByIdAsync`, che legge
   solo nel file in cui il plugin è in esecuzione in quel momento.
3. La `figma_file_key` è l'ID del file, visibile nell'URL
   `figma.com/design/<file_key>/...` — serve solo a far sapere
   all'operatore quale file aprire per generare i job di questa rubrica
   (il plugin confronta `figma.fileKey` con questo valore e salta i job
   che non corrispondono).
4. Inserisci la riga in `rubriche` (via SQL/Supabase Studio, non c'è ancora
   una UI di amministrazione):

   ```sql
   insert into rubriche (nome, tipo_template, figma_file_key, figma_component_id, attiva)
   values ('Nome rubrica', 'photo_card', '<file_key>', '<component_id>', true);
   ```

5. Per ogni formato export richiesto (es. `feed_1x1`, `feed_4x5`,
   `story_9x16` — i nomi sono liberi, decidili in base ai frame/varianti
   preparati in Figma), inserisci una riga in `rubrica_formati`. Se il
   formato usa un component diverso da quello base (es. una variante di
   dimensione), imposta anche `figma_component_id`; altrimenti lascialo
   `null` e il plugin userà il component base della rubrica.

   ```sql
   insert into rubrica_formati (rubrica_id, formato, figma_component_id, width_px, height_px, attivo)
   values ('<rubrica_id>', 'feed_1x1', null, 1080, 1080, true);
   ```

6. Per ogni layer dinamico `#…`, inserisci i vincoli in
   `template_constraints`:

   ```sql
   insert into template_constraints (rubrica_id, layer_name, max_chars, min_font_size, max_font_size, max_lines, obbligatorio)
   values ('<rubrica_id>', '#title', 60, 24, 48, 2, true);
   ```

## Setup delle API key

- **OpenRouter** (estrazione keyword): `OPENROUTER_API_KEY` va nei secret
  dell'ambiente di deploy dell'app (Lovable/Cloudflare), letta da
  `process.env.OPENROUTER_API_KEY` in `src/routes/api/public/hooks/extract-keywords.ts`.
  Attenzione: è il **secret runtime dell'app**, distinto dai secret di
  GitHub Actions (quelli alimentano solo i workflow degli scraper, non il
  runtime delle route). Opzionale: `OPENROUTER_MODEL` per sovrascrivere il
  modello di default. **Non** è una Supabase Edge Function: questo progetto
  non ne usa, quindi la key non va nei secret di Supabase.
- **Getty Images**: nessuna API key configurata al momento. `getty-search.ts`
  interroga la pagina pubblica di ricerca di gettyimages.com (bozzetti
  watermarked) invece della REST API ufficiale — vedi il commento in testa
  a quel file. Se in futuro viene attivato un abbonamento/API key Getty,
  andrà introdotto un endpoint di download separato con un gate esplicito
  sulla licenza (come previsto ma non implementato in questa versione).

## Nota architetturale: perché route TanStack e non Edge Functions Supabase

Trendzn non ha mai usato Supabase Edge Functions: tutta la logica server
(chiamate esterne, secrets, service-role) passa da route TanStack Start
sotto `src/routes/api/public/hooks/*.ts`. `extract-keywords`, `getty-search`
e `approve-job` seguono lo stesso pattern per coerenza con il resto del
progetto — il plugin le chiama con normali `fetch()` verso il dominio
dell'app (non verso l'URL Supabase).

## Limiti noti / cose da verificare al primo uso reale

- **`getty-search.ts` non è mai stato testato contro gettyimages.com dal
  vivo**: l'ambiente in cui è stato scritto non aveva accesso di rete verso
  quel dominio. Se "Carica job" mostra 0 candidati Getty per un post
  `photo_card`, il problema è quasi certamente lì.
- **Il plugin stesso non è stato testato dentro Figma** (nessun ambiente
  Figma disponibile in fase di sviluppo): la build compila e tipizza
  correttamente contro `@figma/plugin-typings`, ma la prima esecuzione reale
  va fatta con occhio critico, specialmente su fit-to-box (`estimateLineCount`
  è una stima euristica, non un conteggio esatto delle righe — Figma non
  espone un'API diretta per questo).
