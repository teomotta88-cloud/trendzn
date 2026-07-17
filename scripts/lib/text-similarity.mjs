// Copia in JS puro di src/lib/textSimilarity.ts (usata da Node, non da Vite —
// stessa ragione delle altre coppie duplicate del progetto, es. looksItalian
// in social-search.mjs vs src/lib/language.ts: non condivisibili a runtime,
// vanno tenute allineate a mano). Usata qui come verifica incrociata sui
// cluster di argomenti proposti da OpenRouter (discover-canali-inspo-content.mjs):
// scarta un cluster se le didascalie raggruppate non sono in realtà simili
// tra loro, segno che il modello ha generalizzato troppo un'etichetta.

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text) {
  const padded = ` ${text} `;
  const grams = [];
  for (let i = 0; i < padded.length - 1; i++) grams.push(padded.slice(i, i + 2));
  return grams;
}

export function textSimilarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  if (na.length > 20 && nb.length > 20 && (na.includes(nb) || nb.includes(na))) return 1;

  const ga = bigrams(na);
  const gb = bigrams(nb);
  if (ga.length === 0 || gb.length === 0) return 0;

  const counts = new Map();
  for (const g of ga) counts.set(g, (counts.get(g) ?? 0) + 1);

  let matches = 0;
  for (const g of gb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      matches++;
      counts.set(g, c - 1);
    }
  }

  return (2 * matches) / (ga.length + gb.length);
}
