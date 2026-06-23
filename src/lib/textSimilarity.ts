function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): string[] {
  const padded = ` ${text} `;
  const grams: string[] = [];
  for (let i = 0; i < padded.length - 1; i++) grams.push(padded.slice(i, i + 2));
  return grams;
}

// Dice coefficient sui bigrammi: 0 = nessuna somiglianza, 1 = testo identico.
// Robusto a differenze minori di punteggiatura/emoji/spazi, a differenza di un confronto esatto.
export function textSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Le caption importate da n8n sono spesso troncate (es. "...sottovalutare....");
  // se il frammento normalizzato è contenuto per intero nell'altro testo, è un match pieno.
  if (na.length > 20 && nb.length > 20 && (na.includes(nb) || nb.includes(na))) return 1;

  const ga = bigrams(na);
  const gb = bigrams(nb);
  if (ga.length === 0 || gb.length === 0) return 0;

  const counts = new Map<string, number>();
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
