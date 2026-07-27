// Follower count e foto profilo di un account Instagram — SENZA aprire la
// pagina profilo con un browser: quella route (https://www.instagram.com/
// <username>/) reindirizza sistematicamente al login per una visita anonima
// da IP "bot" come i runner GitHub Actions, a differenza dei singoli post
// (permalink, restano visibili per i link-preview di WhatsApp/Messenger,
// vedi instagram-public-metrics.mjs). Confermato in produzione: ogni singolo
// check della run del 27/07 alle 13:31 (GH Actions run 30270677001) ha dato
// reason "login-wall", il 100% dei profili controllati.
//
// Primo tentativo (topsearch + query GraphQL con query_hash, verificato
// leggendo bridges/InstagramBridge.php) sostituito da questo: il log della
// run del 27/07 alle 14:17 ha mostrato "topsearch-400" per il 100% dei
// profili — l'endpoint /web/search/topsearch/ restituisce sistematicamente
// 400 (verosimilmente inasprito/deprecato per traffico anonimo). Qui si usa
// invece /api/v1/users/web_profile_info/, che prende lo username
// direttamente (nessuna risoluzione preventiva dell'id utente) con lo stesso
// header "x-ig-app-id" — tecnica più diretta e più comunemente usata da
// tool di scraping pubblici equivalenti.
const IG_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchProfileStats(username) {
  const normalized = username?.trim().replace(/^@/, "");
  if (!normalized) return { stats: null, reason: "username mancante" };

  const res = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(normalized)}`,
    {
      headers: {
        "x-ig-app-id": IG_APP_ID,
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        Referer: `https://www.instagram.com/${normalized}/`,
      },
      signal: AbortSignal.timeout(15000),
    },
  ).catch((e) => ({ ok: false, _fetchError: e.message }));

  if (!res || res._fetchError) return { stats: null, reason: res?._fetchError ?? "errore di rete" };
  if (!res.ok) return { stats: null, reason: `web-profile-info-${res.status}` };

  const data = await res.json().catch(() => null);
  const user = data?.data?.user;
  if (!user) {
    // Snapshot della risposta per capire, dal prossimo log reale, se la
    // forma dei campi è cambiata rispetto a quella attesa.
    return { stats: null, reason: `no-user:${JSON.stringify(data).slice(0, 200)}` };
  }

  const followersCount = user.edge_followed_by?.count ?? null;
  const profilePicUrl = user.profile_pic_url_hd ?? user.profile_pic_url ?? null;

  if (followersCount == null && !profilePicUrl) {
    return { stats: null, reason: `no-fields:${JSON.stringify(user).slice(0, 200)}` };
  }

  return { stats: { followersCount, profilePicUrl }, reason: null };
}
