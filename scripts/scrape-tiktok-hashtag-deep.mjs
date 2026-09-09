// Scraping profondo delle pagine hashtag TikTok: scorre finché la pagina
// carica, tiene solo i post MAI VISTI e dentro la finestra lug-ago 25-26, e
// ripete l'intero giro 15 minuti dopo il TERMINE del precedente, per
// MAX_PASSATE volte o finché non finisce il budget di tempo — non si ferma
// più da solo alla prima passata senza post nuovi.
//
// Perché più passate. La lista che TikTok mostra su una pagina hashtag è un
// campione, e cambia tra una visita e l'altra: è esattamente il motivo per cui
// @maraalbergo/video/7675653655655140640 non è mai entrato pur avendo
// #bluserena. Giri distanziati pescano campioni diversi, quindi si continua a
// oltranza invece di fermarsi al primo giro vuoto — una passata senza novità
// non garantisce che la successiva sia vuota anche lei, vista la non
// determinismo della lista (decisione dell'utente, 9/09/2026: prima ci si
// fermava al primo 0, ma la sola garanzia di aver visto tutto è continuare a
// cercare). Il workflow che lancia questo script si auto-rilancia da solo
// quando finisce (vedi scrape-tiktok-hashtag-deep.yml), quindi la ricerca
// prosegue run dopo run senza intervento manuale.
//
// Il workflow serve anche da controllo di salute dello scraping: se una
// pagina hashtag smette di restituire link (markup cambiato, login-wall), qui
// si vede subito come "0 video" su tutti gli hashtag, invece di accorgersene
// mesi dopo da un buco nei dati.
//
// Gli hashtag sono i 14 canali già configurati nello store, non una lista
// separata: aggiungerne uno dalla UI lo include qui automaticamente.
//
// NIENTE sessione autenticata qui, di proposito. Provata l'8/09: ogni pagina
// hashtag tornava vuota con "Drag the slider to fit the puzzle" nel testo —
// il captcha anti-automazione di TikTok, non un problema di sessione o di
// cookie/localStorage. Da anonimo lo stesso captcha non compare e si arriva
// comunque a ~58-60 video per hashtag, quindi resta la strada che funziona
// per questo script. Il login (createTikTokContext in lib/tiktok-page.mjs)
// resta usato dagli altri due script (KPI e profili autore), che non hanno
// mostrato lo stesso blocco.
//
// Env:
//   GITHUB_TOKEN: obbligatoria
//   MAX_PASSATE: numero di passate per run (default 18), sempre tutte —
//     niente più stop alla prima senza post nuovi
//   INTERVALLO_MIN: minuti tra il TERMINE di una passata e l'inizio della
//     successiva (default 15)
//   MAX_MINUTES: budget complessivo della run (default 320)
//   MAX_SCROLL: tetto di scroll per pagina (default 40)
//   DELAY_MS: pausa tra un hashtag e l'altro (default 2000)
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
  tiktokVideoId,
} from "./lib/bluserena-discovery.mjs";
import { fetchVideoDetail, REAL_CHROME_UA, scrollAndCollectVideoUrls } from "./lib/tiktok-page.mjs";

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Si fanno sempre tutte le MAX_PASSATE (o finché non finisce il budget di
// tempo), aspettando INTERVALLO_MIN dal TERMINE di ognuna: niente più stop
// alla prima passata senza post nuovi, perché la lista di TikTok non è
// deterministica e un giro vuoto non garantisce che il successivo lo sia
// anche lui.
//
// MAX_PASSATE è una cintura di sicurezza contro il limite di 6 ore per job di
// GitHub: 18 passate × (giro + 15 min) sta comodamente sotto. Il workflow che
// lancia questo script si auto-rilancia quando la run finisce, quindi
// raggiungere il tetto non è un problema: la ricerca continua alla run
// successiva senza bisogno di rilanciarlo a mano.
const MAX_PASSATE = intEnv("MAX_PASSATE", 18) || 18;
const INTERVALLO_MIN = intEnv("INTERVALLO_MIN", 15);
const MAX_MINUTES = intEnv("MAX_MINUTES", 320) || 320;
const MAX_SCROLL = intEnv("MAX_SCROLL", 40) || 40;
const DELAY_MS = intEnv("DELAY_MS", 2000);
const DRY_RUN = process.env.DRY_RUN === "true";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeTag(context, tag) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(tag)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const url = await scrollAndCollectVideoUrls(page, { maxScroll: MAX_SCROLL });
    if (url.length === 0) {
      // Titolo + URL finale + un pezzo di testo pagina: la diagnostica che
      // ha permesso di scoprire il captcha anti-automazione con la sessione
      // autenticata (vedi commento in testa al file). Restano utili anche
      // da anonimo, per lo stesso motivo per cui c'erano già: distinguere
      // un vero "zero video" da un blocco (markup cambiato, login-wall,
      // captcha) invece di scoprirlo mesi dopo da un buco nei dati.
      const titolo = await page.title().catch(() => null);
      const urlFinale = page.url();
      const testo = await page
        .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "")
        .catch(() => "");
      return {
        status: "vuota",
        reason:
          `titolo: ${String(titolo).slice(0, 80)} — url finale: ${urlFinale}` +
          (testo ? ` — testo pagina: "${testo}"` : ""),
        url: [],
      };
    }
    return { status: "ok", url };
  } catch (err) {
    return { status: "errore", reason: String(err?.message ?? err).slice(0, 200), url: [] };
  } finally {
    await page.close().catch(() => {});
  }
}

console.log("Scraping profondo delle pagine hashtag TikTok");
console.log("=============================================\n");

const { store } = await readStore();
const nomiCanali = (store.canali || []).map((c) => c.name);
// `noti` vive per tutta la run e cresce a ogni post aggiunto: è ciò che
// impedisce alla seconda passata di riproporre quello che ha trovato la prima.
const noti = knownUrls(store);

console.log(
  `Hashtag monitorati : ${nomiCanali.length} -> ${nomiCanali.map((n) => "#" + n).join(", ")}`,
);
console.log(`Post già nello store: ${noti.size}`);
console.log(
  `Passate: sempre ${MAX_PASSATE} (nessuno stop automatico), intervallo ${INTERVALLO_MIN} min ` +
    `dal termine della precedente, max ${MAX_SCROLL} scroll\n`,
);

const scadenza = Date.now() + MAX_MINUTES * 60_000;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: REAL_CHROME_UA });
const riepilogo = [];
let totaleAggiunti = 0;

try {
  for (let passata = 1; passata <= MAX_PASSATE; passata++) {
    console.log(`\n===== PASSATA ${passata} (max ${MAX_PASSATE}) =====\n`);
    const pending = new Map();
    let vistiPassata = 0;
    let nuoviPassata = 0;
    const perTag = [];

    for (const tag of nomiCanali) {
      const esito = await scrapeTag(context, tag);
      vistiPassata += esito.url.length;

      if (esito.status !== "ok") {
        console.log(`#${tag}: ${esito.status} — ${esito.reason ?? ""}`);
        perTag.push({ tag, visti: 0, nuovi: 0, status: esito.status });
        await sleep(DELAY_MS);
        continue;
      }

      // Data dall'ID: scarta i fuori finestra senza aprire nessuna pagina.
      const candidati = [];
      for (const url of esito.url) {
        if (noti.has(normalizePostUrl(url))) continue;
        const date = dateFromVideoId(tiktokVideoId(url));
        if (!date || !inWindow(date)) continue;
        candidati.push({ url, date });
      }

      let nuoviTag = 0;
      for (const { url, date } of candidati) {
        const dettaglio = await fetchVideoDetail(context, url);
        const caption = dettaglio.status === "ok" ? dettaglio.caption : null;
        // Il post è stato trovato SU questa pagina hashtag, quindi quel canale
        // è la destinazione garantita; gli altri hashtag in caption lo
        // aggiungono anche altrove.
        const canali = new Set([tag, ...channelsForPost({ caption, canaliNoti: [], nomiCanali })]);

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
        nuoviTag++;
        console.log(`  ✅ ${url} (${date.slice(0, 10)}) -> ${[...canali].join(", ")}`);
      }

      nuoviPassata += nuoviTag;
      console.log(`#${tag}: ${esito.url.length} video visti, ${nuoviTag} nuovi in finestra`);
      perTag.push({ tag, visti: esito.url.length, nuovi: nuoviTag, status: "ok" });
      await sleep(DELAY_MS);
    }

    const daScrivere = [...pending.values()].reduce((n, v) => n + v.length, 0);
    if (daScrivere && !DRY_RUN) {
      const { aggiunti } = await commitNewPosts({
        byChannel: pending,
        message: `chore: ${daScrivere} post Bluserena scoperti dalle pagine hashtag [trendzn-bot]`,
        normalizeUrl: normalizePostUrl,
      });
      totaleAggiunti += aggiunti;
      console.log(`\n💾 Passata ${passata}: salvati ${aggiunti} post.`);
    } else if (daScrivere) {
      console.log(`\n(DRY_RUN) Passata ${passata}: ${daScrivere} post pronti, non li scrivo.`);
    } else {
      console.log(`\nPassata ${passata}: nessun post nuovo.`);
    }

    riepilogo.push({ passata, visti: vistiPassata, nuovi: nuoviPassata, perTag });

    if (nuoviPassata === 0) {
      console.log(
        `\nPassata ${passata} senza post nuovi: continuo comunque (nessuno stop automatico).`,
      );
    }

    if (passata === MAX_PASSATE) {
      console.log(
        `\n⚠️  Raggiunto il tetto di ${MAX_PASSATE} passate: la run finisce qui, il workflow si ` +
          "auto-rilancia per continuare la ricerca.",
      );
      break;
    }

    // L'attesa parte da QUI, cioè dal termine della passata, non dal suo
    // inizio: è ciò che rende l'intervallo davvero di 15 minuti tra un giro e
    // il successivo, indipendentemente da quanto è durato il giro.
    const restanti = (scadenza - Date.now()) / 60_000;
    if (restanti < INTERVALLO_MIN + 5) {
      console.log(
        `\n⏱️  Restano ${Math.max(0, Math.round(restanti))} min di budget, non bastano per ` +
          "un'altra passata: mi fermo qui, il workflow si auto-rilancia per continuare.",
      );
      break;
    }

    console.log(`\n⏳ Attendo ${INTERVALLO_MIN} minuti dal termine di questa passata...`);
    await sleep(INTERVALLO_MIN * 60_000);
  }
} finally {
  await context.close().catch(() => {});
  await browser.close();
}

console.log("\n\n📈 Riepilogo");
for (const r of riepilogo) {
  console.log(`  Passata ${r.passata}: ${r.visti} video visti, ${r.nuovi} nuovi in finestra`);
}
console.log(`  Post aggiunti allo store: ${totaleAggiunti}`);

// Controllo di salute: se nessun hashtag restituisce video, lo scraping è
// rotto (markup cambiato, login-wall) e va detto forte, non lasciato passare
// per "nessun post nuovo" — che è l'esito normale quando invece funziona.
const vistiTotali = riepilogo.reduce((n, r) => n + r.visti, 0);
if (vistiTotali === 0) {
  console.error(
    "\n❌ Nessun video letto da nessuna pagina hashtag: lo scraping non funziona " +
      "(markup cambiato o login-wall), non è che non ci fossero post nuovi.",
  );
  process.exit(1);
}

// Quanto la lista è incompleta: post che il primo giro non aveva visto e il
// secondo sì. È la misura che giustifica le passate multiple.
if (riepilogo.length > 1) {
  const dopoIlPrimo = riepilogo.slice(1).reduce((n, r) => n + r.nuovi, 0);
  console.log(
    `\n  Post trovati SOLO dalle passate successive alla prima: ${dopoIlPrimo}` +
      (dopoIlPrimo > 0
        ? " — la lista hashtag era incompleta, le passate multiple servono."
        : " — il primo giro aveva già saturato."),
  );
}
