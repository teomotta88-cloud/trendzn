// Backfill storico dei post TikTok di un hashtag già monitorato in
// Bluserena-monitoring, usando il servizio a pagamento Apify (actor
// clockworks/tiktok-hashtag-scraper) invece delle tecniche gratuite
// (scroll DOM, paginazione API anonima) che si sono rivelate troppo
// limitate o bloccate da TikTok — vedi i probe scripts/probe-tiktok-hashtag-
// depth.mjs, probe-tiktok-hashtag-api-depth.py, probe-tiktok-hashtag-apify-
// depth.mjs per la storia di come si è arrivati a questa scelta.
//
// Fatto emerso dai probe: due chiamate Apify identiche restituiscono
// insiemi di post sovrapposti ma NON identici (la ricerca hashtag di TikTok
// è un risultato live/algoritmico, non un archivio con cursore stabile) —
// quindi questo script chiama Apify A RIPETIZIONE sullo stesso hashtag,
// accumulando i post nuovi, e si ferma da solo quando non emergono più post
// nuovi nelle due finestre di interesse per il confronto YoY (default 1
// lug-31 ago 2025 e 1 lug-31 ago 2026, configurabili via env). Non ci si
// ferma sui "post nuovi in generale": un run può continuare a trovare post
// di agosto 2026 (mese ancora in corso) senza che questo dica nulla sulla
// saturazione della copertura 2025, che è quella che conta per il confronto.
//
// Nessuna creazione di nuovi canali: arricchisce SOLO un hashtag già
// presente nello store (aggiunto manualmente/via import, come #bluserena in
// Fase 1) — se il canale non esiste, esce con errore.
//
// Uso: node scripts/backfill-tiktok-hashtag-apify.mjs <hashtag>
// Richiede APIFY_API_TOKEN e GITHUB_TOKEN nell'ambiente (secret GitHub).
// Env opzionali:
//   RESULTS_PER_CALL (default 400)
//   STAGNANT_CALLS_TO_STOP (default 3)
//   MAX_CALLS (default 10) — tetto di sicurezza sul costo, indipendente
//     dalla soglia sopra
//   DELAY_BETWEEN_CALLS_MS (default 30000)
//   WINDOW_A_START/WINDOW_A_END (default 2025-07-01/2025-08-31)
//   WINDOW_B_START/WINDOW_B_END (default 2026-07-01/2026-08-31)
//
// Costo: l'actor fattura $5 ogni 1000 risultati EFFETTIVAMENTE restituiti
// (non richiesti — i probe hanno mostrato che Apify può restituire meno del
// resultsPerPage chiesto). La stima di costo loggata qui è calcolata sui
// risultati reali, non sul tetto massimo teorico.

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;
const ACTOR = "clockworks~tiktok-hashtag-scraper";
const COST_PER_ITEM_USD = 0.005; // $5 / 1000 risultati, pricing pubblico dell'actor

const RESULTS_PER_CALL = parseInt(process.env.RESULTS_PER_CALL ?? "400", 10);
const STAGNANT_CALLS_TO_STOP = parseInt(process.env.STAGNANT_CALLS_TO_STOP ?? "3", 10);
const MAX_CALLS = parseInt(process.env.MAX_CALLS ?? "10", 10);
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
  console.error("Uso: node scripts/backfill-tiktok-hashtag-apify.mjs <hashtag>");
  process.exit(1);
}

const apifyToken = process.env.APIFY_API_TOKEN;
if (!apifyToken) {
  console.error("Manca APIFY_API_TOKEN nell'ambiente.");
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
    headers: {
      "User-Agent": "backfill-tiktok-hashtag-apify",
      Accept: "application/json,text/plain,*/*",
    },
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

// Stesso pattern retry-su-conflitto di sync-bluserena-hashtags.mjs: più
// script scrivono sullo stesso file, quindi rileggiamo e riproviamo invece
// di fallire silenziosamente.
async function writeStore(store) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: backfill storico hashtag TikTok #${tag} via Apify [trendzn-bot]`,
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

async function callApify() {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=280`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apifyToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hashtags: [tag], resultsPerPage: RESULTS_PER_CALL }),
  });
  if (!res.ok) {
    throw new Error(`Chiamata Apify fallita: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function mapItem(item) {
  if (!item.webVideoUrl) return null;
  return {
    platform: "tiktok",
    handle: item.authorMeta?.name ?? item.authorMeta?.nickName ?? tag,
    url: item.webVideoUrl,
    date: item.createTimeISO ?? (item.createTime ? new Date(item.createTime * 1000).toISOString() : null),
    caption: item.text ?? null,
    location: null,
    views: item.playCount ?? null,
    likes: item.diggCount ?? null,
    comments: item.commentCount ?? null,
    shares: item.shareCount ?? null,
  };
}

// --- Main ---
console.log(`=== Backfill storico TikTok via Apify: #${tag} ===`);
console.log(
  `Parametri: ${RESULTS_PER_CALL} risultati/chiamata, stop dopo ${STAGNANT_CALLS_TO_STOP} chiamate consecutive senza novità nelle finestre, tetto massimo ${MAX_CALLS} chiamate.`,
);
console.log(
  `Finestre: ${WINDOW_A.start.toISOString().slice(0, 10)}..${WINDOW_A.end.toISOString().slice(0, 10)} e ${WINDOW_B.start.toISOString().slice(0, 10)}..${WINDOW_B.end.toISOString().slice(0, 10)}\n`,
);

const { store } = await readStore();
const canale = store.canali.find((c) => {
  const info = hashtagInfo(c.urls?.[0] ?? "");
  return info && info.tag.toLowerCase() === tag.toLowerCase();
});

if (!canale) {
  console.error(
    `Nessun canale hashtag TikTok #${tag} trovato in ${STORE_PATH}. Aggiungilo prima dall'app (Aggiungi/import), poi rilancia questo script.`,
  );
  process.exit(1);
}

let stagnantCalls = 0;
let totalNewPosts = 0;
let totalNewInWindows = 0;
let totalItemsReturned = 0;
let stopReason = "saturazione";

for (let call = 1; call <= MAX_CALLS; call++) {
  console.log(`--- Chiamata ${call}/${MAX_CALLS} ---`);
  let items;
  try {
    items = await callApify();
  } catch (err) {
    console.error(`  Errore: ${String(err?.message || err)}`);
    stopReason = "errore";
    break;
  }
  totalItemsReturned += items.length;
  console.log(`  ${items.length} video restituiti.`);

  let newThisCall = 0;
  let newInWindowsThisCall = 0;
  for (const item of items) {
    const post = mapItem(item);
    if (!post) continue;
    if (canale.accounts.some((a) => a.url === post.url)) continue;
    canale.accounts.push(post);
    newThisCall++;
    if (inWindows(post.date ? new Date(post.date) : null)) newInWindowsThisCall++;
  }
  totalNewPosts += newThisCall;
  totalNewInWindows += newInWindowsThisCall;
  console.log(`  ${newThisCall} post nuovi (${newInWindowsThisCall} nelle finestre di interesse).`);

  if (newThisCall > 0) {
    await writeStore(store);
    console.log("  Store aggiornato su GitHub.");
  }

  if (newInWindowsThisCall === 0) {
    stagnantCalls++;
    console.log(`  Nessuna novità nelle finestre (${stagnantCalls}/${STAGNANT_CALLS_TO_STOP} chiamate consecutive vuote).`);
    if (stagnantCalls >= STAGNANT_CALLS_TO_STOP) {
      stopReason = "saturazione";
      break;
    }
  } else {
    stagnantCalls = 0;
  }

  if (call === MAX_CALLS) {
    stopReason = "tetto massimo chiamate";
    break;
  }

  await sleep(DELAY_BETWEEN_CALLS_MS);
}

const estimatedCost = (totalItemsReturned * COST_PER_ITEM_USD).toFixed(2);

console.log("\n=== Riepilogo ===");
console.log(`Motivo di stop: ${stopReason}`);
console.log(`Post nuovi totali aggiunti: ${totalNewPosts} (di cui ${totalNewInWindows} nelle finestre di interesse)`);
console.log(`Video totali restituiti da Apify in questo run: ${totalItemsReturned}`);
console.log(`Costo stimato di questo run: ~$${estimatedCost} (basato sui risultati realmente restituiti)`);
