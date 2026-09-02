// Test degli script di arricchimento Bluserena (OCR + trascrizione audio).
//   node --test scripts/lib/
//
// Coprono le quattro regressioni che avevano tenuto i due workflow fermi:
// binari mancanti mascherati, multipart di Whisper rotto, commit in conflitto,
// e la coppia copertura/idempotenza che faceva rianalizzare sempre gli stessi
// 100 post.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { cleanText, frameTimestamps } from "./ocr-text.mjs";
import { run } from "./bluserena-media.mjs";
import { commitField } from "./bluserena-store.mjs";
import { runEnrichment } from "./bluserena-enrich.mjs";
import { transcribeAudioBuffer } from "./groq-whisper.mjs";

process.env.GITHUB_TOKEN ??= "token-di-test";

// ---------------------------------------------------------------- OCR: testo

test("cleanText deduplica le righe ripetute su più frame", () => {
  const out = cleanText(["Estate 2026", "estate 2026!", "Cala Serena", "ESTATE 2026"]);
  assert.equal(out, "Estate 2026\nCala Serena");
});

test("cleanText scarta il rumore tipico di Tesseract", () => {
  assert.equal(cleanText(["|", "—", "«.»", "a", "S "]), "");
});

test("cleanText tronca al limite di caratteri", () => {
  const out = cleanText(["riga uno molto lunga", "riga due"], { maxChars: 10 });
  assert.equal(out.length, 10);
});

test("frameTimestamps campiona lungo il video senza toccare gli estremi", () => {
  const ts = frameTimestamps(30, 5);
  assert.equal(ts.length, 5);
  assert.ok(ts[0] > 0, "non parte dal frame 0, che era il bug del vecchio -vframes 1");
  assert.ok(ts.at(-1) < 30);
  assert.deepEqual(
    [...ts].sort((a, b) => a - b),
    ts,
  );
});

test("frameTimestamps regge durata sconosciuta o nulla", () => {
  assert.deepEqual(frameTimestamps(null, 5), [0]);
  assert.deepEqual(frameTimestamps(0, 5), [0]);
});

// ------------------------------------------------------- binari mancanti

test("run() segnala il binario mancante invece di mascherarlo", () => {
  const res = run("binario-che-non-esiste-42", ["--version"]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /non installato/);
});

test("run() distingue exit code diverso da zero", () => {
  const res = run("node", ["-e", "process.exit(3)"]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /exit 3/);
});

// --------------------------------------------------- Whisper: multipart

test("la richiesta a Groq spedisce davvero il file audio", async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ body: Buffer.concat(chunks), contentType: req.headers["content-type"] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "  ciao dal villaggio  ", language: "it", duration: 12.34 }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/transcriptions`;

  const audio = Buffer.alloc(50_000, 7);
  const out = await transcribeAudioBuffer(audio, {
    apiKey: "k",
    model: "whisper-large-v3",
    language: "it",
    url,
  });
  server.close();

  const sent = received[0];
  // Il vecchio codice arrivava qui con 17 byte ("[object FormData]").
  assert.ok(sent.body.length > audio.length, `body troppo corto: ${sent.body.length} byte`);
  assert.match(sent.contentType, /^multipart\/form-data; boundary=/);
  const asText = sent.body.toString("latin1");
  assert.match(asText, /name="file"; filename="audio\.mp3"/);
  assert.match(asText, /name="model"[\s\S]*whisper-large-v3/);
  assert.match(asText, /name="language"[\s\S]*it/);

  assert.deepEqual(out, {
    ok: true,
    text: "ciao dal villaggio",
    language: "it",
    durationSec: 12.3,
  });
});

test("un errore di Groq torna come esito, non come eccezione", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end('{"error":{"message":"multipart: NextPart: EOF"}}');
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const out = await transcribeAudioBuffer(Buffer.alloc(10), { apiKey: "k", model: "m", url });
  server.close();

  assert.equal(out.ok, false);
  assert.match(out.reason, /Groq 400/);
});

// ------------------------------------------------ store: commit e conflitti

// Finto GitHub: tiene lo store in memoria, assegna uno sha nuovo a ogni
// scrittura e rifiuta con 409 le PUT che portano uno sha vecchio.
function fakeGitHub(initialStore, { failFirstPuts = 0 } = {}) {
  const state = { store: structuredClone(initialStore), sha: "sha-0", puts: 0, reads: 0 };
  // Il blob è indicizzato per sha, come sull'API vera: così il test verifica
  // che contenuto e sha letti siano sempre coerenti fra loro.
  const blobs = new Map([["sha-0", JSON.stringify(state.store)]]);

  const handler = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";

    if (url.includes("/contents/") && method === "GET") {
      state.reads++;
      return new Response(JSON.stringify({ sha: state.sha }), { status: 200 });
    }
    if (url.includes("/git/blobs/")) {
      const sha = url.split("/git/blobs/")[1];
      if (!blobs.has(sha)) return new Response("not found", { status: 404 });
      return new Response(blobs.get(sha), { status: 200 });
    }
    if (method === "PUT") {
      state.puts++;
      const body = JSON.parse(init.body);
      if (state.puts <= failFirstPuts) {
        // Un altro workflow ha scritto nel frattempo.
        state.sha = `sha-altrui-${state.puts}`;
        blobs.set(state.sha, JSON.stringify(state.store));
        return new Response("conflict", { status: 409 });
      }
      if (body.sha !== state.sha) return new Response("stale sha", { status: 409 });
      state.store = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      state.sha = `sha-${state.puts}`;
      blobs.set(state.sha, JSON.stringify(state.store));
      return new Response("{}", { status: 200 });
    }
    throw new Error(`richiesta non prevista: ${method} ${url}`);
  };

  return { state, handler, blobs };
}

const storeFixture = () => ({
  canali: [
    {
      name: "canale-uno",
      accounts: [
        {
          url: "https://www.tiktok.com/@a/video/1",
          date: "2026-08-01",
          sentiment: "positive",
          topics: ["mare"],
        },
        { url: "https://www.tiktok.com/@a/video/2", date: "2026-08-02" },
        { url: "https://www.tiktok.com/@a/photo/3", date: "2026-08-03" }, // non è un video
        { url: "https://www.tiktok.com/@a/video/4", date: "2024-01-01" }, // fuori intervallo
      ],
    },
    {
      name: "canale-due",
      accounts: [
        { url: "https://www.instagram.com/reel/5", date: "2025-07-15" },
        { url: "https://www.instagram.com/reel/6", date: "2025-08-20" },
      ],
    },
  ],
});

async function withFakeGitHub(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("commitField scrive solo il proprio campo e non tocca il resto", async () => {
  const fake = fakeGitHub(storeFixture());
  await withFakeGitHub(fake, () =>
    commitField({
      field: "ocrData",
      updates: new Map([
        ["https://www.tiktok.com/@a/video/1", { textOnScreen: "ESTATE", status: "ok" }],
      ]),
      message: "test",
    }),
  );

  const post = fake.state.store.canali[0].accounts[0];
  assert.equal(post.ocrData.textOnScreen, "ESTATE");
  assert.equal(post.sentiment, "positive", "il campo di un altro script resta intatto");
  assert.deepEqual(post.topics, ["mare"]);
  assert.equal(fake.state.store.canali[0].accounts[1].ocrData, undefined);
});

test("commitField rilegge e riprova sul 409 invece di perdere la run", async () => {
  const fake = fakeGitHub(storeFixture(), { failFirstPuts: 2 });
  const applied = await withFakeGitHub(fake, () =>
    commitField({
      field: "audioAnalysis",
      updates: new Map([
        ["https://www.instagram.com/reel/5", { transcript: "ciao", status: "ok" }],
      ]),
      message: "test",
    }),
  );

  assert.equal(applied, 1);
  assert.equal(fake.state.puts, 3, "due conflitti e poi il commit riuscito");
  assert.equal(fake.state.store.canali[1].accounts[0].audioAnalysis.transcript, "ciao");
});

test("commitField non sovrascrive le modifiche altrui arrivate nel frattempo", async () => {
  const fake = fakeGitHub(storeFixture());
  // Simula un altro workflow che scrive dopo che noi abbiamo già letto.
  const originalHandler = fake.handler;
  let injected = false;
  const handler = async (input, init) => {
    if (String(input).includes("/contents/") && !injected) {
      injected = true;
      fake.state.store.canali[0].accounts[0].caption = "caption aggiunta da un altro workflow";
      fake.blobs.set(fake.state.sha, JSON.stringify(fake.state.store));
    }
    return originalHandler(input, init);
  };

  await withFakeGitHub({ handler }, () =>
    commitField({
      field: "ocrData",
      updates: new Map([
        ["https://www.tiktok.com/@a/video/2", { textOnScreen: "X", status: "ok" }],
      ]),
      message: "test",
    }),
  );

  assert.equal(
    fake.state.store.canali[0].accounts[0].caption,
    "caption aggiunta da un altro workflow",
  );
});

// ------------------------------------------------ driver: copertura e ripresa

test("runEnrichment copre tutti i canali, non solo il primo", async () => {
  const fake = fakeGitHub(storeFixture());
  const visti = [];

  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "ocrData",
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async (a) => {
        visti.push(a.url);
        return { textOnScreen: "T", status: "ok" };
      },
    }),
  );

  assert.deepEqual(visti, [
    "https://www.tiktok.com/@a/video/1",
    "https://www.tiktok.com/@a/video/2",
    "https://www.instagram.com/reel/5",
    "https://www.instagram.com/reel/6",
  ]);
});

test("un post fallito viene comunque marcato e non si ripresenta", async () => {
  const fake = fakeGitHub(storeFixture());
  const opts = {
    field: "ocrData",
    title: "test",
    commitMessage: (n) => `test ${n}`,
  };

  let prima = 0;
  await withFakeGitHub(fake, () =>
    runEnrichment({
      ...opts,
      processPost: async () => {
        prima++;
        return { textOnScreen: null, status: "download_failed" };
      },
    }),
  );
  assert.equal(prima, 4);
  assert.equal(fake.state.store.canali[0].accounts[0].ocrData.status, "download_failed");
  assert.ok(fake.state.store.canali[0].accounts[0].ocrData.updatedAt);

  // Seconda run: nessun post da rifare. Era esattamente il bug per cui i
  // vecchi script rianalizzavano ogni volta gli stessi 100 post.
  let dopo = 0;
  await withFakeGitHub(fake, () =>
    runEnrichment({
      ...opts,
      processPost: async () => {
        dopo++;
        return { textOnScreen: null, status: "download_failed" };
      },
    }),
  );
  assert.equal(dopo, 0);

  // Con REPROCESS_FAILED si riprovano solo quelli non riusciti.
  process.env.REPROCESS_FAILED = "true";
  let riprovati = 0;
  await withFakeGitHub(fake, () =>
    runEnrichment({
      ...opts,
      processPost: async () => {
        riprovati++;
        return { textOnScreen: "ora sì", status: "ok" };
      },
    }),
  );
  delete process.env.REPROCESS_FAILED;
  assert.equal(riprovati, 4);
});

test("runEnrichment committa a batch e rispetta il limite di post", async () => {
  const fake = fakeGitHub(storeFixture());
  process.env.BATCH_SIZE = "2";
  process.env.MAX_POSTS = "3";

  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "audioAnalysis",
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async () => ({ transcript: "ok", status: "ok" }),
    }),
  );

  delete process.env.BATCH_SIZE;
  delete process.env.MAX_POSTS;

  assert.equal(fake.state.puts, 2, "un commit da 2 post e uno da 1, non un unico commit finale");
  const conTrascrizione = fake.state.store.canali
    .flatMap((c) => c.accounts)
    .filter((a) => a.audioAnalysis).length;
  assert.equal(conTrascrizione, 3);
});

test("un post che esplode non ferma la run", async () => {
  const fake = fakeGitHub(storeFixture());
  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "ocrData",
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async (a) => {
        if (a.url.endsWith("/2")) throw new Error("video corrotto");
        return { textOnScreen: "T", status: "ok" };
      },
    }),
  );

  const posts = fake.state.store.canali.flatMap((c) => c.accounts);
  assert.equal(posts.filter((a) => a.ocrData?.status === "ok").length, 3);
  const rotto = posts.find((a) => a.url.endsWith("/2"));
  assert.equal(rotto.ocrData.status, "error");
  assert.match(rotto.ocrData.error, /video corrotto/);
});
