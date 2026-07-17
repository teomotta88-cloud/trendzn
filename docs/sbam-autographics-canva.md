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

Dal Piano Editoriale → tab **"Canali cliente"** → sezione **"Rubriche
AutoGraphics"** (componente `RubrichePanel`): "+ Nuova rubrica", nome, poi si
compongono una o più **card** (una card = una slide, per i carousel
multi-formato) con "+ Aggiungi campo" per tipo (`#title`, `#subtitle`,
`#text`, `#image`). I campi dello stesso tipo — anche tra card diverse —
vengono numerati in automatico e progressivamente su tutta la rubrica (es.
primo `#title` ovunque si trovi → `#title1`, il successivo → `#title2`,
indipendentemente da `#text1`, `#image1`, ecc.). `tipo_template` viene
derivato automaticamente: `photo_card` se la rubrica ha almeno un campo
`#image`, altrimenti `text_icon_card`. "Salva rubrica" scrive su `rubriche` e
sostituisce interamente i `template_constraints` della rubrica.

Non è più necessario l'inserimento via SQL manuale; resta comunque possibile
per interventi diretti (Supabase Studio → SQL editor), lo schema è invariato
(`rubriche` + `template_constraints`, con la nuova colonna
`template_constraints.card_index` che traccia la card di appartenenza di ogni
campo — ignorata dall'export, che lavora su un elenco piatto
`layer_name -> valore`).

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

## Preparare il Brand Template su Canva (con Data Field — evita di rimappare ogni volta)

Se il template non usa **Data Field** con nome, Bulk Create prova a indovinare
la colonna giusta per ogni elemento ("Auto-match") o costringe a trascinare a
mano ogni colonna sull'elemento corrispondente **ad ogni singolo caricamento**
di un nuovo .xlsx — anche se il template non è cambiato. Taggando gli
elementi come Data Field con un nome fisso, il collegamento fa parte della
definizione del Brand Template stesso (non della singola sessione di Bulk
Create): finché i nomi dei Data Field coincidono con le colonne dello .xlsx
esportato da trendzn, "Auto-match" (o il collegamento già esistente) dovrebbe
risolversi da solo ad ogni nuovo export, senza dover ritrascinare nulla.

1. Disegna la card su Canva, poi pubblicala come **Brand Template**
   ("⋯" sul design → "Pubblica come modello brand", o crealo direttamente
   da **Brand → Modelli del brand**). Serve un ruolo di "brand designer" o
   admin del Team per aggiungere Data Field e pubblicare un Brand Template.
2. Apri il template **da Brand → Modelli del brand** (non dai tuoi progetti
   normali: editare l'originale non aggiorna il template pubblicato).
3. Per ogni elemento dinamico (testo o immagine), selezionalo e usa **Data
   Field** dal pannello per taggarlo con un nome. **Il nome deve coincidere
   esattamente (maiuscole/minuscole comprese) con il nome colonna prodotto
   dall'export**, cioè `layer_name` **senza** il prefisso `#` — lo stesso
   nome che si imposta in `RubrichePanel` quando si compone la rubrica. I
   campi sono numerati automaticamente per tipo su tutta la rubrica (es. il
   primo `#title` ovunque si trovi diventa colonna/Data Field `title1`, il
   successivo `title2`, ecc. — vedi sopra, sezione "Registrare una nuova
   rubrica"): usa lo stesso nome numerato esatto per il Data Field
   corrispondente. Ripubblica il template dopo aver aggiunto i Data Field.
4. Con **Bulk Create** (App → cerca "Bulk Create") collegato al template,
   carica il primo .xlsx di prova generato da trendzn e premi **"Auto-match
   fields"**: con i nomi allineati dovrebbe collegare tutto da solo, colonna
   immagine inclusa (riconosciuta come immagine grazie all'incorporamento
   nella cella, non a un URL). La colonna `post_date` (sempre presente in
   testa all'export, non è un campo di rubrica) non ha un Data Field
   corrispondente: lasciala semplicemente non collegata, non causa errori.
5. Verifica **una sola volta** che il collegamento risulti corretto: dai test
   successivi, ricaricando un nuovo .xlsx con le stesse colonne sullo stesso
   template, il collegamento dovrebbe restare valido senza richiedere di
   ripetere il drag&drop manuale. Se dopo questa modifica capita ancora di
   dover rimappare, è probabile che i nomi non coincidano esattamente
   (spazi, maiuscole, o un campo rinominato in `RubrichePanel` senza
   ripubblicare il template) — controlla lì per primo.

Nota: questo risolve solo la parte "ricollegare i dati ogni volta". Restano
comunque manuali il caricamento dello .xlsx su Canva e lo scaricamento dei
PNG generati (vedi "Limiti noti" sotto) — per eliminare anche questi due
passaggi serve l'Autofill API di Canva, che richiede però un piano Canva
Enterprise (non Teams); non ancora perseguito per questo motivo.

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
