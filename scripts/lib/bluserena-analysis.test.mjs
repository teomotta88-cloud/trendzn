// Test degli script di arricchimento Bluserena (OCR + trascrizione audio).
//   node --test scripts/lib/
//
// Coprono le quattro regressioni che avevano tenuto i due workflow fermi:
// binari mancanti mascherati, multipart di Whisper rotto, commit in conflitto,
// e la coppia copertura/idempotenza che faceva rianalizzare sempre gli stessi
// 100 post.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanText,
  frameTimestamps,
  letterCount,
  linesFromBlocks,
  wordsFromBlocks,
} from "./ocr-text.mjs";
import { downloadVideo, run, versionArg } from "./bluserena-media.mjs";
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

// ffmpeg e ffprobe escono con errore su `--version`: vogliono `-version`.
// Il preflight li dava per mancanti su runner dove erano installati, e il test
// con un binario inesistente non lo intercettava perché lì fallisce comunque.
test("il preflight interroga ffmpeg con l'opzione che ffmpeg accetta", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-bin-"));
  const stub = path.join(dir, "ffmpeg");
  fs.writeFileSync(
    stub,
    '#!/bin/sh\n[ "$1" = "-version" ] || exit 8\necho "ffmpeg version 6.1.1"\n',
  );
  fs.chmodSync(stub, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    assert.equal(versionArg("ffmpeg"), "-version");
    assert.equal(versionArg("ffprobe"), "-version");
    assert.equal(versionArg("yt-dlp"), "--version");

    assert.equal(run("ffmpeg", ["--version"]).ok, false, "conferma che --version fallisce");
    const res = run("ffmpeg", [versionArg("ffmpeg")]);
    assert.equal(res.ok, true, `il preflight deve passare: ${res.reason ?? ""}`);
    assert.match(res.stdout, /ffmpeg version/);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// I record della vecchia analisi LLM non hanno `status` e hanno transcript
// nullo: contarli come già elaborati li escludeva per sempre (erano 100 post).
test("i record legacy senza status vengono rielaborati", async () => {
  const store = storeFixture();
  store.canali[0].accounts[0].audioAnalysis = {
    transcript: null,
    sentiment: "neutral",
    engagement: 5,
    analyzedAt: "2026-09-02T07:02:01.392Z",
  };
  // Un record del formato nuovo, invece, va saltato.
  store.canali[0].accounts[1].audioAnalysis = { transcript: "già fatto", status: "ok" };

  const fake = fakeGitHub(store);
  const visti = [];
  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "audioAnalysis",
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async (a) => {
        visti.push(a.url);
        return { transcript: "nuovo", status: "ok" };
      },
    }),
  );

  assert.ok(visti.includes("https://www.tiktok.com/@a/video/1"), "il legacy va rifatto");
  assert.ok(
    !visti.includes("https://www.tiktok.com/@a/video/2"),
    "quello con status ok va saltato",
  );
});

// Se il download è rotto per tutti (TikTok che blocca, chiave scaduta), marcare
// i post come tentati li escluderebbe dalle run successive.
test("un guasto sistematico ferma la run senza marcare i post", async () => {
  const fake = fakeGitHub(storeFixture());
  process.env.FAIL_STREAK = "3";

  await assert.rejects(
    withFakeGitHub(fake, () =>
      runEnrichment({
        field: "ocrData",
        title: "test",
        commitMessage: (n) => `test ${n}`,
        processPost: async () => ({ textOnScreen: null, status: "download_failed", reason: "403" }),
      }),
    ),
    /fallimenti consecutivi/,
  );
  delete process.env.FAIL_STREAK;

  assert.equal(fake.state.puts, 0, "nessun commit");
  const marcati = fake.state.store.canali.flatMap((c) => c.accounts).filter((a) => a.ocrData);
  assert.equal(marcati.length, 0, "nessun post marcato: la prossima run li rivede");
});

test("no_text è un esito legittimo e non fa scattare il circuit breaker", async () => {
  const fake = fakeGitHub(storeFixture());
  process.env.FAIL_STREAK = "2";

  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "ocrData",
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async () => ({ textOnScreen: null, status: "no_text" }),
    }),
  );
  delete process.env.FAIL_STREAK;

  assert.equal(
    fake.state.store.canali.flatMap((c) => c.accounts).filter((a) => a.ocrData).length,
    4,
  );
});

test("il motivo del fallimento di yt-dlp riporta il messaggio dell'estrattore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-bin-"));
  const stub = path.join(dir, "yt-dlp");
  fs.writeFileSync(
    stub,
    '#!/bin/sh\necho "ERROR: [TikTok] 123: Unable to extract video data" >&2\nexit 1\n',
  );
  fs.chmodSync(stub, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    const res = downloadVideo("https://www.tiktok.com/@x/video/123", path.join(dir, "out.mp4"));
    assert.equal(res.ok, false);
    // "yt-dlp exit 1" da solo non basta a capire cosa è successo.
    assert.match(res.reason, /Unable to extract video data/);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Su ~1500 video il rate limit di Groq è una certezza: senza retry ogni 429
// marcherebbe il post come fallito e andrebbe ripescato a mano.
test("una richiesta a Groq riprova sul 429 e poi riesce", async () => {
  let chiamate = 0;
  const server = http.createServer((req, res) => {
    chiamate++;
    req.resume();
    req.on("end", () => {
      if (chiamate < 3) {
        res.writeHead(429, { "Retry-After": "0", "Content-Type": "application/json" });
        res.end('{"error":{"message":"rate limit"}}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "ce l'ha fatta", language: "it", duration: 3 }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const out = await transcribeAudioBuffer(Buffer.alloc(100), {
    apiKey: "k",
    model: "m",
    url,
    retryBaseMs: 1,
  });
  server.close();

  assert.equal(chiamate, 3, "due 429 e poi il successo");
  assert.equal(out.ok, true);
  assert.equal(out.text, "ce l'ha fatta");
});

test("un 429 che non passa viene distinto dagli altri errori", async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(429, { "Retry-After": "0" });
      res.end('{"error":{"message":"quota esaurita"}}');
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const out = await transcribeAudioBuffer(Buffer.alloc(10), {
    apiKey: "k",
    model: "m",
    url,
    attempts: 2,
    retryBaseMs: 1,
  });
  server.close();

  assert.equal(out.ok, false);
  assert.equal(out.rateLimited, true, "il chiamante deve poterlo distinguere");
  assert.match(out.reason, /429/);
});

test("Retry-After viene rispettato invece del backoff", async () => {
  let chiamate = 0;
  const server = http.createServer((req, res) => {
    chiamate++;
    req.resume();
    req.on("end", () => {
      if (chiamate === 1) {
        res.writeHead(429, { "Retry-After": "0.3" });
        res.end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "ok", language: "it" }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const inizio = Date.now();
  // baseMs enorme: se il backoff prevalesse su Retry-After, il test durerebbe minuti.
  await transcribeAudioBuffer(Buffer.alloc(10), {
    apiKey: "k",
    model: "m",
    url,
    retryBaseMs: 600_000,
  });
  const durata = Date.now() - inizio;
  server.close();

  assert.ok(durata >= 250, `ha aspettato davvero: ${durata}ms`);
  assert.ok(durata < 5000, `ha usato Retry-After, non il backoff: ${durata}ms`);
});

// Quando l'algoritmo migliora i record vecchi devono rifarsi da soli: senza
// questo, la spazzatura salvata con status "ok" resterebbe bloccata, perché
// REPROCESS_FAILED per definizione non tocca gli "ok".
test("alzare la versione dell'estrattore rimette in coda i record vecchi", async () => {
  const store = storeFixture();
  store.canali[0].accounts[0].ocrData = { textOnScreen: "vecchio", status: "ok", version: 1 };
  store.canali[0].accounts[1].ocrData = { textOnScreen: "nuovo", status: "ok", version: 2 };

  const fake = fakeGitHub(store);
  const visti = [];
  await withFakeGitHub(fake, () =>
    runEnrichment({
      field: "ocrData",
      version: 2,
      title: "test",
      commitMessage: (n) => `test ${n}`,
      processPost: async (a) => {
        visti.push(a.url);
        return { textOnScreen: "rifatto", status: "ok" };
      },
    }),
  );

  assert.ok(visti.includes("https://www.tiktok.com/@a/video/1"), "versione 1 va rifatta");
  assert.ok(!visti.includes("https://www.tiktok.com/@a/video/2"), "versione 2 è aggiornata");
  assert.equal(
    fake.state.store.canali[0].accounts[0].ocrData.version,
    2,
    "la versione viene timbrata",
  );
});

// Il freno deve valere a ogni punto della run: su 1500 post la quota Groq si
// esaurisce a metà, non in apertura.
test("il freno scatta anche dopo dei successi, salvando il lavoro buono", async () => {
  const fake = fakeGitHub(storeFixture());
  process.env.FAIL_STREAK = "2";
  process.env.BATCH_SIZE = "50";

  await assert.rejects(
    withFakeGitHub(fake, () =>
      runEnrichment({
        field: "audioAnalysis",
        title: "test",
        commitMessage: (n) => `test ${n}`,
        processPost: async (a) =>
          a.url.endsWith("/1")
            ? { transcript: "buona", status: "ok" }
            : { transcript: null, status: "rate_limited", reason: "Groq 429" },
      }),
    ),
    /fallimenti consecutivi/,
  );
  delete process.env.FAIL_STREAK;
  delete process.env.BATCH_SIZE;

  const posts = fake.state.store.canali.flatMap((c) => c.accounts);
  const salvato = posts.find((a) => a.url.endsWith("/1"));
  assert.equal(salvato.audioAnalysis.transcript, "buona", "il post riuscito non si perde");
  assert.equal(
    posts.filter((a) => a.audioAnalysis?.status === "rate_limited").length,
    0,
    "i post della serie restano da rifare, non marcati",
  );
});

// Struttura blocks->paragraphs->lines->words come la restituisce Tesseract,
// modellata sui dati veri della run #18: una riga di testo reale letta bene e
// due righe di rumore lette malissimo, che oggi finiscono nello store insieme.
const blocksFixture = () => [
  {
    paragraphs: [
      {
        lines: [
          {
            words: [
              { text: "Ciao", confidence: 91.2, in_dictionary: true, language: "ita" },
              { text: "Bluserena", confidence: 78.4, in_dictionary: false, language: "ita" },
            ],
          },
          {
            words: [
              { text: "£5", confidence: 11.7, in_dictionary: false, language: "eng" },
              { text: "4", confidence: 8.3, in_dictionary: false, language: "eng" },
            ],
          },
          {
            words: [
              { text: "Wy", confidence: 21.0, in_dictionary: false, language: "eng" },
              { text: "UR", confidence: 14.5, in_dictionary: false, language: "eng" },
              { text: "ARI", confidence: 19.9, in_dictionary: false, language: "eng" },
            ],
          },
        ],
      },
    ],
  },
];

test("wordsFromBlocks recupera confidenza e dizionario per ogni parola", () => {
  const parole = wordsFromBlocks(blocksFixture());
  assert.equal(parole.length, 7);
  assert.deepEqual(parole[0], {
    text: "Ciao",
    confidence: 91.2,
    inDictionary: true,
    language: "ita",
  });
});

test("wordsFromBlocks regge blocks assenti o vuoti", () => {
  assert.deepEqual(wordsFromBlocks(null), []);
  assert.deepEqual(wordsFromBlocks([{ paragraphs: [{ lines: [{ words: [] }] }] }]), []);
});

// È il comportamento su cui si sceglie la soglia: sotto una certa confidenza
// le righe di rumore spariscono del tutto, il testo vero resta.
test("linesFromBlocks elimina le righe di rumore alzando la soglia", () => {
  const blocks = blocksFixture();
  assert.equal(linesFromBlocks(blocks, { minConfidence: 0 }).length, 3, "senza soglia passa tutto");
  assert.deepEqual(linesFromBlocks(blocks, { minConfidence: 60 }), ["Ciao Bluserena"]);
  assert.deepEqual(linesFromBlocks(blocks, { minConfidence: 95 }), [], "soglia assurda: niente");
});

test("linesFromBlocks tiene la riga anche se solo una parola supera la soglia", () => {
  assert.deepEqual(linesFromBlocks(blocksFixture(), { minConfidence: 85 }), ["Ciao"]);
});

// in_dictionary da solo non basta: "Bluserena" è testo vero ma nessun
// dizionario lo contiene. Va usato come segnale di supporto, non come filtro.
test("il solo in_dictionary scarterebbe i nomi propri", () => {
  assert.deepEqual(linesFromBlocks(blocksFixture(), { requireDictionary: true }), ["Ciao"]);
});

test("soglia e cleanText insieme producono il testo finale", () => {
  const testo = cleanText(linesFromBlocks(blocksFixture(), { minConfidence: 60 }));
  assert.equal(testo, "Ciao Bluserena");
});

// Il caso che ha smentito il piano iniziale. Nella calibrazione del 02/09 le
// parole lette MEGLIO erano |(97) i(95) |(94) Ciao(93) @(93) /(93) 7(93):
// Tesseract è giustamente sicurissimo che un tratto verticale sia una "|",
// quindi la sola confidenza promuove il rumore invece di scartarlo.
const blocksAltaConfidenzaMaRumore = () => [
  {
    paragraphs: [
      {
        lines: [
          {
            words: [
              { text: "|", confidence: 97.0, in_dictionary: false },
              { text: "i", confidence: 95.1, in_dictionary: true },
              { text: "7", confidence: 93.0, in_dictionary: false },
            ],
          },
          {
            words: [
              { text: "Ciao", confidence: 93.4, in_dictionary: true },
              { text: "Bluserena", confidence: 84.2, in_dictionary: false },
            ],
          },
        ],
      },
    ],
  },
];

test("letterCount conta le lettere, non i caratteri", () => {
  assert.equal(letterCount("£5"), 0);
  assert.equal(letterCount("|"), 0);
  assert.equal(letterCount("Ciao"), 4);
  assert.equal(letterCount("@bluserena"), 9);
  assert.equal(letterCount("érena"), 5);
});

test("la sola confidenza non basta: il rumore letto benissimo passerebbe", () => {
  // "|" cade perché è sola punteggiatura, ma "i" e "7" restano: sono letti a
  // 95 e 93, cioè meglio di "Bluserena".
  const soloConfidenza = linesFromBlocks(blocksAltaConfidenzaMaRumore(), { minConfidence: 60 });
  assert.deepEqual(soloConfidenza, ["i 7", "Ciao Bluserena"], "il rumore sopravvive");
});

test("confidenza e lunghezza insieme tengono il testo e scartano il rumore", () => {
  const combinata = linesFromBlocks(blocksAltaConfidenzaMaRumore(), {
    minConfidence: 60,
    minLineLetters: 4,
  });
  assert.deepEqual(combinata, ["Ciao Bluserena"]);
});

// L'altra metà: "bluserena" nel campione è stato letto a confidenza 0, cioè
// rumore visivo che assomiglia a una parola. La sola forma lo lascerebbe
// passare.
test("le sole lettere non bastano: il rumore che sembra una parola passerebbe", () => {
  const blocks = [
    {
      paragraphs: [
        { lines: [{ words: [{ text: "bluserena", confidence: 0, in_dictionary: false }] }] },
      ],
    },
  ];
  assert.deepEqual(
    linesFromBlocks(blocks, { minLetters: 3 }),
    ["bluserena"],
    "la forma da sola passa",
  );
  assert.deepEqual(linesFromBlocks(blocks, { minConfidence: 60, minLetters: 3 }), []);
});

test("un post senza testo a video resta vuoto e diventa no_text", () => {
  // Righe del post 1 della calibrazione, che a video non ha nessun testo.
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: "iid", confidence: 42 },
                { text: ":", confidence: 30 },
              ],
            },
            {
              words: [
                { text: "A", confidence: 55 },
                { text: "g", confidence: 48 },
              ],
            },
            {
              words: [
                { text: "£5", confidence: 44 },
                { text: "4", confidence: 51 },
              ],
            },
          ],
        },
      ],
    },
  ];
  const testo = cleanText(linesFromBlocks(blocks, { minConfidence: 60, minLineLetters: 4 }));
  assert.equal(testo, "", "niente testo: lo script scriverà status no_text");
});

// La regressione trovata dalla calibrazione su 15 post: applicare la lunghezza
// minima PAROLA PER PAROLA cancella articoli e preposizioni, e sulle frasi
// vere fa più danni del rumore che dovrebbe togliere. Riga reale dal campione.
const blocksFraseVera = () => [
  {
    paragraphs: [
      {
        lines: [
          {
            words: [
              { text: "Rispondi", confidence: 88 },
              { text: "al", confidence: 82 },
              { text: "commento", confidence: 90 },
              { text: "di", confidence: 85 },
              { text: "giù81", confidence: 71 },
            ],
          },
          // Riga di puro rumore dallo stesso campione: nessuna parola lunga.
          {
            words: [
              { text: "ù", confidence: 74 },
              { text: "3", confidence: 68 },
              { text: "i", confidence: 91 },
            ],
          },
        ],
      },
    ],
  },
];

test("una frase vera resta intera, articoli e preposizioni compresi", () => {
  const righe = linesFromBlocks(blocksFraseVera(), { minConfidence: 60, minLineLetters: 4 });
  assert.deepEqual(righe, ["Rispondi al commento di giù81"]);
});

test("la riga di rumore accanto alla frase sparisce lo stesso", () => {
  const righe = linesFromBlocks(blocksFraseVera(), { minConfidence: 60, minLineLetters: 4 });
  assert.equal(righe.length, 1, "solo la frase, non il sacchetto di token corti");
});

test("i token di sola punteggiatura non entrano nel testo", () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: "=", confidence: 95 },
                { text: "È", confidence: 88 },
                { text: "bluserena", confidence: 76 },
              ],
            },
          ],
        },
      ],
    },
  ];
  assert.deepEqual(linesFromBlocks(blocks, { minConfidence: 60, minLineLetters: 4 }), [
    "È bluserena",
  ]);
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
