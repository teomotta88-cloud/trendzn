// Sonda diagnostica: come superare il tetto di ~60 video per hashtag a passata?
//
// IL PROBLEMA. Lo scraping profondo (scrape-tiktok-hashtag-deep.mjs) legge in
// media ~60 video per hashtag a passata. Con quel ritmo, avere ragionevole
// certezza di aver recuperato la gran parte dei post richiederebbe settimane
// di passate. Serve arrivare ad almeno 200 per hashtag a passata.
//
// PERCHÉ NON BASTA SCROLLARE DI PIÙ. Il tetto NON è il nostro budget di
// scroll. A 1280px il grid mostra ~5 video per riga: 60 video sono ~12 righe,
// circa 3.000-3.600px, cioè 1-2 giri dei nostri `mouse.wheel(0, 3000)` su 40
// disponibili. Il loop esaurisce il contenuto e si ferma per "3 giri senza
// novità" molto prima del tetto di scroll. Lo stesso ~60 era già emerso da una
// sonda che paginava via API invece che via DOM: è un limite imposto lato
// server alla singola vista, non un limite nostro.
//
// LE IPOTESI CHE QUESTA SONDA MISURA, su UN hashtag alla volta:
//
//   A. /tag/<T>, link dal DOM — la strategia attuale, come riferimento.
//   B. /tag/<T>, ID dalle risposte XHR intercettate. Sugli hashtag le XHR
//      rispondono davvero (i video si vedono), a differenza dei profili dove
//      tornavano vuote e per cui quello script è stato ritirato. Se B > A,
//      il DOM ci sta facendo perdere roba già scaricata.
//   C. /tag/<T> con il parametro `count` della richiesta riscritto verso
//      l'alto via page.route: TikTok chiede ~30 per pagina, se accetta 50+
//      raddoppiamo a parità di chiamate. Può fallire se la firma della
//      richiesta copre la query string — si vede dal risultato.
//   D. /search/video?q=<T> — la ricerca video è un endpoint diverso dalla
//      pagina hashtag, con un suo tetto e un suo ordinamento.
//   E. /search?q=<T> — la ricerca generale, altro insieme ancora.
//
// L'ipotesi di fondo da verificare: se il tetto è PER VISTA, la strada per
// arrivare a 200+ non è scrollare di più una vista sola, ma sommare più viste
// distinte dello stesso termine. Questa sonda misura quanto ognuna rende da
// sola e quanto si sovrappongono, così la scelta poi è sui numeri veri.
//
// Stampa anche gli URL delle richieste API intercettate e `hasMore`/`cursor`
// dell'ultima risposta: servono a distinguere "TikTok dice che è finita" da
// "ci fermiamo noi troppo presto", e a scoprire i nomi veri dei parametri
// senza doverli indovinare.
//
// Gratis: solo Playwright anonimo, nessun credito, nessuna scrittura sullo
// store. Uso: node scripts/probe-tiktok-hashtag-piu-video.mjs [hashtag]

import { chromium } from "playwright";

import { REAL_CHROME_UA } from "./lib/tiktok-page.mjs";

const TAG = (process.argv[2] || "bluserena").replace(/^#/, "");

const MAX_SCROLL = Number.parseInt(process.env.MAX_SCROLL ?? "60", 10);
const ATTESA_MS = Number.parseInt(process.env.ATTESA_MS ?? "2500", 10);
// Più tollerante dei 3 giri dello scraper vero: qui vogliamo sapere dove sta
// il tetto reale, non fermarci alla prima pausa di caricamento.
const GIRI_SENZA_NOVITA = Number.parseInt(process.env.GIRI_SENZA_NOVITA ?? "8", 10);
const COUNT_RISCRITTO = Number.parseInt(process.env.COUNT_RISCRITTO ?? "50", 10);

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

// --- Main ---
console.log(`=== Sonda: più video per hashtag — #${TAG} ===`);
console.log(
  `Parametri: max ${MAX_SCROLL} scroll, ${ATTESA_MS}ms di attesa, stop dopo ${GIRI_SENZA_NOVITA} giri senza novità\n`,
);

const q = encodeURIComponent(TAG);
const browser = await chromium.launch({ headless: true });
const esiti = [];

try {
  esiti.push(
    await strategia(browser, {
      nome: "A/B. Pagina hashtag (DOM + XHR)",
      url: `https://www.tiktok.com/tag/${q}`,
    }),
  );
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
} finally {
  await browser.close();
}

console.log("\n\n==================== RIEPILOGO");
for (const e of esiti) {
  console.log(`  ${e.nome}: ${e.unione.size} unici (DOM ${e.daDom.size}, XHR ${e.daXhr.size})`);
}

const totale = new Set();
for (const e of esiti) for (const id of e.unione) totale.add(id);
console.log(`\n  UNIONE DI TUTTE LE STRATEGIE: ${totale.size} video unici`);

// Quanto ogni strategia aggiunge davvero rispetto alla pagina hashtag da
// sola: è il numero che dice se sommare più viste è la strada per i 200.
const base = esiti[0]?.unione ?? new Set();
for (const e of esiti.slice(1)) {
  const soloSuoi = [...e.unione].filter((id) => !base.has(id)).length;
  console.log(`  ${e.nome}: ${soloSuoi} video che la pagina hashtag NON aveva`);
}

// Sovrapposizione a coppie fra tutte le strategie: non solo quanto aggiunge
// ciascuna rispetto alla pagina hashtag, ma quanto si somigliano DUE a due —
// es. hashtag vs ricerca video sono davvero due bacini diversi, o pescano
// perlopiù lo stesso contenuto? Un'alta sovrapposizione vuol dire che
// sommarle non porta lontano dai 200; una bassa vuol dire che sono
// complementari e vale la pena tenerle entrambe.
console.log("\n  Sovrapposizione a coppie (unici combinati / intersezione):");
for (let i = 0; i < esiti.length; i++) {
  for (let j = i + 1; j < esiti.length; j++) {
    const a = esiti[i].unione;
    const b = esiti[j].unione;
    const intersezione = [...a].filter((id) => b.has(id)).length;
    const combinati = new Set([...a, ...b]).size;
    const minSize = Math.min(a.size, b.size) || 1;
    const percSovrapposizione = Math.round((intersezione / minSize) * 100);
    console.log(
      `    ${esiti[i].nome} + ${esiti[j].nome}: ${combinati} unici combinati ` +
        `(${a.size} + ${b.size}, intersezione ${intersezione}, ${percSovrapposizione}% del più piccolo dei due)`,
    );
  }
}

console.log(
  `\n  Obiettivo 200/hashtag a passata: ${totale.size >= 200 ? "RAGGIUNTO" : `mancano ${200 - totale.size}`} ` +
    "con queste strategie sommate.",
);
