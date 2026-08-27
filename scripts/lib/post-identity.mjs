// Riconoscere se due post (nello store Bluserena-monitoring, chiave
// "accounts" di un canale) sono in realtà lo stesso post, usato da
// backfill-tiktok-hashtag.mjs, cleanup-duplicate-tiktok-posts.mjs e
// sync-bluserena-hashtags.mjs.
//
// Criterio primario: URL normalizzato (senza query string) — copre il caso
// già visto in produzione di ScrapeCreators, che restituisce share_url con
// parametri di tracciamento diversi a ogni chiamata anche per lo stesso
// identico video (vedi backfill-tiktok-hashtag.mjs).
//
// Criterio di fallback: caption + autore + data di pubblicazione tutti
// uguali. Serve per i casi in cui l'URL differisce per un motivo che non
// abbiamo ancora incontrato/normalizzato esplicitamente — improbabile che
// tre campi indipendenti coincidano per caso su due post diversi. Richiede
// che tutti e tre siano valorizzati su ENTRAMBI i post confrontati: se anche
// uno solo manca su un lato, non si usa questo criterio (evita falsi
// positivi tra post entrambi senza caption/data, che altrimenti
// combacerebbero sempre).

export function normalizePostUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

export function isSamePost(a, b) {
  if (normalizePostUrl(a.url) === normalizePostUrl(b.url)) return true;
  if (a.caption && b.caption && a.handle && b.handle && a.date && b.date) {
    return a.caption === b.caption && a.handle === b.handle && a.date === b.date;
  }
  return false;
}
