// Attribuzione di un post Bluserena al singolo resort.
//
// Nello store il campo `location` è testo libero scritto da tre fonti diverse
// — geotag della piattaforma, analisi LLM, selezione manuale dalla UI — e sui
// post confermati contiene 46 varianti per 13 strutture: "Cala Serena",
// "Calaserena Resort", "bluserena", "Blu Serena", "Serenusa"... Raggrupparle
// per stringa esatta darebbe classifiche senza senso, quindi qui si
// normalizza tutto sui nomi canonici di BLUSERENA_RESORTS.
//
// Un post che non nomina nessuna struttura specifica non è un errore da
// nascondere: è contenuto di brand, e finisce in "Bluserena generico".

import { BLUSERENA_RESORTS, type AccountRef } from "./trends";

export const GENERIC_RESORT = "Bluserena generico";

// Token distintivo di ciascun resort, in forma normalizzata. Sono scelti per
// non collidere fra loro: "serena" da solo comparirebbe in mezza lista, e
// nomi generici come "valentino" o "ethra" matchano solo dentro `location`
// (dove il contesto è già Bluserena), mai dentro il testo libero del post,
// che è pieno di omonimie — è la stessa trappola che rendeva confirmed i post
// del Serena Hotel di Kampala.
const RESORT_ALIASES: Record<string, string[]> = {
  "Is Serenas Badesi Resort": ["isserenas", "serenasbadesi"],
  "Calaserena Resort": ["calaserena"],
  "Serenusa Resort": ["serenusa"],
  "Serena Majestic Hotel Residence": ["serenamajestic"],
  "Sibari Green Resort": ["sibarigreen"],
  "Serenè Resort": ["serene"],
  "Granserena Hotel": ["granserena"],
  "Torreserena Resort": ["torreserena"],
  "Calanè Resort": ["calane"],
  "Valentino Resort": ["valentinoresort"],
  "Kalidria Hotel & Thalasso SPA": ["kalidria"],
  "Alborèa Ecolodge Resort": ["alborea"],
  "Ethra Reserve": ["ethrareserve"],
};

// Gli stessi resort in forma più permissiva, per cercarli nel testo del post:
// qui servono l'hashtag e il nome intero, non il token breve, o "valentino"
// e "ethra" aggancerebbero qualunque omonimo.
const RESORT_TEXT_KEYS: Record<string, string[]> = {
  "Is Serenas Badesi Resort": ["isserenasbadesi", "isserenasbadesiresort"],
  "Calaserena Resort": ["calaserenaresort", "calaserena"],
  "Serenusa Resort": ["serenusaresort", "serenusa"],
  "Serena Majestic Hotel Residence": ["serenamajestic"],
  "Sibari Green Resort": ["sibarigreenresort", "sibarigreen"],
  "Serenè Resort": ["sereneresort"],
  "Granserena Hotel": ["granserenahotel", "granserena"],
  "Torreserena Resort": ["torreserenaresort", "torreserena"],
  "Calanè Resort": ["calaneresort"],
  "Valentino Resort": ["valentinoresort"],
  "Kalidria Hotel & Thalasso SPA": ["kalidriahotel", "kalidria"],
  "Alborèa Ecolodge Resort": ["alboreaecolodge", "alborearesort"],
  "Ethra Reserve": ["ethrareserve"],
};

// I resort veri, senza la voce "Bluserena" della lista di verifica, che è il
// brand e non una struttura: quella è la categoria generica.
export const RESORT_NAMES: string[] = BLUSERENA_RESORTS.map((r) => r.name).filter(
  (name) => name !== "Bluserena",
);

export function normalizeResortText(text: string | null | undefined): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function matchIn(text: string, table: Record<string, string[]>): string | null {
  if (!text) return null;
  for (const name of RESORT_NAMES) {
    if ((table[name] ?? []).some((key) => text.includes(key))) return name;
  }
  return null;
}

type ResortSource = Pick<AccountRef, "location" | "caption" | "ocrData" | "audioAnalysis"> & {
  canaleId?: string;
};

// L'ordine delle fonti è per affidabilità decrescente:
//
//  1. `location` — geotag, analisi o scelta manuale dalla UI. La selezione
//     manuale scrive qui, quindi correggere un post a mano vince su tutto.
//  2. il canale hashtag da cui il post arriva: #torreserenaresort è già
//     un'attribuzione, meno precisa solo perché l'hashtag lo mette l'autore.
//  3. il testo del post (caption, testo on-screen, parlato), con le chiavi
//     restrittive: è l'ultima spiaggia e la più esposta alle omonimie.
export function resolveResort(post: ResortSource): string {
  const fromLocation = matchIn(normalizeResortText(post.location), RESORT_ALIASES);
  if (fromLocation) return fromLocation;

  const fromChannel = matchIn(normalizeResortText(post.canaleId), RESORT_ALIASES);
  if (fromChannel) return fromChannel;

  const text = normalizeResortText(
    [post.caption, post.ocrData?.textOnScreen, post.audioAnalysis?.transcript]
      .filter(Boolean)
      .join(" "),
  );
  return matchIn(text, RESORT_TEXT_KEYS) ?? GENERIC_RESORT;
}
