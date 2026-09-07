// I/O condiviso su src/data/bluserena-monitoring.json per gli script che
// arricchiscono i post con UN SOLO campo ciascuno (OCR -> ocrData,
// trascrizione audio -> audioAnalysis).
//
// Perché non si riscrive l'intero store letto a inizio run: sullo stesso file
// scrivono una decina di workflow diversi. Il vecchio codice leggeva store+sha
// all'avvio e faceva la PUT anche un'ora dopo, con due conseguenze viste in
// produzione:
//   1. 409 "does not match <sha>" -> l'intera run buttata via (run #14 audio
//      del 31/08: 53 minuti di lavoro persi, zero risultati salvati);
//   2. anche senza 409, la PUT riportava indietro l'intero file da una copia
//      stantia, cancellando le modifiche fatte nel frattempo dagli altri
//      workflow (lost update silenzioso).
// commitField() rilegge quindi lo store fresco subito prima di ogni PUT e ci
// riapplica sopra SOLO il campo di competenza dello script, riprovando su
// conflitto — stesso pattern retry-su-409 già usato in
// sync-bluserena-hashtags.mjs / sync-x-posts.mjs.

export const REPO = "teomotta88-cloud/trendzn";
export const STORE_PATH = "src/data/bluserena-monitoring.json";

const MAX_ATTEMPTS = 5;

function token() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    console.error("❌ GITHUB_TOKEN non impostato.");
    process.exit(1);
  }
  return t;
}

function ghHeaders() {
  return {
    Authorization: `token ${token()}`,
    Accept: "application/vnd.github.v3+json",
  };
}

// Si legge/scrive sempre lo stesso ref: su workflow_dispatch da un branch il
// vecchio codice leggeva main e scriveva sul default branch, qui i due lati
// restano coerenti.
export function targetBranch() {
  return process.env.GITHUB_REF_NAME || "main";
}

// Il file supera 1 MB, quindi l'endpoint `contents` non ne restituisce il
// contenuto: si prende da lì solo lo sha e si scarica il blob corrispondente.
//
// Non si usa raw.githubusercontent: è una CDN che può servire una copia
// stantia. Con i commit incrementali sarebbe un problema serio — la rilettura
// del batch N+1 potrebbe non contenere il batch N appena scritto e la PUT,
// che porta invece uno sha fresco e quindi valido, riporterebbe il file
// indietro. Il blob è identificato dallo sha stesso: contenuto e sha sono
// consistenti per costruzione.
export async function readStore() {
  const branch = targetBranch();

  const metaRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${STORE_PATH}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders() },
  );
  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata ${STORE_PATH} fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }
  const sha = (await metaRes.json()).sha;

  const blobRes = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" },
  });
  if (!blobRes.ok) {
    throw new Error(`Lettura blob ${sha} fallita: ${blobRes.status} ${await blobRes.text()}`);
  }

  const raw = await blobRes.text();
  if (!raw.trim()) throw new Error(`${STORE_PATH} è vuoto.`);

  const store = JSON.parse(raw);
  if (!Array.isArray(store.canali)) store.canali = [];
  return { store, sha };
}

// Tutti i post di tutti i canali, in ordine di file.
export function* eachAccount(store) {
  for (const canale of store.canali || []) {
    for (const account of canale.accounts || []) {
      yield { canale, account };
    }
  }
}

// Applica `updates` (Map url -> valore) sul campo `field` dello store fresco e
// committa. Lo stesso URL può comparire in più canali: si aggiornano tutte le
// occorrenze. Ritorna il numero di post effettivamente scritti.
// `apply` serve a chi non scrive un campo solo: l'analisi del sentiment
// deposita il proprio record in sentimentData ma deve aggiornare anche i campi
// piatti che legge la UI (sentiment, topics, location). Chi non lo passa
// ottiene il comportamento di sempre, un campo e basta.
export async function commitField({ field, updates, message, apply }) {
  if (!updates.size) return 0;

  const write = apply ?? ((account, record) => (account[field] = record));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { store, sha } = await readStore();

    let applied = 0;
    for (const { account } of eachAccount(store)) {
      if (updates.has(account.url)) {
        write(account, updates.get(account.url));
        applied++;
      }
    }

    if (!applied) {
      console.log(`  ⚠️  Nessuno dei ${updates.size} post da salvare è più presente nello store.`);
      return 0;
    }

    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, sha, branch: targetBranch() }),
    });

    if (res.ok) return applied;

    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(`  ↻ Conflitto di scrittura (${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`);
      continue;
    }

    throw new Error(`Scrittura ${STORE_PATH} fallita: ${res.status} ${await res.text()}`);
  }

  throw new Error(`Troppi conflitti di scrittura su ${STORE_PATH}.`);
}

// Aggiunge post MAI VISTI ai canali indicati. commitField sa solo aggiornare
// post già presenti (cerca per URL e scrive un campo): la scoperta di post
// nuovi — enumerazione dei profili autore, scraping profondo degli hashtag —
// ha bisogno di inserirli, e passa di qui.
//
// Stesso pattern retry-su-409 di commitField, per la stessa ragione: sullo
// store scrivono una decina di workflow e una PUT su una copia stantia
// riporterebbe indietro il file cancellando il lavoro altrui. Lo store fresco
// si rilegge dentro il ciclo, subito prima di scrivere.
//
// `byChannel` è una Map nomeCanale -> array di post. Un post già presente nel
// canale viene saltato: il confronto è sull'URL normalizzato, perché lo stesso
// video arriva con query string diverse (?_r=1&_t=... dagli share link) e un
// confronto letterale creerebbe duplicati.
export async function commitNewPosts({ byChannel, message, normalizeUrl }) {
  const totale = [...byChannel.values()].reduce((n, posts) => n + posts.length, 0);
  if (!totale) return { aggiunti: 0, saltati: 0 };

  const norm = normalizeUrl ?? ((u) => u);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { store, sha } = await readStore();

    let aggiunti = 0;
    let saltati = 0;

    for (const [nomeCanale, posts] of byChannel) {
      const canale = (store.canali || []).find(
        (c) => (c.name || "").toLowerCase() === nomeCanale.toLowerCase(),
      );
      if (!canale) {
        console.error(`  ⚠️  Canale "${nomeCanale}" non trovato: ${posts.length} post saltati.`);
        saltati += posts.length;
        continue;
      }
      canale.accounts = canale.accounts || [];
      const presenti = new Set(canale.accounts.map((a) => norm(a.url || "")));
      for (const post of posts) {
        if (presenti.has(norm(post.url))) {
          saltati++;
          continue;
        }
        canale.accounts.push(post);
        presenti.add(norm(post.url));
        aggiunti++;
      }
    }

    if (!aggiunti) return { aggiunti: 0, saltati };

    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, sha, branch: targetBranch() }),
    });

    if (res.ok) return { aggiunti, saltati };

    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(`  ↻ Conflitto di scrittura (${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`);
      continue;
    }

    throw new Error(`Scrittura ${STORE_PATH} fallita: ${res.status} ${await res.text()}`);
  }

  throw new Error(`Troppi conflitti di scrittura su ${STORE_PATH}.`);
}
