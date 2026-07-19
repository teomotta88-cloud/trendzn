# trendzn — Plugin di export template Figma

Bypassa il limite dell'API REST di Figma (i file su un team con piano
Starter/gratuito hanno un tetto di poche richieste **al mese**, non al
minuto — vedi il commento in cima a
`../src/routes/api/public/hooks/figma-import.ts`). Questo plugin gira
dentro Figma stesso (Plugin API, non REST API: nessun limite legato al
piano) e legge/esporta tutto **localmente**, senza mai chiamare l'API di
Figma via rete — il JSON prodotto va poi incollato a mano nel pannello
"Importa da Figma" dell'editor grafico di trendzn.

## Setup (richiede Figma Desktop almeno per l'installazione iniziale)

```sh
cd figma-export-plugin
npm install
npm run build       # oppure `npm run watch` durante lo sviluppo
```

In **Figma Desktop**: Menu → Plugins → Development → **Import plugin from
manifest…** e seleziona `figma-export-plugin/manifest.json`. Il plugin
compare in Plugins → Development → "trendzn - Esporta template".

Una volta importato, per usarlo anche da Figma nel browser (senza
riaprire Desktop ogni volta) va **pubblicato**: privatamente se il team è
su un piano Organization/Enterprise, altrimenti pubblicamente sulla
Community (nome generico, nessun dato sensibile gestito — legge solo il
file aperto, non fa mai chiamate di rete).

## Come si usa

1. In Figma, seleziona un frame (o più frame insieme, o una sezione che li
   contiene — stessa logica multi-frame del pannello "Importa da Figma").
2. Esegui il plugin: Plugins → Development → "trendzn - Esporta template".
3. Il pannello mostra il JSON pronto: **Copia JSON** o **Scarica .json**.
4. In trendzn, editor grafico della rubrica → pannello "Importa da
   Figma" → incolla il JSON nel campo dedicato invece del link → importa.

## Limiti noti

- Il peso del font (`fontWeight` numerico) è ricavato dal nome dello
  stile Figma (es. "Bold" → 700) con una mappa dei nomi più comuni: un
  font custom con nomi di stile insoliti ricade su 400 (Regular).
- La rotazione (`rotationDegrees`, gradi) non è stata verificata contro
  un elemento realmente ruotato in un ambiente Figma vero — se un
  elemento importato risulta ruotato nel verso sbagliato, il fix è nel
  segno usato in `figma-import.ts` per convertire questo campo.
- Stessi limiti del percorso REST per il resto (testo multi-stile,
  auto-layout, boolean operation come path editabile — vedi il commento
  in cima a `figma-import.ts`).
