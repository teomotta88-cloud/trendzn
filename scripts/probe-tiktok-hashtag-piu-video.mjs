// Sonda diagnostica: come superare il tetto di ~60 video per hashtag a passata?
//
// IL PROBLEMA. Lo scraping profondo (scrape-tiktok-hashtag-deep.mjs) legge in
// media ~60 video per hashtag a passata. Con quel ritmo, avere ragionevole
// certezza di aver recuperato la gran parte dei post richiederebbe settimane
// di passate. Serve arrivare ad almeno 200 per hashtag a passata.
//
// PRIMO GIRO (9/09/2026, un solo hashtag #bluserena, GIRI_SENZA_NOVITA=8):
// la sola pagina hashtag (DOM+XHR) ha reso 134 video unici, più del doppio
// del ~60 storico, fermandosi su un hasMore=false dichiarato da TikTok — non
// un nostro stop prematuro. Le tre strategie supplementari sono risultate
// tutte morte: C (count riscritto via page.route) rompe la firma della
// richiesta (risposta non-JSON); D (ricerca video) ed E (ricerca generale)
// sbattono su un muro di login per sessione anonima ("Log in | TikTok"),
// zero risultati. Conclusione del primo giro: l'ipotesi "sommare più viste
// diverse" non regge sui dati — l'unica vista che rende qualcosa è la
// pagina hashtag stessa, e il tetto sembrava in realtà un artefatto del
// nostro GIRI_SENZA_NOVITA=3 di produzione (troppo impaziente rispetto al
// lazy-load di TikTok), non un vero limite lato server.
//
// SECONDO GIRO (questo): verifica se il tetto vero sta più in alto di 134
// alzando ulteriormente la pazienza dello scroll, e se 134 è tipico o un
// caso fortunato, ripetendo la sola strategia A/B (le uniche vive) su più
// hashtag invece di uno solo. C/D/E restano nel codice ma sono SALTATE di
// default (SOLO_HASHTAG=true): sono morte per come TikTok le serve da
// anonimo, ripeterle ogni giro spreca solo tempo di run.
//
// Uso:
//   node scripts/probe-tiktok-hashtag-piu-video.mjs [hashtag1,hashtag2,...]
// Variabili d'ambiente:
//   GIRI_SENZA_NOVITA  giri di scroll senza novità prima di fermarsi (def. 8)
//   MAX_SCROLL         tetto massimo di giri di scroll (def. 60)
//   ATTESA_MS          pausa tra un giro di scroll e il successivo (def. 2500)
//   SOLO_HASHTAG       "false" per rieseguire anche C/D/E (def. true)
//   COUNT_RISCRITTO    solo se SOLO_HASHTAG=false, vedi strategia C (def. 50)
//
// Gratis: solo Playwright anonimo, nessun credito, nessuna scrittura sullo
// store.

import { chromium } from "playwright";

import { REAL_CHROME_UA } from "./lib/tiktok-page.mjs";

const TAGS = (process.argv[2] || "bluserena")
  .split(",")
  .map((t) => t.trim().replace(/^#/, ""))
  .filter(Boolean);

const MAX_SCROLL = Number.parseInt(process.env.MAX_SCROLL ?? "60", 10);
const ATTESA_MS = Number.parseInt(process.env.ATTESA_MS ?? "2500", 10);
// Più tollerante dei 3 giri dello scraper vero: qui vogliamo sapere dove sta
// il tetto reale, non fermarci alla prima pausa di caricamento.
const GIRI_SENZA_NOVITA = Number.parseInt(process.env.GIRI_SENZA_NOVITA ?? "8", 10);
const COUNT_RISCRITTO = Number.parseInt(process.env.COUNT_RISCRITTO ?? "50", 10);
// C/D/E confermate morte nel primo giro (9/09/2026): si saltano di default
// per non spendere tempo di run a riconfermare un esito già noto.
const SOLO_HASHTAG = (process.env.SOLO_HASHTAG ?? "true") !== "false";

const API = /\/api\/(challenge|search|post|item)[^?]*/i;

function idDaUrl(href) {
  return String(href || "").match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null;
}

// Le liste TikTok cambiano nome di campo tra un endpoint e l'altro
// (itemList sugli hashtag, search_item_list sulla ricerca, aweme_list
// altrove) e a volte annidano il video sotto `item`/`aweme_info`. Si
// raccoglie da tutte le forme note invece di sceglierne una e sperare.
function idDaRisposta(data) {
  const trovati = [];
  const liste = [
    data?.itemList,
    data?.item_list,
    data?.search_item_list,
    data?.aweme_list,
    data?.data,
  ];
  for (const lista of liste) {
    if (!Array.isArray(lista)) continue;
    for (const voce of lista) {
      const v = voce?.item ?? voce?.aweme_info ?? voce;
      const id = v?.id ?? v?.aweme_id;
      if (id) trovati.push(String(id));
    }
  }
  return trovati;
}

async function scorri(page) {
  const daDom = new Set();
  let fermi = 0;

  for (let i = 0; i < MAX_SCROLL; i++) {
    const prima = daDom.size;
    const href = await page
      .$$eval('a[href*="/video/"], a[href*="/photo/"]', (link) =>
        link.map((a) => a.getAttribute("href")).filter(Boolean),
      )
      .catch(() => []);
    for (const h of href) {
      const id = idDaUrl(h);
      if (id) daDom.add(id);
    }

    if (daDom.size === prima) {
      fermi++;
      if (fermi >= GIRI_SENZA_NOVITA) break;
    } else {
      fermi = 0;
    }

    // window.scrollTo invece di mouse.wheel: la rotella agisce sull'elemento
    // sotto al puntatore (che a (0,0) è la barra laterale), scrollTo agisce
    // sempre sul documento.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(ATTESA_MS);
  }

  return daDom;
}

async function strategia(browser, { nome, url, riscriviCount = false }) {
  console.log(`\n========== ${nome}`);
  console.log(`  ${url}`);

  const context = await browser.newContext({
    userAgent: REAL_CHROME_UA,
    // Viewport grande: più video visibili per schermata, più caricamento
    // pigro innescato per giro di scroll.
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const daXhr = new Set();
  const richieste = [];
  const risposte = [];

  if (riscriviCount) {
    await page.route("**/api/**", async (route) => {
      try {
        const u = new URL(route.request().url());
        if (u.searchParams.has("count")) {
          u.searchParams.set("count", String(COUNT_RISCRITTO));
          await route.continue({ url: u.toString() });
          return;
        }
      } catch {
        /* URL non parsabile: si prosegue senza toccare nulla */
      }
      await route.continue();
    });
  }

  page.on("request", (req) => {
    const m = req.url().match(API);
    if (m && richieste.length < 6) richieste.push(req.url().slice(0, 300));
  });

  page.on("response", async (res) => {
    if (!API.test(res.url())) return;
    try {
      const data = await res.json();
      const id = idDaRisposta(data);
      for (const x of id) daXhr.add(x);
      risposte.push({
        status: res.status(),
        items: id.length,
        hasMore: data?.hasMore ?? data?.has_more ?? null,
        cursor: data?.cursor ?? null,
        chiavi: Object.keys(data ?? {})
          .slice(0, 10)
          .join(","),
      });
    } catch {
      risposte.push({
        status: res.status(),
        items: null,
        hasMore: null,
        cursor: null,
        chiavi: "(non JSON)",
      });
    }
  });

  let daDom = new Set();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    daDom = await scorri(page);
  } catch (err) {
    console.log(`  ERRORE: ${String(err?.message ?? err).slice(0, 200)}`);
  }

  const titolo = await page.title().catch(() => null);
  const testo = await page
    .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "")
    .catch(() => "");

  console.log(`  titolo: ${String(titolo).slice(0, 80)}`);
  if (daDom.size === 0 && daXhr.size === 0) console.log(`  testo pagina: "${testo}"`);

  console.log(`  richieste API viste:`);
  for (const r of richieste) console.log(`    ${r}`);
  console.log(`  risposte API: ${risposte.length}`);
  for (const r of risposte.slice(0, 8)) {
    console.log(
      `    HTTP ${r.status} items=${r.items} hasMore=${r.hasMore} cursor=${r.cursor} chiavi=${r.chiavi}`,
    );
  }

  const unione = new Set([...daDom, ...daXhr]);
  console.log(`  --> DOM ${daDom.size} | XHR ${daXhr.size} | unione ${unione.size}`);

  await context.close().catch(() => {});
  return { nome, daDom, daXhr, unione };
}

async function sondaHashtag(browser, tag) {
  console.log(`\n\n#################### #${tag} ####################`);
  const q = encodeURIComponent(tag);
  const esiti = [];

  esiti.push(
    await strategia(browser, {
      nome: "A/B. Pagina hashtag (DOM + XHR)",
      url: `https://www.tiktok.com/tag/${q}`,
    }),
  );

  if (!SOLO_HASHTAG) {
    esiti.push(
      await strategia(browser, {
        nome: `C. Pagina hashtag con count=${COUNT_RISCRITTO}`,
        url: `https://www.tiktok.com/tag/${q}`,
        riscriviCount: true,
      }),
    );
    esiti.push(
      await strategia(browser, {
        nome: "D. Ricerca video",
        url: `https://www.tiktok.com/search/video?q=${q}`,
      }),
    );
    esiti.push(
      await strategia(browser, {
        nome: "E. Ricerca generale",
        url: `https://www.tiktok.com/search?q=${q}`,
      }),
    );
  }

  console.log(`\n  -------- Riepilogo #${tag}`);
  for (const e of esiti) {
    console.log(`    ${e.nome}: ${e.unione.size} unici (DOM ${e.daDom.size}, XHR ${e.daXhr.size})`);
  }
  const totale = new Set();
  for (const e of esiti) for (const id of e.unione) totale.add(id);
  console.log(`    UNIONE #${tag}: ${totale.size} video unici`);

  return { tag, esiti, totale: totale.size };
}

// --- Main ---
console.log(`=== Sonda: più video per hashtag — ${TAGS.map((t) => "#" + t).join(", ")} ===`);
console.log(
  `Parametri: max ${MAX_SCROLL} scroll, ${ATTESA_MS}ms di attesa, stop dopo ${GIRI_SENZA_NOVITA} giri senza novità, ` +
    `strategie ${SOLO_HASHTAG ? "solo A/B (C/D/E saltate, già confermate morte)" : "tutte (A-E)"}\n`,
);

const browser = await chromium.launch({ headless: true });
const risultatiPerTag = [];

try {
  for (const tag of TAGS) {
    risultatiPerTag.push(await sondaHashtag(browser, tag));
  }
} finally {
  await browser.close();
}

console.log("\n\n==================== RIEPILOGO FINALE");
for (const r of risultatiPerTag) {
  console.log(
    `  #${r.tag}: ${r.totale} video unici ${r.totale >= 200 ? "(RAGGIUNTO 200)" : `(mancano ${200 - r.totale})`}`,
  );
}

const valori = risultatiPerTag.map((r) => r.totale);
const media = valori.length ? Math.round(valori.reduce((a, b) => a + b, 0) / valori.length) : 0;
const minimo = valori.length ? Math.min(...valori) : 0;
const massimo = valori.length ? Math.max(...valori) : 0;

console.log(
  `\n  Su ${risultatiPerTag.length} hashtag: media ${media}, minimo ${minimo}, massimo ${massimo} video unici.`,
);
console.log(
  `  Obiettivo 200/hashtag a passata: ${media >= 200 ? "RAGGIUNTO in media" : `mancano ${200 - media} in media`} ` +
    `con GIRI_SENZA_NOVITA=${GIRI_SENZA_NOVITA}.`,
);
