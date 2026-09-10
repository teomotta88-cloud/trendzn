// Test della logica di scoperta dei post mancanti.
//   node --test scripts/lib/
//
// tiktok.com non è raggiungibile dall'ambiente di sviluppo, quindi tutto ciò
// che si può verificare senza run reale è coperto qui: filtro finestra,
// normalizzazione URL (il caso che ha creato duplicati in passato), data
// dedotta dall'ID, e la scelta del canale.

import assert from "node:assert/strict";
import test from "node:test";

import {
  channelsForPost,
  dateFromVideoId,
  inWindow,
  knownUrls,
  manualPostsToConfirm,
  normalizePostUrl,
  nuovoPost,
  tiktokHandle,
  tiktokVideoId,
} from "./bluserena-discovery.mjs";

const CANALI = ["bluserena", "GranserenaHotel", "EthraReserve"];

// ------------------------------------------------------------ normalizeUrl

test("URL dello stesso video in forme diverse normalizzano uguale", () => {
  // Il caso reale: lo share link porta ?_r=1&_t=..., la pagina hashtag ?lang=it.
  const a = "https://www.tiktok.com/@maraalbergo/video/7675653655655140640?_r=1&_t=ZN-990rdWb5qr8";
  const b = "https://www.tiktok.com/@maraalbergo/video/7675653655655140640";
  const c = "https://www.tiktok.com/@maraalbergo/video/7675653655655140640/";
  assert.equal(normalizePostUrl(a), normalizePostUrl(b));
  assert.equal(normalizePostUrl(b), normalizePostUrl(c));
});

test("video diversi non collassano sullo stesso URL normalizzato", () => {
  assert.notEqual(
    normalizePostUrl("https://www.tiktok.com/@x/video/111"),
    normalizePostUrl("https://www.tiktok.com/@x/video/222"),
  );
});

test("un URL malformato non fa esplodere la normalizzazione", () => {
  assert.equal(normalizePostUrl("non-un-url?a=1"), "non-un-url");
  assert.equal(normalizePostUrl(null), "");
});

// ------------------------------------------------------------------- parsing

test("id e handle si estraggono da video e photo", () => {
  assert.equal(tiktokVideoId("https://www.tiktok.com/@a/video/123"), "123");
  assert.equal(tiktokVideoId("https://www.tiktok.com/@a/photo/456"), "456");
  assert.equal(tiktokVideoId("https://www.tiktok.com/@a"), null);
  assert.equal(tiktokHandle("https://www.tiktok.com/@mara.albergo/video/1"), "mara.albergo");
});

// -------------------------------------------------------- data dall'ID video

test("la data si deduce dall'ID senza aprire la pagina", () => {
  // ID reale del post mancante: 19/08/2026.
  assert.equal(dateFromVideoId("7675653655655140640").slice(0, 10), "2026-08-19");
});

test("un ID non plausibile dà null invece di una data inventata", () => {
  assert.equal(dateFromVideoId("1"), null); // prima di TikTok
  assert.equal(dateFromVideoId("abc"), null);
  assert.equal(dateFromVideoId(""), null);
  assert.equal(dateFromVideoId(null), null);
});

// ---------------------------------------------------------------- finestra

test("la finestra copre lug-ago 2025 e 2026, estremi inclusi", () => {
  assert.equal(inWindow("2025-07-01T00:00:00Z"), true);
  assert.equal(inWindow("2025-08-31T23:59:59Z"), true);
  assert.equal(inWindow("2026-07-01"), true);
  assert.equal(inWindow("2026-08-31"), true);
});

test("fuori finestra resta fuori", () => {
  assert.equal(inWindow("2025-06-30"), false);
  assert.equal(inWindow("2025-09-01"), false);
  assert.equal(inWindow("2026-09-01"), false);
  assert.equal(inWindow(null), false);
});

// ------------------------------------------------------------------- store

const store = {
  canali: [
    {
      name: "bluserena",
      accounts: [
        { url: "https://www.tiktok.com/@maraalbergo/video/111" },
        { url: "https://www.tiktok.com/@altro/video/222?lang=it" },
      ],
    },
    {
      name: "GranserenaHotel",
      accounts: [{ url: "https://www.tiktok.com/@maraalbergo/video/333" }],
    },
  ],
};

test("knownUrls riconosce un post già presente anche con query string diversa", () => {
  const noti = knownUrls(store);
  assert.equal(noti.has(normalizePostUrl("https://www.tiktok.com/@altro/video/222?_t=XYZ")), true);
  assert.equal(noti.has(normalizePostUrl("https://www.tiktok.com/@altro/video/999")), false);
});

// --------------------------------------------------- manualPostsToConfirm

test("un post aggiunto a mano si conferma quando una fonte lo ripesca da sola", () => {
  const conManuale = {
    canali: [
      {
        name: "bluserena",
        accounts: [
          {
            url: "https://www.tiktok.com/@mara/video/999",
            manualAdd: { addedAt: "2026-09-10T00:00:00.000Z", reason: null, confirmedAt: null },
          },
        ],
      },
    ],
  };
  const visti = new Set([normalizePostUrl("https://www.tiktok.com/@mara/video/999?_t=abc")]);
  const updates = manualPostsToConfirm(conManuale, visti);
  assert.equal(updates.size, 1);
  const nuovo = updates.get("https://www.tiktok.com/@mara/video/999");
  assert.equal(nuovo.confirmedAt !== null, true, "confirmedAt si valorizza");
  assert.equal(nuovo.addedAt, "2026-09-10T00:00:00.000Z", "addedAt non si perde");
});

test("nessun aggiornamento se il post a mano non è tra quelli visti", () => {
  const conManuale = {
    canali: [
      {
        name: "bluserena",
        accounts: [
          {
            url: "https://www.tiktok.com/@mara/video/999",
            manualAdd: { addedAt: "2026-09-10T00:00:00.000Z", reason: null, confirmedAt: null },
          },
        ],
      },
    ],
  };
  const updates = manualPostsToConfirm(conManuale, new Set());
  assert.equal(updates.size, 0);
});

test("un post già confermato non si aggiorna una seconda volta", () => {
  const giaConfermato = {
    canali: [
      {
        name: "bluserena",
        accounts: [
          {
            url: "https://www.tiktok.com/@mara/video/999",
            manualAdd: {
              addedAt: "2026-09-10T00:00:00.000Z",
              reason: null,
              confirmedAt: "2026-09-11T00:00:00.000Z",
            },
          },
        ],
      },
    ],
  };
  const visti = new Set([normalizePostUrl("https://www.tiktok.com/@mara/video/999")]);
  const updates = manualPostsToConfirm(giaConfermato, visti);
  assert.equal(updates.size, 0);
});

test("un post senza manualAdd non entra mai negli aggiornamenti", () => {
  const visti = new Set([normalizePostUrl("https://www.tiktok.com/@maraalbergo/video/111")]);
  const updates = manualPostsToConfirm(store, visti);
  assert.equal(updates.size, 0);
});

// ------------------------------------------------------------------ canali

test("il canale si sceglie dagli hashtag in caption", () => {
  const c = channelsForPost({
    caption: "che vacanza #bluserena #granserenahotel",
    canaliNoti: ["EthraReserve"],
    nomiCanali: CANALI,
  });
  assert.deepEqual(c.sort(), ["GranserenaHotel", "bluserena"]);
});

test("senza hashtag in caption si ripiega sui canali dell'autore", () => {
  // Un post con caption "Risposta a @tizio" non nomina nessun hashtag: non va
  // perso, va messo dove l'autore compare già.
  const c = channelsForPost({
    caption: "Risposta a @tizio",
    canaliNoti: ["bluserena"],
    nomiCanali: CANALI,
  });
  assert.deepEqual(c, ["bluserena"]);
});

test("caption vuota e autore senza canali: nessuna destinazione, non un canale a caso", () => {
  assert.deepEqual(channelsForPost({ caption: null, canaliNoti: [], nomiCanali: CANALI }), []);
});

// -------------------------------------------------------------- nuovo post

test("un post scoperto nasce unconfirmed e senza metriche inventate", () => {
  const p = nuovoPost({
    url: "https://www.tiktok.com/@mara/video/7675653655655140640",
    date: "2026-08-19T08:16:21.000Z",
    caption: "#bluserena",
  });
  assert.equal(p.verificationStatus, "unconfirmed", "la verifica la decide bulk-verify");
  assert.equal(p.handle, "mara");
  assert.equal(p.platform, "tiktok");
  assert.equal(p.views, null);
  assert.equal(p.likes, null);
  assert.equal(p.sentiment, undefined, "il sentiment lo scrive il suo script, non la scoperta");
});

// ------------------------------------------------- scrittura di post nuovi

import { commitNewPosts } from "./bluserena-store.mjs";

process.env.GITHUB_TOKEN ??= "token-di-test";

// Finto GitHub: tiene lo store in memoria e registra le PUT. `conflitti` fa
// rispondere 409 le prime N volte, per verificare che il retry rilegga invece
// di sovrascrivere.
function fintoGithub(storeIniziale, { conflitti = 0 } = {}) {
  const stato = { store: structuredClone(storeIniziale), put: 0, letture: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/contents/") && (opts.method ?? "GET") === "GET") {
      stato.letture++;
      return new Response(JSON.stringify({ sha: "sha-" + stato.put }));
    }
    if (u.includes("/git/blobs/")) return new Response(JSON.stringify(stato.store));
    if (u.includes("/contents/") && opts.method === "PUT") {
      stato.put++;
      if (stato.put <= conflitti) return new Response("conflitto", { status: 409 });
      stato.store = JSON.parse(Buffer.from(JSON.parse(opts.body).content, "base64").toString());
      return new Response("{}", { status: 200 });
    }
    throw new Error("fetch non stubbata: " + u);
  };
  return stato;
}

const storeBase = {
  canali: [
    { name: "bluserena", accounts: [{ url: "https://www.tiktok.com/@tizio/video/111" }] },
    { name: "GranserenaHotel", accounts: [] },
  ],
};

test("commitNewPosts inserisce i post nel canale giusto", async () => {
  const g = fintoGithub(storeBase);
  const byChannel = new Map([
    ["bluserena", [nuovoPost({ url: "https://www.tiktok.com/@a/video/222", date: "2026-08-19" })]],
    [
      "GranserenaHotel",
      [nuovoPost({ url: "https://www.tiktok.com/@b/video/333", date: "2026-08-20" })],
    ],
  ]);
  const res = await commitNewPosts({ byChannel, message: "x", normalizeUrl: normalizePostUrl });
  assert.equal(res.aggiunti, 2);
  assert.equal(g.store.canali[0].accounts.length, 2);
  assert.equal(g.store.canali[1].accounts.length, 1);
});

test("un post già presente non viene duplicato, nemmeno con query string diversa", async () => {
  const g = fintoGithub(storeBase);
  const byChannel = new Map([
    [
      "bluserena",
      [nuovoPost({ url: "https://www.tiktok.com/@tizio/video/111?_t=ABC", date: "2026-08-19" })],
    ],
  ]);
  const res = await commitNewPosts({ byChannel, message: "x", normalizeUrl: normalizePostUrl });
  assert.equal(res.aggiunti, 0, "non deve aggiungere");
  assert.equal(res.saltati, 1);
  assert.equal(g.put, 0, "senza niente da aggiungere non deve nemmeno scrivere");
  assert.equal(g.store.canali[0].accounts.length, 1);
});

test("un canale inesistente non fa perdere gli altri post", async () => {
  const g = fintoGithub(storeBase);
  const byChannel = new Map([
    [
      "CanaleCheNonEsiste",
      [nuovoPost({ url: "https://www.tiktok.com/@a/video/444", date: "2026-08-19" })],
    ],
    ["bluserena", [nuovoPost({ url: "https://www.tiktok.com/@a/video/555", date: "2026-08-19" })]],
  ]);
  const res = await commitNewPosts({ byChannel, message: "x", normalizeUrl: normalizePostUrl });
  assert.equal(res.aggiunti, 1);
  assert.equal(res.saltati, 1);
  assert.equal(g.store.canali[0].accounts.length, 2);
});

test("su conflitto rilegge lo store fresco e riapplica invece di sovrascrivere", async () => {
  const g = fintoGithub(storeBase, { conflitti: 2 });
  const byChannel = new Map([
    ["bluserena", [nuovoPost({ url: "https://www.tiktok.com/@a/video/666", date: "2026-08-19" })]],
  ]);
  const res = await commitNewPosts({ byChannel, message: "x", normalizeUrl: normalizePostUrl });
  assert.equal(res.aggiunti, 1);
  assert.equal(g.put, 3, "due conflitti e poi la scrittura buona");
  assert.ok(g.letture >= 3, "ogni tentativo rilegge lo store");
});
