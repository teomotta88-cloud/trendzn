// Verifica periodica di validità dei secret usati SOLO dagli script di sync
// in CI (GitHub Actions secrets, non raggiungibili dall'app deployata — per
// i secret usati lato app vedi invece check-token-health.ts, chiamato dallo
// stesso workflow schedulato .github/workflows/check-secrets-health.yml).
//
// Ogni check è una singola chiamata read-only economica al provider reale,
// con l'endpoint già usato altrove nel progetto per quel token (mai
// inventato). RETTIWT_API_KEY (stringa di cookie, non un token semplice) e
// le credenziali TikTok Creative Center (email/password, non un token API)
// non sono verificate automaticamente: un probe periodico rischierebbe di
// far scattare le protezioni anti-bot delle piattaforme, lo stesso motivo
// per cui sync-x-posts.mjs/tiktok-hashtag.mjs sono già scritti per essere
// tolleranti ai fallimenti di login.
//
// Uscita: exit 1 se un secret CONFIGURATO risulta non valido (fa fallire il
// job del workflow, che invia la notifica email standard di GitHub Actions
// sui run falliti — nessun canale di notifica aggiuntivo da costruire).

const results = [];

async function checkYouTube() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    return { name: "YOUTUBE_API_KEY", configured: false, valid: null, detail: "non configurato" };
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      const body = await res.text();
      return {
        name: "YOUTUBE_API_KEY",
        configured: true,
        valid: false,
        detail: `YouTube Data API ha risposto ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { name: "YOUTUBE_API_KEY", configured: true, valid: true, detail: "chiave valida" };
  } catch (err) {
    return {
      name: "YOUTUBE_API_KEY",
      configured: true,
      valid: false,
      detail: String(err).slice(0, 200),
    };
  }
}

async function checkAnysite() {
  const key = process.env.ANYSITE_API_KEY;
  if (!key)
    return { name: "ANYSITE_API_KEY", configured: false, valid: null, detail: "non configurato" };
  try {
    // Stesso endpoint confermato usato da searchAnysite() in
    // scripts/lib/social-search.mjs (l'unico dei 4 path anysite testato con
    // un token reale finora).
    const res = await fetch("https://api.anysite.io/api/twitter/search/posts?query=test&limit=1", {
      headers: { "access-token": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        name: "ANYSITE_API_KEY",
        configured: true,
        valid: false,
        detail: `anysite ha risposto ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { name: "ANYSITE_API_KEY", configured: true, valid: true, detail: "chiave valida" };
  } catch (err) {
    return {
      name: "ANYSITE_API_KEY",
      configured: true,
      valid: false,
      detail: String(err).slice(0, 200),
    };
  }
}

async function checkTwitterBearer() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token)
    return {
      name: "TWITTER_BEARER_TOKEN",
      configured: false,
      valid: null,
      detail: "non configurato",
    };
  try {
    const res = await fetch(
      "https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10",
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      const body = await res.text();
      return {
        name: "TWITTER_BEARER_TOKEN",
        configured: true,
        valid: false,
        detail: `Twitter API v2 ha risposto ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { name: "TWITTER_BEARER_TOKEN", configured: true, valid: true, detail: "token valido" };
  } catch (err) {
    return {
      name: "TWITTER_BEARER_TOKEN",
      configured: true,
      valid: false,
      detail: String(err).slice(0, 200),
    };
  }
}

async function checkReddit() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return {
      name: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET",
      configured: false,
      valid: null,
      detail: "non configurato",
    };
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "trendzn-bot/1.0 (discovery trend virali, uso non commerciale)",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        name: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET",
        configured: true,
        valid: false,
        detail: `OAuth token Reddit ha risposto ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    if (!data.access_token) {
      return {
        name: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET",
        configured: true,
        valid: false,
        detail: "risposta OAuth senza access_token",
      };
    }
    return {
      name: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET",
      configured: true,
      valid: true,
      detail: "credenziali valide",
    };
  } catch (err) {
    return {
      name: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET",
      configured: true,
      valid: false,
      detail: String(err).slice(0, 200),
    };
  }
}

function checkUnverifiable(name, reason) {
  const configured = !!process.env[name];
  return {
    name,
    configured,
    valid: null,
    detail: configured ? `non verificato automaticamente: ${reason}` : "non configurato",
  };
}

results.push(await checkYouTube());
results.push(await checkAnysite());
results.push(await checkTwitterBearer());
results.push(await checkReddit());
results.push(
  checkUnverifiable(
    "RETTIWT_API_KEY",
    "cookie di sessione, non un token API validabile con una singola chiamata",
  ),
);
results.push(
  checkUnverifiable(
    "TIKTOK_CC_EMAIL",
    "credenziali di login, un probe periodico rischia di far scattare un CAPTCHA",
  ),
);

console.log("=== Stato secret CI ===");
for (const r of results) {
  const icon =
    r.valid === true ? "OK" : r.valid === false ? "NON VALIDO" : r.configured ? "N/D" : "assente";
  console.log(`[${icon}] ${r.name}: ${r.detail}`);
}

const invalid = results.filter((r) => r.valid === false);
if (invalid.length > 0) {
  console.error(
    `\n${invalid.length} secret configurati ma non validi: ${invalid.map((r) => r.name).join(", ")}`,
  );
  process.exit(1);
}
