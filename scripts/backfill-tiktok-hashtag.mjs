// Backfill storico dei post TikTok di un hashtag già monitorato in
// Bluserena-monitoring. Evoluzione di backfill-tiktok-hashtag-apify.mjs:
// stessa idea (chiamare un servizio a pagamento a ripetizione, accumulare i
// post nuovi, fermarsi da solo quando non emergono più novità nelle finestre
// di interesse per il confronto YoY — vedi i probe scripts/probe-tiktok-
// hashtag-*.{mjs,py} per la storia di come si è arrivati a questa scelta),
// ma con DUE fonti in cascata invece di una sola:
//
//   1. Apify (clockworks/tiktok-hashtag-scraper) — prima scelta, già
//      validata (probe-tiktok-hashtag-apify-depth.mjs: 400 post fino al
//      2020, engagement reale). Costa per RISULTATO restituito.
//   2. ScrapeCreators (/v1/tiktok/search/hashtag) — backup, usato quando
//      Apify fallisce (in pratica: quando esaurisce il credito, ma vedi
//      nota sotto sul perché si passa alla fonte successiva su QUALSIASI
//      errore, non solo quello). Costa 1 credito a CHIAMATA (non per
//      risultato): con 100 crediti gratuiti non scadenti copre molti più
//      giri di Apify a parità di budget. La loro stessa documentazione
//      conferma lo stesso fenomeno osservato con Apify: "TikTok can return
//      duplicate results for this search" — nessuna fonte, a quanto pare,
//      ha un cursore stabile su questo tipo di ricerca.
//
// Verificato su un run reale (26/08/2026): quando Apify esaurisce il
// credito, l'errore restituito è un generico {"error":{"type":"run-failed",
// "message":"Actor run did not succeed..."}} (HTTP 400) — indistinguibile
// testualmente da un fallimento per qualsiasi altra causa. Per questo lo
// script passa alla fonte successiva su QUALSIASI errore della fonte
// attiva, non solo su un presunto "errore di credito" riconosciuto dal
// testo (approccio provato e scartato: vedi commit precedenti).
//
// Regola di stop (rivista dopo l'analisi del run reale su #bluserena, che
// aveva mostrato "20/20 nuovi ogni chiamata" per 8 chiamate di fila SOLO per
// il bug dell'URL non normalizzato: una volta ricontrollato per video ID
// reale, quelle 8 chiamate avevano trovato 0 post davvero nuovi — la
// saturazione era già arrivata alla seconda chiamata): si fanno sempre
// almeno MIN_CALLS chiamate (default 2); da lì in poi, alla prima chiamata
// senza nessun post NUOVO nelle finestre di interesse ci si ferma; se anche
// la chiamata MIN_CALLS trova ancora qualcosa, se ne fa una sola in più
// (tetto MAX_CALLS, default 3) e poi ci si ferma comunque. Vale attraverso
// l'intero processo multi-fonte, non per singola fonte. Da lì in poi si
// prosegue solo con lo scraping DIY quotidiano (sync-bluserena-hashtags.mjs).
//
// Novità rispetto alla versione solo-Apify: oltre ad aggiungere i post mai
// visti, questo script ARRICCHISCE i post già presenti nello store (es.
// trovati in precedenza dallo scraping DIY, quindi tipicamente senza
// like/commenti/condivisioni/views) con i campi mancanti, quando la fonte
// a pagamento li restituisce per lo stesso URL. Un post arricchito non
// conta come "nuovo" ai fini della soglia di stop (quella soglia misura la
// scoperta di post mai visti, non l'arricchimento di quelli già noti).
//
// Nessuna creazione di nuovi canali: arricchisce SOLO un hashtag già
// presente nello store — se il canale non esiste, esce con errore.
//
// Uso: node scripts/backfill-tiktok-hashtag.mjs <hashtag>
// Richiede GITHUB_TOKEN sempre, APIFY_API_TOKEN e/o SCRAPECREATORS_API_KEY
// (basta una delle due per partire; se manca la seconda e la prima esaurisce
// il credito, lo script si ferma con un messaggio chiaro invece di crashare).
// Env opzionali: RESULTS_PER_CALL, MIN_CALLS, MAX_CALLS,
// DELAY_BETWEEN_CALLS_MS, WINDOW_A_START/END, WINDOW_B_START/END.

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;
const APIFY_ACTOR = "clockworks~tiktok-hashtag-scraper";
const APIFY_COST_PER_ITEM_USD = 0.005; // $5 / 1000 risultati, pricing pubblico dell'actor

const RESULTS_PER_CALL = parseInt(process.env.RESULTS_PER_CALL ?? "400", 10);
// Si fanno sempre almeno MIN_CALLS chiamate; da lì in poi ci si ferma alla
// prima chiamata senza post nuovi nelle finestre (non serve più attendere
// chiamate consecutive vuote, vedi commento in testa al file). MAX_CALLS è
// il tetto assoluto: con MIN_CALLS=2 e MAX_CALLS=3 si fa al massimo UNA
// chiamata in più oltre al minimo, se la seconda aveva ancora trovato
// qualcosa.
const MIN_CALLS = parseInt(process.env.MIN_CALLS ?? "2", 10);
const MAX_CALLS = parseInt(process.env.MAX_CALLS ?? "3", 10);
const DELAY_BETWEEN_CALLS_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "30000", 10);

const WINDOW_A = {
  start: new Date(process.env.WINDOW_A_START ?? "2025-07-01T00:00:00Z"),
  end: new Date(process.env.WINDOW_A_END ?? "2025-08-31T23:59:59Z"),
};
const WINDOW_B = {
  start: new Date(process.env.WINDOW_B_START ?? "2026-07-01T00:00:00Z"),
  end: new Date(process.env.WINDOW_B_END ?? "2026-08-31T23:59:59Z"),
};

function inWindows(date) {
  if (!date) return false;
  const t = date.getTime();
  return (
    (t >= WINDOW_A.start.getTime() && t <= WINDOW_A.end.getTime()) ||
    (t >= WINDOW_B.start.getTime() && t <= WINDOW_B.end.getTime())
  );
}

const tag = process.argv[2];
if (!tag) {
  console.error("Uso: node scripts/backfill-tiktok-hashtag.mjs <hashtag>");
  process.exit(1);
}

const apifyToken = process.env.APIFY_API_TOKEN;
const scrapeCreatorsKey = process.env.SCRAPECREATORS_API_KEY;
if (!apifyToken && !scrapeCreatorsKey) {
  console.error("Serve almeno una fonte configurata: APIFY_API_TOKEN o SCRAPECREATORS_API_KEY.");
  process.exit(1);
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ScrapeCreators restituisce share_url con parametri di tracciamento
// (_r, u_code, _d, ecc.) GENERATI A CASO a ogni chiamata, anche per lo
// STESSO identico video — verificato su un run reale: la stessa chiamata
// ripetuta 10 volte ha prodotto 10 URL diversi per il video già visto alla
// prima chiamata, mai deduplicati perché il confronto era per stringa
// esatta. La query string non fa parte dell'identità del video (l'ID è nel
// path), quindi va rimossa sia quando si salva l'URL sia quando si
// confronta con quelli già nello store.
function normalizeTikTokUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

// Stesso criterio usato lato UI e da sync-bluserena-hashtags.mjs: riconosce
// una pagina hashtag dalla FORMA del path, nessun campo extra nello store.
function hashtagInfo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/$/, "");
  const ttMatch = /^\/tags?\/([^/]+)$/.exec(path);
  if (/tiktok\.com$/.test(host) && ttMatch) {
    return { platform: "tiktok", tag: decodeURIComponent(ttMatch[1]) };
  }
  return null;
}

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    headers: ghHeaders,
  });
  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata bluserena-monitoring.json fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }
  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;
  const rawRes = await fetch(rawUrl, {
    headers: { "User-Agent": "backfill-tiktok-hashtag", Accept: "application/json,text/plain,*/*" },
  });
  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw bluserena-monitoring.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];
  return { store, sha };
}

// Stesso pattern retry-su-conflitto di sync-bluserena-hashtags.mjs.
async function writeStore(store) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: backfill storico hashtag TikTok #${tag} [trendzn-bot]`,
        content,
        sha,
      }),
    });

    if (res.ok) return;
    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(`Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`);
      continue;
    }
    throw new Error(`Scrittura bluserena-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }
  throw new Error("Troppi conflitti di scrittura su bluserena-monitoring.json.");
}

// NON si prova a riconoscere "è un errore di credito esaurito" dal testo
// della risposta: verificato su un run reale che, quando Apify esaurisce il
// credito, l'errore restituito è un generico
// {"error":{"type":"run-failed","message":"Actor run did not succeed..."}}
// (HTTP 400) — indistinguibile testualmente da un fallimento per qualsiasi
// altra ragione. Per questo QUALSIASI errore della fonte attiva fa passare
// alla fonte successiva, se disponibile: non abbiamo un modo affidabile per
// distinguere "credito finito" da altri fallimenti, quindi non ha senso
// continuare a insistere sulla stessa fonte comunque.

// --- Apify ---
async function callApify() {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?timeout=280`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apifyToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hashtags: [tag], resultsPerPage: RESULTS_PER_CALL }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Apify: ${res.status} ${text}`);
  }
  const items = JSON.parse(text);
  return { items: items.map(mapApifyItem), costUsd: items.length * APIFY_COST_PER_ITEM_USD };
}

function mapApifyItem(item) {
  if (!item.webVideoUrl) return null;
  return {
    platform: "tiktok",
    handle: item.authorMeta?.name ?? item.authorMeta?.nickName ?? null,
    url: normalizeTikTokUrl(item.webVideoUrl),
    date:
      item.createTimeISO ?? (item.createTime ? new Date(item.createTime * 1000).toISOString() : null),
    caption: item.text ?? null,
    location: null,
    views: item.playCount ?? null,
    likes: item.diggCount ?? null,
    comments: item.commentCount ?? null,
    shares: item.shareCount ?? null,
  };
}

// --- ScrapeCreators ---
// Parametro "hashtag" (singolare) confermato su un run reale
// (probe-scrapecreators-multi-hashtag.mjs): un hashtag per chiamata, non
// supporta liste/comma-separated (restituisce un match spurio senza errore,
// quindi va usato un solo hashtag alla volta senza eccezioni).
async function callScrapeCreators() {
  const url = `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(tag)}`;
  const res = await fetch(url, { headers: { "x-api-key": scrapeCreatorsKey } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ScrapeCreators: ${res.status} ${text}`);
  }
  const data = JSON.parse(text);
  const list = data.aweme_list ?? data.videos ?? [];
  if (data.credits_remaining != null) {
    console.log(`  (ScrapeCreators: ${data.credits_remaining} crediti residui)`);
  }
  return { items: list.map(mapScrapeCreatorsItem), costUsd: 0 }; // 1 credito/chiamata, non per risultato
}

function mapScrapeCreatorsItem(item) {
  const rawUrl =
    item.share_url ??
    (item.aweme_id ? `https://www.tiktok.com/@${item.author?.unique_id}/video/${item.aweme_id}` : null);
  if (!rawUrl) return null;
  return {
    platform: "tiktok",
    handle: item.author?.unique_id ?? item.author?.nickname ?? null,
    url: normalizeTikTokUrl(rawUrl),
    date: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    caption: item.desc ?? null,
    location: null,
    views: item.statistics?.play_count ?? null,
    likes: item.statistics?.digg_count ?? null,
    comments: item.statistics?.comment_count ?? null,
    shares: item.statistics?.share_count ?? null,
  };
}

const SOURCES = [
  { name: "Apify", enabled: !!apifyToken, call: callApify },
  { name: "ScrapeCreators", enabled: !!scrapeCreatorsKey, call: callScrapeCreators },
];

// Aggiorna un post già presente con i campi che gli mancano (mai sovrascrive
// un valore già presente) — non conta come "nuovo" post.
function enrichExisting(existing, fresh) {
  let changed = false;
  for (const field of ["date", "caption", "location", "views", "likes", "comments", "shares", "handle"]) {
    if ((existing[field] == null || existing[field] === "") && fresh[field] != null) {
      existing[field] = fresh[field];
      changed = true;
    }
  }
  return changed;
}

// --- Main ---
console.log(`=== Backfill storico TikTok: #${tag} ===`);
console.log(
  `Parametri: ${RESULTS_PER_CALL} risultati/chiamata (Apify), minimo ${MIN_CALLS} chiamate poi stop alla prima senza novità nelle finestre, tetto massimo ${MAX_CALLS} chiamate totali.`,
);
console.log(
  `Finestre: ${WINDOW_A.start.toISOString().slice(0, 10)}..${WINDOW_A.end.toISOString().slice(0, 10)} e ${WINDOW_B.start.toISOString().slice(0, 10)}..${WINDOW_B.end.toISOString().slice(0, 10)}`,
);
console.log(
  `Fonti disponibili: ${SOURCES.filter((s) => s.enabled).map((s) => s.name).join(" -> ") || "nessuna"}\n`,
);

const { store } = await readStore();
const canale = store.canali.find((c) => {
  const info = hashtagInfo(c.urls?.[0] ?? "");
  return info && info.tag.toLowerCase() === tag.toLowerCase();
});

if (!canale) {
  console.error(
    `Nessun canale hashtag TikTok #${tag} trovato in ${STORE_PATH}. Aggiungilo prima dall'app, poi rilancia questo script.`,
  );
  process.exit(1);
}

let sourceIdx = SOURCES.findIndex((s) => s.enabled);
let call = 0;
let totalNewPosts = 0;
let totalEnriched = 0;
let totalNewInWindows = 0;
let totalCostUsd = 0;
let stopReason = "saturazione";

while (call < MAX_CALLS) {
  if (sourceIdx === -1 || sourceIdx >= SOURCES.length) {
    stopReason = "fonti esaurite";
    break;
  }
  const source = SOURCES[sourceIdx];
  call++;
  console.log(`--- Chiamata ${call}/${MAX_CALLS} (fonte: ${source.name}) ---`);

  let result;
  try {
    result = await source.call();
  } catch (err) {
    console.error(`  Errore su ${source.name}: ${err.message}`);
    const nextIdx = SOURCES.findIndex((s, i) => i > sourceIdx && s.enabled);
    call--; // la chiamata fallita non conta sul tetto massimo, non ha prodotto nulla
    if (nextIdx === -1) {
      stopReason = "fonti esaurite";
      break;
    }
    console.log(`  Passo alla fonte successiva: ${SOURCES[nextIdx].name}.`);
    sourceIdx = nextIdx;
    continue;
  }

  totalCostUsd += result.costUsd;
  console.log(`  ${result.items.length} video restituiti.`);

  let newThisCall = 0;
  let enrichedThisCall = 0;
  let newInWindowsThisCall = 0;
  for (const post of result.items) {
    if (!post) continue;
    const existing = canale.accounts.find((a) => a.url === post.url);
    if (existing) {
      if (enrichExisting(existing, post)) enrichedThisCall++;
      continue;
    }
    canale.accounts.push(post);
    newThisCall++;
    if (inWindows(post.date ? new Date(post.date) : null)) newInWindowsThisCall++;
  }
  totalNewPosts += newThisCall;
  totalEnriched += enrichedThisCall;
  totalNewInWindows += newInWindowsThisCall;
  console.log(
    `  ${newThisCall} post nuovi (${newInWindowsThisCall} nelle finestre di interesse), ${enrichedThisCall} post esistenti arricchiti.`,
  );

  if (newThisCall > 0 || enrichedThisCall > 0) {
    await writeStore(store);
    console.log("  Store aggiornato su GitHub.");
  }

  if (call >= MIN_CALLS && newInWindowsThisCall === 0) {
    console.log(`  Nessun post nuovo nelle finestre dopo almeno ${MIN_CALLS} chiamate, mi fermo qui.`);
    stopReason = "saturazione";
    break;
  }

  if (call === MAX_CALLS) {
    stopReason = "tetto massimo chiamate";
    break;
  }

  await sleep(DELAY_BETWEEN_CALLS_MS);
}

console.log("\n=== Riepilogo ===");
console.log(`Motivo di stop: ${stopReason}`);
console.log(`Chiamate totali effettuate: ${call}`);
console.log(`Post nuovi aggiunti: ${totalNewPosts} (di cui ${totalNewInWindows} nelle finestre di interesse)`);
console.log(`Post esistenti arricchiti con dati mancanti: ${totalEnriched}`);
console.log(`Costo stimato (solo Apify, ScrapeCreators è a credito fisso/chiamata): ~$${totalCostUsd.toFixed(2)}`);
console.log(
  "\nQuando questo script si ferma per saturazione o fonti esaurite, il monitoraggio prosegue solo con lo scraping DIY quotidiano (sync-bluserena-hashtags.yml).",
);
