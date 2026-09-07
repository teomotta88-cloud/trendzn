// Test dell'estrazione KPI dalla pagina video TikTok.
//   node --test scripts/lib/
//
// La policy di rete dell'ambiente di sviluppo nega tiktok.com, quindi il
// percorso dei campi non è verificabile dal vivo: qui è coperto su strutture
// che riproducono quelle reali, incluse le forme parziali che una pagina
// tornata a metà può produrre.

import assert from "node:assert/strict";
import test from "node:test";

import { applyEngagement, extractStats, readVideoDetail, toCount } from "./tiktok-engagement.mjs";

// Struttura come quella incorporata nella pagina: stats numerico, statsV2
// stringa, entrambi presenti.
function payload(itemStruct, extra = {}) {
  return {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": { itemInfo: itemStruct ? { itemStruct } : undefined, ...extra },
    },
  };
}

// ------------------------------------------------------------------ toCount

test("toCount accetta i numeri di stats e le stringhe di statsV2", () => {
  assert.equal(toCount(1234), 1234);
  assert.equal(toCount("1234"), 1234);
  assert.equal(toCount(0), 0);
  assert.equal(toCount("0"), 0);
});

test("toCount rifiuta tutto ciò che non è un conteggio esatto", () => {
  // "1.2M" abbreviato: parseInt darebbe 1, cioè un dato falso salvato come buono.
  assert.equal(toCount("1.2M"), null);
  assert.equal(toCount("12k"), null);
  assert.equal(toCount(null), null);
  assert.equal(toCount(undefined), null);
  assert.equal(toCount(""), null);
  assert.equal(toCount(-5), null);
  assert.equal(toCount(1.5), null);
  assert.equal(toCount(Number.NaN), null);
});

// -------------------------------------------------------------- extractStats

test("extractStats legge i quattro contatori", () => {
  const stats = extractStats({
    stats: { playCount: 1000, diggCount: 200, commentCount: 30, shareCount: 4 },
  });
  assert.deepEqual(stats, { views: 1000, likes: 200, comments: 30, shares: 4 });
});

test("statsV2 ha la precedenza su stats", () => {
  const stats = extractStats({
    stats: { playCount: 1000, diggCount: 200, commentCount: 30, shareCount: 4 },
    statsV2: { playCount: "1042", diggCount: "205", commentCount: "31", shareCount: "5" },
  });
  assert.deepEqual(stats, { views: 1042, likes: 205, comments: 31, shares: 5 });
});

test("il fallback su stats è campo per campo, non a blocchi", () => {
  // statsV2 esiste ma è parziale: gli altri tre contatori non vanno persi.
  const stats = extractStats({
    stats: { playCount: 1000, diggCount: 200, commentCount: 30, shareCount: 4 },
    statsV2: { playCount: "1042", diggCount: "", commentCount: null },
  });
  assert.deepEqual(stats, { views: 1042, likes: 200, comments: 30, shares: 4 });
});

test("un contatore mancante ovunque resta null, non 0", () => {
  const stats = extractStats({ stats: { playCount: 1000 } });
  assert.deepEqual(stats, { views: 1000, likes: null, comments: null, shares: null });
});

// ---------------------------------------------------------- readVideoDetail

test("readVideoDetail estrae le metriche da un payload completo", () => {
  const record = readVideoDetail(
    payload({
      desc: "vacanza @ Bluserena",
      stats: { playCount: 5000, diggCount: 300, commentCount: 12, shareCount: 7 },
    }),
  );
  assert.equal(record.status, "ok");
  assert.equal(record.source, "tiktok-page");
  assert.deepEqual(
    { views: record.views, likes: record.likes, comments: record.comments, shares: record.shares },
    { views: 5000, likes: 300, comments: 12, shares: 7 },
  );
});

test("un video rimosso o privato è not_found, non un errore della pipeline", () => {
  const record = readVideoDetail(payload(null, { statusCode: 10204 }));
  assert.equal(record.status, "not_found");
  assert.match(record.reason, /10204/);
});

test("itemStruct assente senza statusCode è no_data", () => {
  assert.equal(readVideoDetail(payload(null)).status, "no_data");
  assert.equal(readVideoDetail({}).status, "no_data");
  assert.equal(readVideoDetail(null).status, "no_data");
});

test("itemStruct senza contatori è no_stats, non un ok con quattro null", () => {
  const record = readVideoDetail(payload({ desc: "senza stats" }));
  assert.equal(record.status, "no_stats");
});

// --------------------------------------------------------- applyEngagement

test("i campi piatti vuoti vengono riempiti", () => {
  const account = { url: "u", views: null, likes: null, comments: null, shares: null };
  const record = { status: "ok", views: 10, likes: 2, comments: 1, shares: 0 };
  applyEngagement(account, record);
  assert.deepEqual(
    { v: account.views, l: account.likes, c: account.comments, s: account.shares },
    { v: 10, l: 2, c: 1, s: 0 },
  );
  assert.deepEqual(record.applied, ["views", "likes", "comments", "shares"]);
  assert.equal(account.engagementData, record);
});

test("i KPI già presenti da un'altra fonte non vengono sovrascritti", () => {
  // Il caso dei 218 post con i numeri di Apify/ScrapeCreators.
  const account = { url: "u", views: 999, likes: 88, comments: null, shares: null };
  const record = { status: "ok", views: 10, likes: 2, comments: 1, shares: 3 };
  applyEngagement(account, record);
  assert.equal(account.views, 999, "views di un'altra fonte sovrascritte");
  assert.equal(account.likes, 88, "likes di un'altra fonte sovrascritti");
  assert.equal(account.comments, 1, "buco non riempito");
  assert.equal(account.shares, 3, "buco non riempito");
  assert.deepEqual(record.applied, ["comments", "shares"]);
});

test("overwrite=true rinfresca anche i campi già valorizzati", () => {
  const account = { url: "u", views: 999, likes: 88, comments: 5, shares: 1 };
  const record = { status: "ok", views: 10, likes: 2, comments: 1, shares: 3 };
  applyEngagement(account, record, { overwrite: true });
  assert.deepEqual(
    { v: account.views, l: account.likes, c: account.comments, s: account.shares },
    { v: 10, l: 2, c: 1, s: 3 },
  );
});

test("uno zero legittimo riempie un buco: 0 condivisioni è un dato", () => {
  const account = { url: "u", shares: null };
  applyEngagement(account, { status: "ok", views: null, likes: null, comments: null, shares: 0 });
  assert.equal(account.shares, 0);
});

test("un record fallito non tocca i campi piatti ma resta tracciato", () => {
  const account = { url: "u", views: null, likes: 5 };
  const record = { status: "login_wall", reason: "titolo: Log in | TikTok" };
  applyEngagement(account, record);
  assert.equal(account.views, null);
  assert.equal(account.likes, 5);
  assert.equal(account.engagementData, record, "il record c'è comunque: la run dopo non lo rifà");
  assert.equal(record.applied, undefined);
});

test("un contatore null non azzera il campo piatto già presente", () => {
  const account = { url: "u", views: 500 };
  const record = { status: "ok", views: null, likes: 2, comments: null, shares: null };
  applyEngagement(account, record, { overwrite: true });
  assert.equal(account.views, 500, "un null della pagina non deve cancellare un dato buono");
  assert.equal(account.likes, 2);
});
