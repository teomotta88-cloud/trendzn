// Follower count e foto profilo di un account Instagram — SENZA aprire la
// pagina profilo con un browser: quella route (https://www.instagram.com/
// <username>/) reindirizza sistematicamente al login per una visita anonima
// da IP "bot" come i runner GitHub Actions, a differenza dei singoli post
// (permalink, restano visibili per i link-preview di WhatsApp/Messenger,
// vedi instagram-public-metrics.mjs). Confermato in produzione: ogni singolo
// check della run del 27/07 alle 13:31 ha dato reason "login-wall".
//
// Tentativo 1 (topsearch + query GraphQL con query_hash) sostituito dopo
// che la run del 27/07 alle 14:17 ha mostrato "topsearch-400" sul 100% dei
// profili — l'endpoint /web/search/topsearch/ restituisce sistematicamente
// 400 per richieste senza cookie di sessione.
//
// Tentativo 2 (/api/v1/users/web_profile_info/ senza cookie) sostituito
// dopo che la run del 27/07 alle 14:37 ha mostrato "web-profile-info-429"
// sul 100% dei profili, fin dalla primissima richiesta — un rate limit
// generico che Instagram applica a chi chiama questo endpoint senza una
// sessione anonima "vera" (nessun cookie csrftoken/mid), non un limite di
// burst che si allenta rallentando le richieste (già spaziate di ~20s).
//
// Fix: prima di ogni run si "apre" una sessione anonima come farebbe un
// browser reale — una GET alla home di instagram.com per ottenere i cookie
// che Instagram assegna a ogni visitatore (csrftoken, mid, ig_did) — e si
// riusano per tutte le chiamate a web_profile_info di quella run (una sola
// sessione per l'intero processo, non una per profilo). Tecnica comune per
// evitare il 429 "anonimo" su questo endpoint.
const IG_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function parseSetCookieHeaders(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);

  const cookies = {};
  for (const entry of raw) {
    const pair = entry.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return cookies;
}

let sessionPromise = null;

// Una sola sessione per l'intero processo (non una per profilo): la home
// page basta a ottenere i cookie di visitatore anonimo, non serve rifarlo
// ad ogni chiamata.
function bootstrapSession() {
  if (!sessionPromise) {
    sessionPromise = fetch("https://www.instagram.com/", {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    })
      .then((res) => (res.ok ? parseSetCookieHeaders(res) : null))
      .catch(() => null);
  }
  return sessionPromise;
}

export async function fetchProfileStats(username) {
  const normalized = username?.trim().replace(/^@/, "");
  if (!normalized) return { stats: null, reason: "username mancante" };

  const cookies = await bootstrapSession();

  const headers = {
    "x-ig-app-id": IG_APP_ID,
    "User-Agent": USER_AGENT,
    Accept: "*/*",
    Referer: `https://www.instagram.com/${normalized}/`,
  };
  if (cookies && Object.keys(cookies).length > 0) {
    headers.Cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookies.csrftoken) headers["X-CSRFToken"] = cookies.csrftoken;
  }

  const res = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(normalized)}`,
    { headers, signal: AbortSignal.timeout(15000) },
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
