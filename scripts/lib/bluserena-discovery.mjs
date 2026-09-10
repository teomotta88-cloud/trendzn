// Logica di supporto per la scoperta dei post Bluserena mancanti dalle
// pagine hashtag TikTok (scrape-tiktok-hashtag-deep.mjs).
//
// Perché serve. Le liste hashtag di TikTok sono parziali e non
// deterministiche: misurando i post che portano PIÙ hashtag monitorati — e
// che quindi dovrebbero comparire in più canali — risulta che una singola
// lista ne perde il 19,5%. Il caso che ha aperto l'indagine
// (@maraalbergo/video/7675653655655140640, #bluserena in caption) è sfuggito
// per 13 giorni a un campionamento ogni 3 ore. Campionare più spesso non
// chiude il buco: da qui le passate multiple sulle pagine hashtag.
//
// C'era anche una seconda strada, l'enumerazione dei profili autore
// (tiktokAuthors, usata da discover-tiktok-by-author.mjs): rimossa l'8/09/2026
// perché l'endpoint che TikTok usa per caricare la griglia video di un
// profilo risponde vuoto all'automazione, sessione autenticata o meno — non
// risolvibile da qui (vedi il commento in lib/tiktok-page.mjs).
//
// Qui sta solo la logica pura: nessuna rete, nessuna scrittura. È la parte
// verificabile dall'ambiente di sviluppo, dove tiktok.com non è raggiungibile.

// Stessa finestra del resto della pipeline Bluserena (confronto Jul-Ago anno
// su anno). Copiata qui come negli altri script: ognuno ne tiene una copia
// locale identica, per non far dipendere script diversi da un modulo che
// nessuno dei due possiede.
export const WINDOWS = [
  { start: "2025-07-01", end: "2025-08-31" },
  { start: "2026-07-01", end: "2026-08-31" },
];

export function inWindow(dateStr) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  return WINDOWS.some((w) => d >= w.start && d <= w.end);
}

// Confronto degli URL SEMPRE su questa forma: lo stesso video arriva con
// query string diverse (?_r=1&_t=... dagli share link, ?lang=it dalla pagina
// hashtag) e un confronto letterale creerebbe duplicati dello stesso post.
export function normalizePostUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return String(url).split("?")[0].replace(/\/$/, "").toLowerCase();
  }
}

export function tiktokVideoId(url) {
  return String(url || "").match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null;
}

export function tiktokHandle(url) {
  return String(url || "").match(/tiktok\.com\/@([^/?#]+)/i)?.[1] ?? null;
}

// I 32 bit alti di un ID TikTok "snowflake" sono il timestamp Unix in secondi.
// Serve per scartare i video fuori finestra PRIMA di aprirne la pagina: su
// migliaia di video di un profilo, filtrare per data a costo zero è la
// differenza tra una run di minuti e una di ore.
export function dateFromVideoId(id) {
  if (!/^\d+$/.test(String(id || ""))) return null;
  try {
    const seconds = Number(BigInt(id) >> 32n);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const d = new Date(seconds * 1000);
    // Un ID che cade prima di TikTok o nel futuro non è uno snowflake valido.
    if (d.getTime() < Date.parse("2016-01-01") || d.getTime() > Date.now() + 86_400_000) {
      return null;
    }
    return d.toISOString();
  } catch {
    return null;
  }
}

// Tutti gli URL già nello store, normalizzati: è il filtro "post nuovo?".
export function knownUrls(store) {
  const set = new Set();
  for (const canale of store.canali || []) {
    for (const account of canale.accounts || []) {
      const n = normalizePostUrl(account.url);
      if (n) set.add(n);
    }
  }
  return set;
}

// In quale canale (cioè sotto quale hashtag) va archiviato un post nuovo.
//
// Primo criterio: gli hashtag monitorati citati nella caption — è il
// significato del canale, e un post con #bluserena e #granserenahotel
// appartiene a entrambi. Quando la caption non ne nomina nessuno si ripiega
// sui canali dove l'autore compare già: il post è comunque suo, e lasciarlo
// fuori dallo store per un dettaglio di archiviazione sarebbe il male
// peggiore, visto che tutta questa impalcatura esiste per non perdere post.
export function channelsForPost({ caption, canaliNoti = [], nomiCanali }) {
  const low = (caption || "").toLowerCase();
  const perHashtag = nomiCanali.filter((n) => low.includes(`#${n.toLowerCase()}`));
  if (perHashtag.length > 0) return perHashtag;
  return [...canaliNoti];
}

// Un post aggiunto a mano (scripts/add-manual-tiktok-post.mjs, quando un
// caso noto — tipo @maraalbergo/video/7675653655655140640 — sfugge al
// campionamento di tutte le fonti automatiche) nasce con
// `manualAdd: { addedAt, reason, confirmedAt: null }`. `confirmedAt` resta
// null finché nessuna fonte automatica lo ripesca DA SOLA: quando succede è
// la conferma indipendente che il post è reale e ancora raggiungibile, e la
// UI lo segnala con una stellina (vedi PostCard in
// BluserenaFeedAdvanced.tsx).
//
// `visti` è l'insieme (già normalizzato con normalizePostUrl) di TUTTI gli
// URL incontrati in una passata da una fonte — non solo quelli nuovi: un
// post aggiunto a mano è per definizione già noto, quindi una fonte che
// guardasse solo "cosa è nuovo" lo scarterebbe prima ancora di arrivare qui.
// Ritorna una Map url-esatto-nello-store -> nuovo valore di `manualAdd`,
// pronta per commitField({ field: "manualAdd", updates, ... }).
export function manualPostsToConfirm(store, visti) {
  const updates = new Map();
  for (const canale of store.canali || []) {
    for (const account of canale.accounts || []) {
      if (!account.manualAdd || account.manualAdd.confirmedAt) continue;
      if (!visti.has(normalizePostUrl(account.url))) continue;
      updates.set(account.url, { ...account.manualAdd, confirmedAt: new Date().toISOString() });
    }
  }
  return updates;
}

// Voce dello store per un post scoperto. I campi piatti restano null: li
// riempiono gli script che vengono dopo (KPI dalla pagina video, sentiment,
// audio, OCR), ognuno col proprio record versionato. verificationStatus parte
// da "unconfirmed" perché è bulk-verify a deciderlo sulla caption: metterlo
// confirmed qui vorrebbe dire aggirare la verifica.
export function nuovoPost({
  url,
  date,
  caption = null,
  views = null,
  likes = null,
  comments = null,
  shares = null,
}) {
  return {
    platform: "tiktok",
    handle: tiktokHandle(url),
    url,
    date,
    caption,
    location: null,
    views,
    imageUrl: null,
    likes,
    comments,
    shares,
    verificationStatus: "unconfirmed",
  };
}
