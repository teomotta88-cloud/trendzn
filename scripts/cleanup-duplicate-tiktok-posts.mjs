// Script una tantum: rimuove i post duplicati già presenti in
// bluserena-monitoring.json, causati da un bug ora corretto in
// backfill-tiktok-hashtag.mjs (ScrapeCreators restituisce share_url con
// parametri di tracciamento generati a caso a ogni chiamata — _r, u_code,
// _d, ecc. — anche per lo STESSO video, mai deduplicati perché il confronto
// era per stringa esatta sull'URL completo).
//
// Per ogni gruppo di duplicati (stesso URL una volta rimossa la query
// string) FONDE i campi invece di tenerne uno a caso: se una copia ha la
// caption e un'altra ha i likes, il risultato finale ha entrambi. Questo
// script si limita a pulire lo storico esistente — la causa (dedup senza
// normalizzare l'URL) è già corretta in backfill-tiktok-hashtag.mjs, quindi
// non dovrebbe servire rilanciarlo di nuovo dopo questa pulizia.
//
// Uso: node scripts/cleanup-duplicate-tiktok-posts.mjs
// Richiede GITHUB_TOKEN nell'ambiente. Processa TUTTI i canali dello store
// (non solo un hashtag), scrive solo se trova davvero duplicati.

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github.v3+json",
};

// Stessa logica di normalizzazione introdotta in backfill-tiktok-hashtag.mjs
// (normalizeTikTokUrl) ma applicata a qualunque URL, non solo TikTok: la
// query string non fa mai parte dell'identità di un post in questo store.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

const MERGE_FIELDS = ["date", "caption", "location", "views", "likes", "comments", "shares", "handle"];

function mergeDuplicates(group) {
  const merged = { ...group[0], url: normalizeUrl(group[0].url) };
  for (const dup of group.slice(1)) {
    for (const field of MERGE_FIELDS) {
      if ((merged[field] == null || merged[field] === "") && dup[field] != null) {
        merged[field] = dup[field];
      }
    }
  }
  return merged;
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
    headers: { "User-Agent": "cleanup-duplicate-tiktok-posts", Accept: "application/json,text/plain,*/*" },
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

async function writeStore(store) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: rimuovi post duplicati Bluserena-monitoring [trendzn-bot]",
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

// --- Main ---
console.log("=== Pulizia duplicati Bluserena-monitoring ===\n");

const { store } = await readStore();
let totalRemoved = 0;

for (const canale of store.canali) {
  const before = canale.accounts.length;
  const groups = new Map();
  for (const account of canale.accounts) {
    const key = normalizeUrl(account.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(account);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  if (duplicateGroups.length === 0) {
    console.log(`Canale "${canale.id}": nessun duplicato (${before} post).`);
    continue;
  }

  canale.accounts = [...groups.values()].map(mergeDuplicates);
  const removed = before - canale.accounts.length;
  totalRemoved += removed;
  console.log(
    `Canale "${canale.id}": ${duplicateGroups.length} video duplicati trovati, ${removed} righe rimosse (${before} -> ${canale.accounts.length} post).`,
  );
}

if (totalRemoved === 0) {
  console.log("\nNessun duplicato trovato, store non modificato.");
  process.exit(0);
}

await writeStore(store);
console.log(`\nTotale righe rimosse: ${totalRemoved}. Store aggiornato su GitHub.`);
