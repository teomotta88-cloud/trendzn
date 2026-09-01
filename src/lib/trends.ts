import data from "@/data/trends.json";

export type TrendItem = {
  category: string | null;
  links: string[];
  descrizione: string | null;
  nome_trend: string | null;
  industry: string | null;
  applicazione: string | null;
  canali: string | null;
  // Testo grezzo della mail di origine e tag dell'oggetto: non vengono
  // mostrati in UI, servono solo per ampliare la ricerca a tutto il
  // contenuto arrivato via mail (caption, descrizione, ecc).
  rawEmail?: string | null;
  tags?: string[] | null;
  // Data di pubblicazione del post sulla piattaforma originale — nota solo
  // per TikTok (estratta dall'ID, vedi extractTikTokPostDate), null altrove
  // (Instagram non la espone senza login, i vecchi item da trends.json non
  // ce l'hanno). Distinta da insertedAt: "quando è stato pubblicato" vs
  // "quando è arrivato in trendzn".
  postedAt?: string | null;
  // Data di inserimento in trendzn (created_at di trend_submissions per gli
  // item da Supabase). Null per gli item statici da trends.json, che non
  // hanno mai avuto un timestamp di inserimento.
  insertedAt?: string | null;
};

export type Sentiment = "positive" | "negative" | "neutral";
export type VerificationStatus = "confirmed" | "unconfirmed";

export type AccountRef = {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
  // Solo per post TikTok: numero di view estratto da RSS-Bridge. Instagram
  // non espone metriche di engagement via RSS-Bridge, resta sempre null.
  views?: number | null;
  // Geotag del post (nome del luogo), quando la piattaforma/tecnica di
  // raccolta lo espone — solo Instagram per ora (sync-bluserena-hashtags.mjs),
  // best-effort: null se il post non è geotaggato o se la piattaforma non lo
  // rende pubblicamente disponibile senza login (TikTok, X).
  location?: string | null;
  // likes/comments: per Instagram da pagina hashtag (sync-bluserena-hashtags.mjs,
  // estratti dalla description del post) o per TikTok da backfill Apify
  // (backfill-tiktok-hashtag-apify.mjs, diggCount/commentCount) — null dove
  // la tecnica di raccolta non li espone (es. X).
  likes?: number | null;
  comments?: number | null;
  // Solo TikTok via backfill Apify (shareCount) — nessun'altra tecnica lo espone.
  shares?: number | null;
  // Analisi AI: sentiment del post (positive/negative/neutral) calcolato da
  // LLM (Groq/OpenRouter) sulla caption. Null se non analizzato.
  sentiment?: Sentiment | null;
  // Topic/hashtag estratti dalla caption tramite LLM. Array vuoto se non trovati.
  topics?: string[] | null;
  // Audio analysis metadata per TikTok/Instagram Reels (Phase 3)
  audioUrl?: string | null;
  audioAnalysis?: {
    transcript?: string | null;
    sentiment?: string | null;
    engagement?: number | null;
    analyzedAt?: string | null;
  } | null;
  // OCR analysis: testo estratto dai frame video durante Phase 2
  ocrData?: {
    textOnScreen?: string | null;
    confidence?: number;
    frames?: string[];
  } | null;
  // Insights estratti da OCR + caption combinati
  ocrInsights?: string | null;
  // Verifica Bluserena: il post contiene "bluserena" o un nome/hashtag resort?
  // "confirmed" se sì, "unconfirmed" se no. Modificabile manualmente via UI.
  verificationStatus?: VerificationStatus;
};
export type CanaleInspo = {
  id: string;
  name: string;
  urls: string[];
  descrizione: string | null;
  accounts: AccountRef[];
};

export const trendRealTime = data.trend_real_time as TrendItem[];
export const trendAttuali = data.trend_attuali as TrendItem[];
export const trendEvergreen = data.trend_evergreen as TrendItem[];
export const canaliInspo = data.canali_inspo as CanaleInspo[];

// Estrae lo username del post dall'URL, quando disponibile (es. TikTok
// @handle). Per piattaforme dove l'URL non lo contiene (es. Instagram /p/ID/)
// ritorna null.
export function extractUsername(url: string): string | null {
  const tt = url.match(/tiktok\.com\/@([^/]+)/i);
  if (tt) return tt[1];
  const ig = url.match(/instagram\.com\/([^/]+)\/(?:p|reel|reels|tv)\//i);
  if (ig) return ig[1];
  return null;
}

// I 32 bit più significativi di un ID TikTok "snowflake" codificano il
// timestamp Unix (in secondi) di creazione del post — stessa tecnica già
// usata per il backfill di trend_submissions.posted_at (vedi migration
// 20260623150000_add_posted_at_tiktok_hashtag.sql). Copre sia /video/ che
// /photo/ (stesso schema ID), come già fa embedUrl qui sotto. Ritorna null
// per qualunque altra piattaforma: nessuna fonte gratuita equivalente
// esiste per Instagram/YouTube/LinkedIn senza login.
export function extractTikTokPostDate(url: string): string | null {
  const match = url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/);
  if (!match) return null;
  try {
    const id = BigInt(match[1]);
    const seconds = Number(id >> 32n);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

export function detectPlatform(
  url: string,
): "instagram" | "tiktok" | "youtube" | "linkedin" | "web" {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/linkedin\.com/.test(url)) return "linkedin";
  return "web";
}

// Resort Bluserena per verifica: nomi e hashtag
export const BLUSERENA_RESORTS = [
  { name: "Bluserena", hashtag: "bluserena" },
  { name: "Is Serenas Badesi Resort", hashtag: "isserenasbadesiresort" },
  { name: "Calaserena Resort", hashtag: "calaserenaresort" },
  { name: "Serenusa Resort", hashtag: "serenusaresort" },
  { name: "Serena Majestic Hotel Residence", hashtag: "serenamajestichotelresidence" },
  { name: "Sibari Green Resort", hashtag: "sibarigreenresort" },
  { name: "Serenè Resort", hashtag: "serenèresort" },
  { name: "Granserena Hotel", hashtag: "granserenahotel" },
  { name: "Torreserena Resort", hashtag: "torreserenaresort" },
  { name: "Calanè Resort", hashtag: "calanèresort" },
  { name: "Valentino Resort", hashtag: "valentinoresort" },
  { name: "Kalidria Hotel & Thalasso SPA", hashtag: "kalidriahotel" },
  { name: "Alborèa Ecolodge Resort", hashtag: "alborèaecolodgeresort" },
  { name: "Ethra Reserve", hashtag: "ethrareserve" },
];

// Verifica se il post è confermato: la caption deve contenere "bluserena"
// oppure la DENOMINAZIONE COMPLETA di un resort (o il suo hashtag), non
// una sottostringa generica. Prima matchava anche solo "Valentino" o
// "Ethra" o "Serena Hotel": bastava un hotel omonimo nel mondo (un
// concerto al Serena Hotel di Kampala, un Cala Serena a Maiorca...) per
// marcare confirmed un post che con Bluserena non c'entra nulla — stessa
// correzione già applicata a scripts/bulk-verify-bluserena-posts.mjs,
// unica fonte di verità duplicata qui perché il frontend deve poter
// classificare anche i post che non hanno ancora un verificationStatus
// salvato. Il confronto ignora maiuscole/minuscole: su TikTok gli hashtag
// si scrivono quasi sempre tutti minuscoli (#sibarigreenresort).
export function verifyBluserenaPost(caption: string | null | undefined): VerificationStatus {
  if (!caption) return "unconfirmed";

  const lower = caption.toLowerCase();

  if (lower.includes("bluserena")) return "confirmed";

  for (const resort of BLUSERENA_RESORTS) {
    if (lower.includes(resort.name.toLowerCase()) || lower.includes(`#${resort.hashtag}`)) {
      return "confirmed";
    }
  }

  return "unconfirmed";
}

export function embedUrl(url: string): string | null {
  const ig = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/);
  if (ig) return `https://www.instagram.com/p/${ig[1]}/embed/captioned/`;
  const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  const ttp = url.match(/tiktok\.com\/@[^/]+\/photo\/(\d+)/);
  if (ttp) return `https://www.tiktok.com/embed/v2/${ttp[1]}`;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // LinkedIn: l'ID può comparire come:
  // - urn:li:activity:1234567890 (URL normale del post o link "copy link to post")
  // - urn:li:share:1234567890 (codice embed copiato direttamente da LinkedIn)
  // - "-activity-1234567890-" dentro un URL /posts/...
  // In tutti i casi, l'URL embed risultante usa lo stesso schema con il tipo corretto.
  const liEmbed = url.match(/urn:li:(share|activity|ugcPost):(\d+)/);
  if (liEmbed)
    return `https://www.linkedin.com/embed/feed/update/urn:li:${liEmbed[1]}:${liEmbed[2]}`;
  const liActivity = url.match(/-activity-(\d+)-/);
  if (liActivity)
    return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${liActivity[1]}`;

  return null;
}
