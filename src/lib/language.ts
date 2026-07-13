// Rilevamento lingua italiana lato frontend — speculare a looksItalian() in
// scripts/lib/social-search.mjs (usata dagli script di ingestione/ricontrollo).
// Duplicato volutamente: gli script girano con node su .mjs, il frontend è
// TypeScript compilato da Vite, non possono condividere lo stesso modulo a
// runtime. Le due liste di marker vanno tenute allineate: se ne modifichi una,
// aggiorna anche l'altra.
//
// Serve qui per filtrare i contenuti in LETTURA (vedi listViralTrendContent):
// i post spagnoli già presenti in DB — sincronizzati prima del fix del filtro,
// o non ancora rimossi dal ricontrollo — non devono comparire nel feed, senza
// dover aspettare che il workflow di pulizia li cancelli.
//
// ATTENZIONE — lo spagnolo è la trappola: contare stopword "italiane" non
// basta, perché molte (la, lo, le, un, una, con, se...) sono identiche in
// spagnolo. Servono marker DISCRIMINANTI (comuni in una lingua e assenti
// nell'altra), contati separatamente: si accetta solo se l'italiano prevale.

// Comuni in italiano, assenti in spagnolo (di→de, che→que, per→por/para,
// è→es, come→como, più→más).
const ITALIAN_MARKERS = new Set([
  "il",
  "gli",
  "di",
  "che",
  "non",
  "è",
  "per",
  "sono",
  "questo",
  "questa",
  "della",
  "dei",
  "delle",
  "degli",
  "nel",
  "nella",
  "negli",
  "anche",
  "come",
  "più",
  "ma",
  "molto",
  "nuovo",
  "nuova",
  "perché",
  "però",
  "sempre",
  "grazie",
  "ecco",
  "quello",
  "quella",
  "hanno",
  "siamo",
  "dopo",
  "senza",
  "ogni",
  "tutti",
  "tutto",
  "sulla",
  "sui",
  "dalla",
  "quando",
  "essere",
  "fatto",
  "così",
  "già",
  "ancora",
]);

// Comuni in spagnolo, assenti in italiano. Se pareggiano o superano i marker
// italiani, il testo non è italiano.
const SPANISH_MARKERS = new Set([
  "el",
  "los",
  "las",
  "que",
  "de",
  "por",
  "más",
  "mas",
  "y",
  "es",
  "para",
  "muy",
  "pero",
  "como",
  "está",
  "están",
  "esta",
  "estan",
  "este",
  "esto",
  "eso",
  "en",
  "hay",
  "también",
  "tambien",
  "porque",
  "les",
  "nos",
  "cuando",
  "desde",
  "sobre",
  "todos",
  "todo",
  "sus",
  "fue",
  "ser",
  "hacer",
  "según",
  "segun",
  "cual",
  "ya",
]);

// Include gli accenti spagnoli (á í ó ú ñ ü) oltre a quelli italiani, così
// "más"/"está"/"también" vengono tokenizzate intere e non spezzate sull'accento.
const WORD_RE = /[a-zàèéìíòóùúáñü]+/g;

export function looksItalian(text: string | null | undefined): boolean {
  if (!text) return false;
  const words = text.toLowerCase().match(WORD_RE) ?? [];
  if (words.length === 0) return false;
  let italian = 0;
  let spanish = 0;
  for (const w of words) {
    if (ITALIAN_MARKERS.has(w)) italian++;
    else if (SPANISH_MARKERS.has(w)) spanish++;
  }
  return italian >= 2 && italian > spanish;
}
