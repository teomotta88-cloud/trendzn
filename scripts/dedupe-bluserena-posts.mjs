// Rimuove dallo store Bluserena-monitoring le righe che descrivono lo STESSO
// post più di una volta, fondendo i campi invece di scartarne una a caso.
//
// Perché serve: lo store tiene una riga per canale, quindi un post che
// compare sotto più hashtag esiste in più copie. Le statistiche della pagina
// (totali, confirmed, sentiment, medie view) contano le righe, quindi ogni
// copia gonfia i numeri: sui dati del 04/09 sono 168 righe su 1478.
//
// Criterio unico: stessa url, a meno della query string — i share_url di
// TikTok portano parametri di tracciamento generati a caso a ogni scrape,
// stesso video. Due righe con url diversa restano due post, anche quando
// autore, giorno e caption coincidono: un autore che copre un evento dal vivo
// pubblica davvero più clip con la stessa caption, e fonderle perderebbe
// contenuti veri.
//
// Si distingue da cleanup-duplicate-tiktok-posts.mjs, che applica lo stesso
// criterio ma solo DENTRO un canale: qui il confronto attraversa i canali, ed
// è lì che stanno praticamente tutte le copie.
//
// Uso:
//   node scripts/dedupe-bluserena-posts.mjs                 scrive su GitHub
//   DRY_RUN=true node scripts/dedupe-bluserena-posts.mjs    solo report
//
// Richiede GITHUB_TOKEN nell'ambiente.

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;
const DRY_RUN = process.env.DRY_RUN === "true";

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${githubToken}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "dedupe-bluserena-posts",
};

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

const normalizeText = (text) => (text || "").replace(/\s+/g, " ").trim().toLowerCase();

// Identità di un post: la sua url senza query string. Stesso criterio del
// feed (contentKey in BluserenaFeedAdvanced.tsx): se i due divergessero, la
// pagina mostrerebbe un numero di post diverso da quello che c'è nei dati.
const contentKey = (account) => normalizeUrl(account.url);

// Solo i post veri: i profili (url senza /p/, /reel/, /video/...) non sono
// duplicati fra loro anche quando condividono handle e data assente.
const isPost = (account) =>
  /\/(p|reel|reels|video|photo|watch|tv|status)\//i.test(account.url || "");

// Campi che possono mancare in una copia ed esserci in un'altra: la sync di
// un hashtag raccoglie metriche che quella di un altro non vede, e le analisi
// AI girano su una riga sola. Vanno fusi, o la pulizia perderebbe dati.
const MERGE_FIELDS = [
  "date",
  "caption",
  "location",
  "views",
  "likes",
  "comments",
  "shares",
  "sentiment",
  "topics",
  "audioUrl",
  "audioAnalysis",
  "ocrData",
  "ocrInsights",
];

const isEmpty = (value) =>
  value == null || value === "" || (Array.isArray(value) && value.length === 0);

// Quanto è "ricca" una riga: a parità di contenuto teniamo quella che porta
// più informazione, così l'url e il canale superstiti sono quelli della copia
// meglio popolata invece che quelli della prima incontrata.
const richness = (account) => MERGE_FIELDS.filter((f) => !isEmpty(account[f])).length;

function mergeGroup(group) {
  const sorted = [...group].sort((a, b) => richness(b.account) - richness(a.account));
  const winner = sorted[0];
  const merged = { ...winner.account };

  for (const { account } of sorted.slice(1)) {
    for (const field of MERGE_FIELDS) {
      if (isEmpty(merged[field]) && !isEmpty(account[field])) merged[field] = account[field];
    }
    // Una conferma manuale vale più di un "unconfirmed" calcolato: se una
    // qualsiasi copia è confirmed, il post resta confirmed.
    if (account.verificationStatus === "confirmed") merged.verificationStatus = "confirmed";
  }

  return { winner, merged };
}

async function readStore() {
  // Scorciatoia per provare la regola in locale senza toccare GitHub:
  //   DRY_RUN=true STORE_FILE=src/data/bluserena-monitoring.json node scripts/dedupe-bluserena-posts.mjs
  // Legge e basta: la scrittura passa sempre e solo dall'API.
  if (process.env.STORE_FILE) {
    const { readFileSync } = await import("node:fs");
    const store = JSON.parse(readFileSync(process.env.STORE_FILE, "utf8"));
    if (!Array.isArray(store.canali)) store.canali = [];
    return { store, sha: null };
  }

  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
    headers: ghHeaders,
  });
  if (!metaRes.ok) {
    throw new Error(`Lettura metadata fallita: ${metaRes.status} ${await metaRes.text()}`);
  }
  const meta = await metaRes.json();

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;
  const rawRes = await fetch(rawUrl, {
    headers: { "User-Agent": "dedupe-bluserena-posts", Accept: "application/json,text/plain,*/*" },
  });
  if (!rawRes.ok) {
    throw new Error(`Lettura raw fallita: ${rawRes.status} ${await rawRes.text()}`);
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];
  return { store, sha: meta.sha };
}

async function writeStore(store, removed) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: rimuovi ${removed} post duplicati Bluserena [trendzn-bot]

Righe che puntavano allo stesso post (stessa url a meno della query
string) da canali hashtag diversi. I campi delle copie sono stati fusi
nella riga superstite, non scartati.`,
        content,
        sha,
      }),
    });

    if (res.ok) return;
    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`,
      );
      continue;
    }
    throw new Error(`Scrittura fallita: ${res.status} ${await res.text()}`);
  }
  throw new Error("Troppi conflitti di scrittura sullo store.");
}

// --- Main ---
console.log("=== Deduplica post Bluserena-monitoring ===\n");
if (DRY_RUN) console.log("DRY_RUN: nessuna scrittura, solo report.");
console.log("Criterio: stessa url a meno della query string.\n");

const { store } = await readStore();

// Un solo passaggio su tutti i canali: le copie stanno quasi tutte FRA canali
// diversi, quindi deduplicare canale per canale — come fa già
// cleanup-duplicate-tiktok-posts.mjs — ne intercetterebbe una minima parte.
const groups = new Map();
let totalPosts = 0;

for (const canale of store.canali) {
  for (const account of canale.accounts || []) {
    if (!isPost(account)) continue;
    totalPosts++;
    const key = contentKey(account);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ canale, account });
  }
}

const duplicated = [...groups.entries()].filter(([, g]) => g.length > 1);
const removedRows = duplicated.reduce((n, [, g]) => n + g.length - 1, 0);

console.log(`Post totali: ${totalPosts}`);
console.log(`Contenuti distinti: ${groups.size}`);
console.log(`Gruppi con copie: ${duplicated.length} — righe da rimuovere: ${removedRows}\n`);

if (removedRows === 0) {
  console.log("Nessun duplicato, store non modificato.");
  process.exit(0);
}

// Riepilogo dei casi più vistosi: con l'url come criterio non c'è ambiguità
// da controllare, ma vedere in quali canali stava ogni post aiuta a capire
// cosa sparisce da quali viste.
console.log("I 10 post presenti in più copie:");
for (const [, group] of [...duplicated].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  const first = group[0].account;
  const canali = group.map((g) => g.canale.id).join(", ");
  console.log(
    `  x${group.length}  @${first.handle || "?"}  ${(first.date || "").slice(0, 10)}  ` +
      `"${normalizeText(first.caption).slice(0, 45)}"  [${canali}]`,
  );
}

// Applica: la riga superstite resta nel canale della copia più ricca, le
// altre spariscono dai rispettivi canali.
const keep = new Map();
for (const [key, group] of groups) {
  const { winner, merged } =
    group.length > 1 ? mergeGroup(group) : { winner: group[0], merged: group[0].account };
  keep.set(key, { canaleId: winner.canale.id, url: winner.account.url, merged });
}

let statusPromossi = 0;
for (const canale of store.canali) {
  canale.accounts = (canale.accounts || []).filter((account) => {
    if (!isPost(account)) return true;
    const target = keep.get(contentKey(account));
    return target.canaleId === canale.id && target.url === account.url;
  });

  canale.accounts = canale.accounts.map((account) => {
    if (!isPost(account)) return account;
    const target = keep.get(contentKey(account));
    if (
      target.merged.verificationStatus === "confirmed" &&
      account.verificationStatus !== "confirmed"
    ) {
      statusPromossi++;
    }
    return target.merged;
  });
}

const finalPosts = store.canali.reduce((n, c) => n + (c.accounts || []).filter(isPost).length, 0);
console.log(`\nPost dopo la pulizia: ${finalPosts} (erano ${totalPosts})`);
if (statusPromossi > 0) {
  console.log(`Post rimasti confirmed grazie a una copia confermata: ${statusPromossi}`);
}

if (DRY_RUN || process.env.STORE_FILE) {
  // In modalità locale STORE_OUT salva il risultato su file, così si può
  // diffare com'è venuto prima di far scrivere davvero lo script.
  if (process.env.STORE_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.STORE_OUT, `${JSON.stringify(store, null, 2)}\n`);
    console.log(
      `\nRisultato scritto in ${process.env.STORE_OUT} (file locale, GitHub non toccato).`,
    );
  }
  console.log("\nDRY_RUN: store NON scritto su GitHub.");
  process.exit(0);
}

await writeStore(store, removedRows);
console.log("\nStore aggiornato su GitHub.");
