// Helper puri dell'estrazione OCR, tenuti fuori dallo script per poterli
// testare senza far partire una run.

const MAX_TEXT_CHARS = 2000;

// Campionamento uniforme dei fotogrammi lungo il video, evitando i due
// estremi. Il vecchio codice prendeva un solo frame con `-vframes 1` e senza
// `-ss`, cioè il frame 0: quasi sempre uno stacco nero o l'intro, proprio dove
// il testo sovraimpresso non c'è ancora.
export function frameTimestamps(durationSec, frames) {
  const n = Math.max(1, frames);
  if (!durationSec || !Number.isFinite(durationSec) || durationSec < 1) return [0];
  return Array.from({ length: n }, (_, i) => +((durationSec * (i + 1)) / (n + 1)).toFixed(2));
}

// Tesseract su fotogrammi di video produce parecchio rumore: righe di un
// carattere, simboli isolati, e la stessa scritta ripetuta su più frame.
export function cleanText(rawLines, { maxChars = MAX_TEXT_CHARS } = {}) {
  const seen = new Set();
  const kept = [];

  for (const line of rawLines) {
    const text = String(line).replace(/\s+/g, " ").trim();
    if (text.length < 3) continue;
    // Almeno due caratteri alfanumerici: scarta "|", "—", "«.»" e simili.
    if ((text.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) continue;

    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }

  return kept.join("\n").slice(0, maxChars);
}

// Tesseract restituisce, oltre al testo appiattito, l'albero
// blocks -> paragraphs -> lines -> words con la confidenza di OGNI parola e
// un flag `in_dictionary`. È il segnale che distingue "Ciao Bluserena" da
// "£5 4", e la prima versione dell'estrattore lo buttava via usando solo
// `data.text`: da lì il rumore nei record.
export function wordsFromBlocks(blocks) {
  const out = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? "").trim();
          if (!text) continue;
          out.push({
            text,
            confidence: word.confidence ?? 0,
            inDictionary: Boolean(word.in_dictionary),
            language: word.language ?? null,
          });
        }
      }
    }
  }
  return out;
}

// Ricostruisce le righe tenendo solo le parole sopra soglia. Una riga che
// resta senza parole sparisce: è esattamente il caso delle righe di puro
// rumore, che oggi finiscono nello store.
export function linesFromBlocks(blocks, { minConfidence = 0, requireDictionary = false } = {}) {
  const lines = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const kept = (line.words ?? [])
          .filter((w) => (w.confidence ?? 0) >= minConfidence)
          .filter((w) => !requireDictionary || w.in_dictionary)
          .map((w) => (w.text ?? "").trim())
          .filter(Boolean);
        if (kept.length) lines.push(kept.join(" "));
      }
    }
  }
  return lines;
}
