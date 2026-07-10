// Segmentazione offline di hashtag (stringhe senza spazi) in parole
// leggibili, es. "#lafavolapersempre" -> "La Favola Per Sempre". Nessuna
// chiamata LLM/API, nessun costo — algoritmo di Viterbi su costo delle
// parole (stesso principio di keredson/wordninja e del pacchetto npm
// "wordsninja"), qui reimplementato per poter combinare correttamente due
// dizionari (inglese + italiano) invece di un solo elenco.
//
// Dizionari bundled:
//  - words-en.json: dal pacchetto npm "wordsninja" (MIT, keredson/wordninja),
//    126k parole inglesi ordinate per frequenza (Wikipedia).
//  - words-it.json: primi 25k termini di hermitdave/FrequencyWords
//    content/2018/it/it_50k.txt (CC-BY-SA-4.0), ordinati per frequenza
//    (sottotitoli italiani).
//
// Limite noto: hashtag composti da nomi propri/toponimi assenti da entrambi
// i dizionari (es. "torvergata") non vengono segmentati correttamente —
// limite intrinseco di un approccio a dizionario senza LLM.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadWordCosts(fileName) {
  const words = JSON.parse(readFileSync(path.join(here, fileName), "utf-8"));
  const cost = new Map();
  let maxWordLen = 0;
  words.forEach((word, index) => {
    const w = word.toLowerCase();
    const c = Math.log((index + 1) * Math.log(words.length));
    if (!cost.has(w)) cost.set(w, c);
    if (w.length > maxWordLen) maxWordLen = w.length;
  });
  return { cost, maxWordLen };
}

const english = loadWordCosts("words-en.json");
const italian = loadWordCosts("words-it.json");
const MAX_WORD_LEN = Math.max(english.maxWordLen, italian.maxWordLen);

// Costo di una parola: il minimo tra i due dizionari (se presente in
// entrambi, vince quello in cui è più frequente/comune).
function wordCost(word) {
  const en = english.cost.get(word);
  const it = italian.cost.get(word);
  if (en == null) return it;
  if (it == null) return en;
  return Math.min(en, it);
}

// Viterbi: per ogni posizione i, trova il costo minimo per segmentare
// string[0:i] provando tutte le lunghezze di "ultima parola" fino a
// MAX_WORD_LEN.
function splitWords(s) {
  const n = s.length;
  const cost = new Array(n + 1).fill(Infinity);
  const lastWordLen = new Array(n + 1).fill(0);
  cost[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let k = 1; k <= Math.min(MAX_WORD_LEN, i); k++) {
      const candidate = s.slice(i - k, i).toLowerCase();
      const c = wordCost(candidate);
      if (c == null) continue;
      const total = cost[i - k] + c;
      if (total < cost[i]) {
        cost[i] = total;
        lastWordLen[i] = k;
      }
    }
  }

  if (!Number.isFinite(cost[n])) {
    // Nessuna segmentazione a dizionario valida: ritorna la stringa intera
    // come unica "parola" invece di fallire.
    return [s];
  }

  const words = [];
  let i = n;
  while (i > 0) {
    const k = lastWordLen[i];
    words.push(s.slice(i - k, i));
    i -= k;
  }
  return words.reverse();
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Converte un hashtag ("#lafavolapersempre" o "lafavolapersempre") in una
// keyword leggibile ("La Favola Per Sempre").
export function hashtagToKeyword(hashtag) {
  const clean = hashtag.replace(/^#/, "").replace(/[^a-zA-Zà-ÿ0-9]/g, "");
  if (!clean) return hashtag;
  const words = splitWords(clean);
  return words.map(capitalize).join(" ");
}

// Direzione inversa, per le keyword Google Trends (già in linguaggio
// naturale, es. "Milan Napoli biglietti"): nessun LLM coinvolto, è solo una
// normalizzazione deterministica ("milannapolibiglietti") per poter usare
// anche la discovery gratuita via pagina hashtag Instagram/TikTok, che
// richiede un vero hashtag senza spazi né accenti.
export function keywordToHashtag(keyword) {
  return keyword
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
