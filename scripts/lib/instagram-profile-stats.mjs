// Follower count e foto profilo di un account Instagram — SENZA aprire la
// pagina profilo con un browser: quella route (https://www.instagram.com/
// <username>/) reindirizza sistematicamente al login per una visita anonima
// da IP "bot" come i runner GitHub Actions, a differenza dei singoli post
// (permalink, restano visibili per i link-preview di WhatsApp/Messenger,
// vedi instagram-public-metrics.mjs). Confermato in produzione: ogni singolo
// check della run del 27/07 alle 13:31 (GH Actions run 30270677001) ha dato
// reason "login-wall", il 100% dei profili controllati.
//
// RSS-Bridge (instagram-rssbridge-feed.mjs) recupera invece i post SENZA mai
// incappare nel login-wall, perché non naviga quella pagina: chiama
// l'endpoint GraphQL pubblico di Instagram con l'header "x-ig-app-id"
// (verificato leggendo bridges/InstagramBridge.php su GitHub). La stessa
// risposta GraphQL, oltre ai post, contiene anche i dati dell'account
// ("data.user": follower, foto profilo) — la bridge non li usa/espone nel
// suo JSON, quindi qui replichiamo la stessa identica sequenza di richieste
// (topsearch per risolvere lo user id, poi la query GraphQL) con un fetch
// diretto: niente browser, niente login-wall, stessa fonte già verificata
// funzionante oggi per queste pagine (200 OK nei log RSS-Bridge).

const IG_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMELINE_QUERY_HASH = "58b6785bea111c67129decbe6a448951";

function igHeaders() {
  return {
    "x-ig-app-id": IG_APP_ID,
    "User-Agent": USER_AGENT,
    Accept: "*/*",
  };
}

async function resolveUserId(username) {
  const res = await fetch(
    `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`,
    { headers: igHeaders(), signal: AbortSignal.timeout(15000) },
  ).catch((e) => ({ ok: false, _fetchError: e.message }));

  if (!res || res._fetchError)
    return { userId: null, reason: res?._fetchError ?? "errore di rete" };
  if (!res.ok) return { userId: null, reason: `topsearch-${res.status}` };

  const data = await res.json().catch(() => null);
  if (!data) return { userId: null, reason: "topsearch-not-json" };

  const match = (data.users ?? []).find(
    (u) => u.user?.username?.toLowerCase() === username.toLowerCase(),
  );
  if (!match?.user?.pk) return { userId: null, reason: "topsearch-no-match" };
  return { userId: String(match.user.pk), reason: null };
}

// Non serve più un contesto Playwright: solo fetch dirette, niente browser.
export async function fetchProfileStats(username) {
  const normalized = username?.trim().replace(/^@/, "");
  if (!normalized) return { stats: null, reason: "username mancante" };

  const { userId, reason: idReason } = await resolveUserId(normalized);
  if (!userId) return { stats: null, reason: idReason };

  const variables = encodeURIComponent(JSON.stringify({ id: userId, first: 1 }));
  const res = await fetch(
    `https://www.instagram.com/graphql/query/?query_hash=${TIMELINE_QUERY_HASH}&variables=${variables}`,
    { headers: igHeaders(), signal: AbortSignal.timeout(15000) },
  ).catch((e) => ({ ok: false, _fetchError: e.message }));

  if (!res || res._fetchError) return { stats: null, reason: res?._fetchError ?? "errore di rete" };
  if (!res.ok) return { stats: null, reason: `graphql-${res.status}` };

  const data = await res.json().catch(() => null);
  const user = data?.data?.user;
  if (!user) {
    // Snapshot della risposta per capire, dal prossimo log reale, se la
    // forma dei campi è cambiata rispetto a quella attesa — stessa logica
    // già usata altrove nel progetto per non restare a indovinare.
    return { stats: null, reason: `graphql-no-user:${JSON.stringify(data).slice(0, 200)}` };
  }

  const followersCount = user.edge_followed_by?.count ?? null;
  const profilePicUrl = user.profile_pic_url_hd ?? user.profile_pic_url ?? null;

  if (followersCount == null && !profilePicUrl) {
    return { stats: null, reason: `graphql-no-fields:${JSON.stringify(user).slice(0, 200)}` };
  }

  return { stats: { followersCount, profilePicUrl }, reason: null };
}
