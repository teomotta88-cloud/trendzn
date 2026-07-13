# SBAM AutoGraphics — percorso Canva Bulk Create

Percorso corrente della feature SBAM AutoGraphics: genera le grafiche dei
post del Piano Editoriale a partire da un **Brand Template Canva**,
popolato via **export .xlsx** e **Canva Bulk Create** (richiede Canva Teams
o superiore — Bulk Create è una funzione no-code inclusa nel piano, non
un'integrazione API/OAuth).

> Esiste anche un percorso precedente basato su un plugin Figma
> (`figma-plugin/`), non rimosso ma non più quello attivo: richiedeva di
> aprire Figma manualmente per ogni render, incompatibile con l'esigenza di
> zero passaggi applicativi. Vedi `figma-plugin/README.md` se in futuro
> serve riattivarlo.

## Come funziona il flusso

1. Nel Piano Editoriale, il copywriter compone il post e nel pannello
   "Grafica automatica" seleziona una **rubrica** (tabella `rubriche`),
   scrive il copy per ciascun campo dinamico con contatori di caratteri
   live, e (per le rubriche `photo_card`) seleziona una foto Getty tra i
   candidati proposti.
2. "Approva e genera" (`approve-job`) valida il copy e porta il job a
   `ready_for_render`.
3. In cima alla pagina Piano Editoriale, il pannello **"Export Canva Bulk
   Create"**: si seleziona la rubrica, si vede quanti post di quel mese
   sono pronti, e si scarica un **.xlsx** — una riga per post, una colonna
   per ogni campo della rubrica. **Le colonne immagine contengono
   l'immagine Getty incorporata davvero nella cella** (non un URL
   testuale): generato server-side da `export-xlsx.ts`, che scarica il
   bozzetto Getty e lo inserisce nel file con `exceljs`, la stessa
   convenzione del flusso Google Sheets già in uso in agenzia (lì ottenuta
   con `SpreadsheetApp.newCellImage()` — qui il file .xlsx viene generato
   già pronto, senza passare da un foglio Google).
4. Il file si carica in **Canva → Bulk Create**, puntato sul Brand Template
   della rubrica: Canva genera una design per riga.
5. Le grafiche generate si scaricano da Canva e si allegano manualmente al
   post nel blocco "Visual" esistente del Piano Editoriale (nessun
   ricaricamento automatico in questa versione: Canva Bulk Create non offre
   un canale programmatico per restituire l'esito a trendzn).

## Registrare una nuova rubrica

Nessuna UI di amministrazione ancora: si inserisce via SQL (Supabase
Studio → SQL editor).

```sql
-- 1. La rubrica
insert into rubriche (nome, tipo_template, attiva)
values ('Nome rubrica', 'photo_card', true);
-- tipo_template: 'photo_card' (ha un campo foto Getty) | 'text_icon_card' (solo testo)
-- figma_file_key/figma_component_id: lasciali null, servono solo al percorso plugin Figma legacy.

-- 2. I campi (uno per colonna dell'export / placeholder nel Brand Template)
insert into template_constraints (rubrica_id, layer_name, layer_type, max_chars, min_font_size, max_font_size, max_lines, obbligatorio)
values
  ((select id from rubriche where nome='Nome rubrica'), '#title', 'text', 60, null, null, 2, true),
  ((select id from rubriche where nome='Nome rubrica'), '#body', 'text', 180, null, null, 5, true),
  ((select id from rubriche where nome='Nome rubrica'), '#photo', 'image', null, null, null, null, true);
```

Note:

- `layer_name` può avere il prefisso `#` (retaggio della convenzione Figma)
  o no — nell'export il prefisso viene comunque tolto dal nome colonna
  (`#title` → colonna `title`). Usa lo stesso nome, senza `#`, come
  placeholder/campo mappato nel Brand Template Canva.
- `layer_type = 'image'` è obbligatorio per i campi che devono ricevere la
  foto Getty: non hanno un limite di caratteri e nel pannello non si
  digitano a mano — l'immagine finisce incorporata nella cella
  automaticamente all'export.
- `min_font_size`/`max_font_size` non sono usati in questo percorso (erano
  per il fit-to-box del plugin Figma) — puoi lasciarli `null`.
- `max_chars`/`max_lines`/`obbligatorio` restano usati per la validazione
  live nel pannello di composizione.

## Preparare il Brand Template su Canva

1. Disegna la card su Canva, poi pubblicala come **Brand Template**
   ("⋯" sul design → "Pubblica come modello brand", o crealo direttamente
   da **Brand → Modelli del brand**).
2. Apri il template **da Brand → Modelli del brand** (non dai tuoi progetti
   normali: editare l'originale non aggiorna il template pubblicato).
3. Con **Bulk Create** (App → cerca "Bulk Create") collegato al template,
   carica il primo .xlsx di prova generato da trendzn: Canva mostra come
   mappa ogni colonna a un elemento del design. Verifica in particolare che
   la colonna immagine venga riconosciuta come tale (grazie all'immagine
   incorporata, non a un URL, questo dovrebbe funzionare senza passaggi
   aggiuntivi).

## Limiti noti

- Nessun rientro automatico dei PNG generati da Canva verso trendzn: il
  collegamento finale (scaricare da Canva → allegare al post) è manuale.
- Un job esportato viene segnato come `done` ("esportato in .xlsx") non
  appena il file viene scaricato — non appena, cioè, prima ancora che il
  copywriter abbia effettivamente completato il Bulk Create su Canva. È
  un'approssimazione voluta: non esiste un modo per sapere da trendzn se il
  passaggio su Canva è stato completato.
- L'export è per singola rubrica all'interno del mese/anno visualizzato nel
  Piano Editoriale (Bulk Create opera su un Brand Template alla volta).
- `export-xlsx.ts` usa la libreria `exceljs`, relativamente pesante in
  termini di dimensione del bundle: se il deploy su Cloudflare Workers
  fallisce per limite di dimensione del Worker, è il primo sospettato.
- Ogni immagine viene scaricata dal server al momento dell'export (fetch
  sincrona per riga): con molte righe l'operazione può richiedere qualche
  secondo; per batch molto grandi valutare un limite di righe per export.
