// Aggiunge a mano un singolo post TikTok allo store quando è noto che porta
// l'hashtag di un canale ma nessuna fonte automatica (pagina hashtag,
// scraping profondo, ScrapeCreators/Apify) è mai riuscita a pescarlo — le
// liste hashtag di TikTok sono campioni parziali e non deterministici (vedi
// lib/bluserena-discovery.mjs), quindi capita che un post resti fuori per
// settimane pur essendo taggato correttamente. Caso che ha aperto
// l'indagine: @maraalbergo/video/7675653655655140640, mai pescato in 13+
// giorni di campionamento su #bluserena.
//
// Il post nasce con `manualAdd: { addedAt, reason, confirmedAt: null }`.
// scrape-tiktok-hashtag-deep.mjs e backfill-tiktok-hashtag.mjs valorizzano
// `confirmedAt` la prima volta che ripescano DA SOLI lo stesso URL: è la
// conferma indipendente che il post è reale e ancora raggiungibile, e la UI
// la segnala con una stellina (vedi manualPostsToConfirm in
// lib/bluserena-discovery.mjs). sync-bluserena-hashtags.mjs non è collegato
// a questa conferma: ha una propria copia locale di lettura/scrittura dello
// store con un dedup più debole (URL esatto, non normalizzato), separata
// da questa libreria condivisa.
//
// La data si deduce SEMPRE dall'ID del video (dateFromVideoId, stesso
// snowflake usato ovunque nella pipeline): niente da inserire a mano, niente
// margine di errore, e un modo gratuito per rifiutare un post fuori dalla
// finestra lug-ago 25-26 prima di scrivere qualsiasi cosa.
//
// Uso:
//   node scripts/add-manual-tiktok-post.mjs <url> <canale> ["motivo"]
// Richiede GITHUB_TOKEN nell'ambiente.

import { commitNewPosts, readStore } from "./lib/bluserena-store.mjs";
import {
  dateFromVideoId,
  inWindow,
  normalizePostUrl,
  nuovoPost,
  tiktokVideoId,
} from "./lib/bluserena-discovery.mjs";

const [, , url, canaleName, motivo] = process.argv;

if (!url || !canaleName) {
  console.error('Uso: node scripts/add-manual-tiktok-post.mjs <url> <canale> ["motivo"]');
  process.exit(1);
}

const videoId = tiktokVideoId(url);
if (!videoId) {
  console.error(`URL non riconosciuto come video/photo TikTok: ${url}`);
  process.exit(1);
}

const date = dateFromVideoId(videoId);
if (!date) {
  console.error(`Impossibile dedurre la data dall'ID ${videoId}: ID non plausibile.`);
  process.exit(1);
}

if (!inWindow(date)) {
  console.error(
    `Il post è del ${date.slice(0, 10)}, fuori dalla finestra lug-ago 25-26: non aggiunto. ` +
      "Se è voluto, aggiungilo comunque direttamente nello store: questo script esiste per non " +
      "introdurre a mano gli stessi problemi che il resto della pipeline evita da sola.",
  );
  process.exit(1);
}

const { store } = await readStore();
const canaleEsiste = (store.canali || []).some(
  (c) => (c.name || "").toLowerCase() === canaleName.toLowerCase(),
);
if (!canaleEsiste) {
  console.error(
    `Canale "${canaleName}" non trovato nello store. Canali disponibili: ` +
      (store.canali || []).map((c) => c.name).join(", "),
  );
  process.exit(1);
}

const post = {
  ...nuovoPost({ url, date }),
  manualAdd: {
    addedAt: new Date().toISOString(),
    reason: motivo || null,
    confirmedAt: null,
  },
};

console.log(`Aggiungo ${url} al canale "${canaleName}" (data dedotta: ${date.slice(0, 10)}).`);

const { aggiunti, saltati } = await commitNewPosts({
  byChannel: new Map([[canaleName, [post]]]),
  message: `chore: aggiungi a mano post TikTok ${videoId} su ${canaleName} [trendzn-manual]`,
  normalizeUrl: normalizePostUrl,
});

if (aggiunti === 0) {
  console.log(
    saltati > 0
      ? "Il post era già presente (stesso URL normalizzato): nessuna scrittura."
      : "Nessuna scrittura effettuata.",
  );
} else {
  console.log(`Aggiunto. Resterà marcato "aggiunto a mano" finché una fonte automatica non lo conferma.`);
}
