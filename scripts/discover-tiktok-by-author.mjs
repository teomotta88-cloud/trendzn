// Scopre i post Bluserena mancanti enumerando i PROFILI degli autori già noti.
//
// Perché. Le liste hashtag di TikTok sono parziali e non deterministiche:
// misurando i post che portano più hashtag monitorati — e che quindi
// dovrebbero comparire in più canali — una singola lista ne perde il 19,5%.
// Il caso che ha aperto l'indagine (@maraalbergo/video/7675653655655140640,
// #bluserena in caption) è sfuggito per 13 giorni a un campionamento ogni 3
// ore. Campionare più spesso non chiude il buco.
//
// Un profilo invece elenca TUTTI i video del suo autore, non un campione:
// per i ~990 autori già presenti nello store la copertura diventa
// deterministica. Resta scoperto un solo caso, gli autori mai visti, che
// nessuna enumerazione può raggiungere e per cui serve una ricerca.
//
// Costo: zero, solo minuti Actions.
//
// Ordine di lavoro, pensato per non sprecare richieste:
//   1. dal profilo si prendono gli URL (una pagina per autore);
//   2. la data si deduce dall'ID del video, senza aprire nulla — così i video
//      fuori finestra si scartano a costo zero, e sono la stragrande maggioranza;
//   3. solo per i candidati rimasti si apre la pagina video, che dà caption e
//      contatori in un colpo solo.
//
// I post trovati nascono "unconfirmed": è bulk-verify a decidere sulla
// caption. Il workflow che segue li manda poi in audio, OCR, verifica e — se
// confermati — sentiment.
//
// Env:
//   GITHUB_TOKEN: obbligatoria
//   MAX_AUTHORS: quanti autori al massimo in questa run (default: tutti)
//   START_INDEX: da quale autore ripartire (default 0), per spezzare su più run
//   MAX_MINUTES: budget di tempo, si ferma da solo (default 300)
//   BATCH_SIZE: ogni quanti post scoperti si committa (default 20)
//   DELAY_MS: pausa tra un profilo e l'altro (default 800)
//   DRY_RUN: fa il lavoro ma non scrive

import { chromium } from "playwright";

import { commitNewPosts, readStore } from "./lib/bluserena-store.mjs";
import {
  channelsForPost,
  dateFromVideoId,
  inWindow,
  knownUrls,
  normalizePostUrl,
  nuovoPost,
  tiktokAuthors,
  tiktokVideoId,
} from "./lib/bluserena-discovery.mjs";
import { createTikTokContext, fetchAuthorVideos, fetchVideoDetail } from "./lib/tiktok-page.mjs";

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const MAX_MINUTES = intEnv("MAX_MINUTES", 300);
const BATCH_SIZE = intEnv("BATCH_SIZE", 20) || 20;
const START_INDEX = intEnv("START_INDEX", 0);
const DELAY_MS = intEnv("DELAY_MS", 800);
const DRY_RUN = process.env.DRY_RUN === "true";
// Un login-wall in serie è un guasto sistematico, non un problema dei singoli
// profili: meglio fermarsi e dirlo che macinare 990 profili a vuoto.
const FAIL_STREAK = intEnv("FAIL_STREAK", 15) || 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Scoperta post mancanti dai profili autore");
console.log("=========================================\n");

const { store } = await readStore();
const noti = knownUrls(store);
const nomiCanali = (store.canali || []).map((c) => c.name);
const autori = [...tiktokAuthors(store).values()].sort((a, b) => a.handle.localeCompare(b.handle));

const maxAuthors = intEnv("MAX_AUTHORS", autori.length) || autori.length;
const coda = autori.slice(START_INDEX, START_INDEX + maxAuthors);

console.log(`Autori TikTok noti      : ${autori.length}`);
console.log(`Post già nello store    : ${noti.size}`);
console.log(`In coda in questa run   : ${coda.length} (da #${START_INDEX})`);
console.log(`Budget                  : ${MAX_MINUTES} min, commit ogni ${BATCH_SIZE} post`);
if (DRY_RUN) console.log("DRY_RUN: nessuna scrittura.");
console.log();

const browser = await chromium.launch({ headless: true });
const context = await createTikTokContext(browser);

const pending = new Map(); // canale -> post[]
const stats = { profili: 0, videoVisti: 0, inFinestra: 0, aggiunti: 0, senzaCanale: 0 };
const esiti = {};
let streak = 0;
let fermatoDa = null;
let committati = 0;

const inPending = () => [...pending.values()].reduce((n, v) => n + v.length, 0);

async function flush() {
  const n = inPending();
  if (!n) return;
  if (DRY_RUN) {
    console.log(`  (DRY_RUN) ${n} post pronti, non li scrivo.\n`);
    pending.clear();
    return;
  }
  const { aggiunti, saltati } = await commitNewPosts({
    byChannel: pending,
    message: `chore: ${n} post Bluserena scoperti dai profili autore [trendzn-bot]`,
    normalizeUrl: normalizePostUrl,
  });
  committati += aggiunti;
  console.log(
    `  💾 Salvati ${aggiunti} post${saltati ? ` (${saltati} già presenti)` : ""} — totale run: ${committati}\n`,
  );
  pending.clear();
}

const scadenza = Date.now() + MAX_MINUTES * 60_000;

try {
  for (const [i, autore] of coda.entries()) {
    if (Date.now() > scadenza) {
      fermatoDa = `budget di ${MAX_MINUTES} minuti (fermo all'autore #${START_INDEX + i})`;
      break;
    }

    stats.profili++;
    const esito = await fetchAuthorVideos(context, autore.handle);
    esiti[esito.status] = (esiti[esito.status] ?? 0) + 1;

    if (esito.status !== "ok") {
      // esito.reason (titolo, URL finale, estratto testo pagina — vedi
      // fetchAuthorVideos in lib/tiktok-page.mjs) va stampato qui, per ogni
      // profilo: prima finiva solo nel messaggio "Ultimo motivo" del freno
      // a FAIL_STREAK falliti di fila, quindi con meno profili in coda di
      // quel tetto (es. un MAX_AUTHORS piccolo per un test rapido) non si
      // vedeva mai, anche se la diagnostica veniva calcolata regolarmente.
      console.log(
        `[${i + 1}/${coda.length}] @${autore.handle} — ${esito.status}` +
          (esito.reason ? ` (${esito.reason})` : ""),
      );
      streak++;
      if (streak >= FAIL_STREAK) {
        console.error(
          `\n❌ ${streak} profili illeggibili di fila: sembra un guasto sistematico ` +
            "(login-wall dagli IP dei runner), non i singoli profili.",
        );
        console.error(`   Ultimo motivo: ${esito.reason ?? esito.status}`);
        break;
      }
      await sleep(DELAY_MS);
      continue;
    }
    streak = 0;
    stats.videoVisti += esito.url.length;

    // Filtro per data PRIMA di aprire qualunque pagina: l'ID del video la
    // contiene già, e la stragrande maggioranza dei video di un profilo sta
    // fuori dalla finestra lug-ago.
    const candidati = [];
    for (const url of esito.url) {
      if (noti.has(normalizePostUrl(url))) continue;
      const date = dateFromVideoId(tiktokVideoId(url));
      if (!date || !inWindow(date)) continue;
      candidati.push({ url, date });
    }
    stats.inFinestra += candidati.length;

    console.log(
      `[${i + 1}/${coda.length}] @${autore.handle} — ${esito.url.length} video, ` +
        `${candidati.length} nuovi in finestra`,
    );

    for (const { url, date } of candidati) {
      const dettaglio = await fetchVideoDetail(context, url);
      const caption = dettaglio.status === "ok" ? dettaglio.caption : null;
      const canali = channelsForPost({
        caption,
        canaliNoti: [...autore.canali],
        nomiCanali,
      });

      if (canali.length === 0) {
        stats.senzaCanale++;
        console.log(`    ⚠️  ${url} — nessun canale a cui associarlo, saltato`);
        continue;
      }

      const post = nuovoPost({
        url,
        date,
        caption,
        views: dettaglio.views ?? null,
        likes: dettaglio.likes ?? null,
        comments: dettaglio.comments ?? null,
        shares: dettaglio.shares ?? null,
      });

      for (const canale of canali) {
        if (!pending.has(canale)) pending.set(canale, []);
        pending.get(canale).push({ ...post });
      }
      noti.add(normalizePostUrl(url));
      stats.aggiunti++;
      console.log(`    ✅ ${url} (${date.slice(0, 10)}) -> ${canali.join(", ")}`);
    }

    if (inPending() >= BATCH_SIZE) await flush();
    await sleep(DELAY_MS);
  }

  await flush();
} finally {
  await context.close().catch(() => {});
  await browser.close();
}

console.log("\n📈 Riepilogo");
console.log(`  Profili visitati        : ${stats.profili}`);
console.log(`  Video elencati          : ${stats.videoVisti}`);
console.log(`  Nuovi in finestra       : ${stats.inFinestra}`);
console.log(`  Post aggiunti allo store: ${committati}`);
if (stats.senzaCanale) console.log(`  Senza canale (saltati)  : ${stats.senzaCanale}`);
console.log(`  Esiti profilo           : ${JSON.stringify(esiti)}`);
if (fermatoDa) console.log(`  Fermato dal ${fermatoDa}`);
