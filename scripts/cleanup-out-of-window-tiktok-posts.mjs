// Script una tantum: rimuove dallo store i post TikTok fuori dalla finestra
// lug-ago 2025/2026 (WINDOWS in lib/bluserena-discovery.mjs), entrati per un
// bug in backfill-tiktok-hashtag.mjs — quello script filtrava per finestra
// solo il contatore usato per decidere quando fermarsi, non l'inserimento
// vero: qualunque post nuovo trovato (dentro o fuori finestra) veniva
// comunque scritto nello store.
//
// Emerso il 9/09/2026: finché la paginazione via cursore era rotta (rifaceva
// sempre la stessa prima pagina) e la ricerca era per hashtag, lo script
// trovava quasi sempre "già visto" e il bug non aveva mai avuto modo di
// inserire granché. Corrette paginazione e ricerca per keyword (PR
// #334-#336), il backfill ha iniziato a trovare contenuto davvero nuovo — e
// quel contenuto, per come TikTok ordina i risultati, è perlopiù recente
// (settembre), non lug-ago.
//
// Verificato prima di scrivere questo script: nessuno dei post fuori
// finestra ha ancora audio/OCR/sentiment/engagement agganciati, quindi la
// rimozione non lascia scarti in altri campi. Verificato anche che nessuno
// di questi post provenga dallo scraping quotidiano (sync-bluserena-
// hashtags.mjs, che non ha — e non deve avere — un filtro di finestra: è il
// monitoraggio continuo, non il backfill per il confronto YoY).
//
// Il bug di origine NON è ancora corretto in backfill-tiktok-hashtag.mjs:
// questa pulizia va rilanciata se il backfill gira di nuovo prima che sia
// sistemato.
//
// Uso: node scripts/cleanup-out-of-window-tiktok-posts.mjs
// Richiede GITHUB_TOKEN nell'ambiente. Processa TUTTI i canali dello store,
// solo i post platform "tiktok", scrive solo se trova davvero post fuori
// finestra. Un post TikTok senza data non viene toccato: senza data non si
// può giudicare se sia dentro o fuori, meglio tenerlo che perderlo per un
// campo mancante.

import { inWindow } from "./lib/bluserena-discovery.mjs";
import { readStore, REPO, STORE_PATH } from "./lib/bluserena-store.mjs";

const MAX_ATTEMPTS = 5;

function token() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    console.error("Manca GITHUB_TOKEN nell'ambiente.");
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

function targetBranch() {
  return process.env.GITHUB_REF_NAME || "main";
}

function removeOutOfWindow(store) {
  let totalRemoved = 0;
  const removedByChannel = [];
  for (const canale of store.canali || []) {
    const before = (canale.accounts || []).length;
    canale.accounts = (canale.accounts || []).filter((a) => {
      if (a.platform !== "tiktok") return true;
      if (!a.date) return true;
      return inWindow(a.date);
    });
    const removed = before - canale.accounts.length;
    if (removed > 0) {
      totalRemoved += removed;
      removedByChannel.push({ canale: canale.name, removed });
    }
  }
  return { totalRemoved, removedByChannel };
}

// Rilegge lo store fresco a ogni tentativo (stesso motivo di
// commitNewPosts/commitField in lib/bluserena-store.mjs: altri workflow
// possono scrivere sullo stesso file nel frattempo) e ricalcola la
// rimozione sulla copia fresca invece di riusare un risultato precedente.
async function writeStore() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { store, sha } = await readStore();
    const result = removeOutOfWindow(store);
    if (result.totalRemoved === 0) return result;

    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: rimuovi ${result.totalRemoved} post TikTok fuori finestra [trendzn-bot]`,
        content,
        sha,
        branch: targetBranch(),
      }),
    });

    if (res.ok) return result;
    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`,
      );
      continue;
    }
    throw new Error(`Scrittura ${STORE_PATH} fallita: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Troppi conflitti di scrittura su ${STORE_PATH}.`);
}

// --- Main ---
console.log("=== Pulizia post TikTok fuori finestra lug-ago ===\n");

const result = await writeStore();

if (result.totalRemoved === 0) {
  console.log("Nessun post fuori finestra trovato, store non modificato.");
  process.exit(0);
}

for (const r of result.removedByChannel) {
  console.log(`Canale "${r.canale}": ${r.removed} post fuori finestra rimossi.`);
}
console.log(`\nTotale post rimossi: ${result.totalRemoved}. Store aggiornato su GitHub.`);
