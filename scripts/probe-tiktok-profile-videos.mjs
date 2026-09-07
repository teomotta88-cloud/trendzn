// Sonda diagnostica: come si ottiene la lista dei video di un autore TikTok?
//
// STORIA DEI DUE RUN PRECEDENTI, perché è quella che restringe il campo.
//
// Run 1 (solo DOM). Nessun login-wall: la pagina caricava correttamente
// ("Mara Albergo (@maraalbergo) | TikTok"), lo script di idratazione c'era, e
// __DEFAULT_SCOPE__ conteneva webapp.user-detail — i dati dell'utente — ma
// nessuna chiave con la lista dei post. Zero link nel DOM. Conclusione: la
// griglia non è nell'HTML.
//
// Run 2 (DOM + intercettazione XHR). La pagina CHIEDE la lista: due chiamate
// a /api/post/item_list/, entrambe con risposta 200. Ma da quelle risposte
// non è uscito nessun video, e il DOM è rimasto vuoto. Le due spiegazioni
// possibili portano a conclusioni opposte:
//   - il corpo ha una forma diversa da quella attesa (chiave non `itemList`)
//     -> risolvibile leggendo la chiave giusta;
//   - TikTok risponde 200 con payload vuoto o statusCode di errore, come fa
//     quando la richiesta non è firmata a dovere o riconosce l'automazione
//     -> non risolvibile senza una sessione vera.
// Il run 2 non permetteva di distinguerle perché ingoiava il corpo in
// silenzio.
//
// QUESTO RUN stampa cosa c'è davvero nella risposta — chiavi di primo
// livello, statusCode, lunghezza di itemList, un pezzo di corpo grezzo — così
// la domanda si chiude. E, se TIKTOK_MS_TOKEN è nell'ambiente, ripete la
// prova con quel cookie di sessione: è il modo di verificare se basta una
// sessione autenticata a far tornare dati.
//
// Uso: node scripts/probe-tiktok-profile-videos.mjs [@handle,...]

import { chromium } from "playwright";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Il caso che ha motivato tutto: se una strada funziona, tra i video di
// @maraalbergo deve comparire questo ID, che nello store non c'è.
const ATTESO = "7675653655655140640";
const MS_TOKEN = process.env.TIKTOK_MS_TOKEN || "";

const handles = (process.argv[2] || "")
  .split(",")
  .map((h) => h.trim().replace(/^@/, ""))
  .filter(Boolean);
const daProvare = handles.length > 0 ? handles : ["maraalbergo"];

async function prova(browser, handle, { conSessione }) {
  const etichetta = conSessione ? "CON msToken" : "SENZA sessione";
  console.log(`\n---------- @${handle} — ${etichetta}`);

  const context = await browser.newContext({ userAgent: REAL_CHROME_UA });
  if (conSessione) {
    await context.addCookies([
      { name: "msToken", value: MS_TOKEN, domain: ".tiktok.com", path: "/" },
    ]);
  }
  const page = await context.newPage();

  const id = new Set();
  const risposte = [];

  page.on("response", async (res) => {
    if (!/\/api\/post\/item_list/.test(res.url())) return;
    const info = { status: res.status(), chiavi: null, statusCode: null, items: null, raw: null };
    try {
      const testo = await res.text();
      info.raw = testo.slice(0, 220);
      const body = JSON.parse(testo);
      info.chiavi = Object.keys(body).join(", ");
      info.statusCode = body.statusCode ?? body.status_code ?? null;
      // Oltre a itemList, i nomi che TikTok ha usato in versioni diverse
      // dell'endpoint: se i dati ci sono ma sotto un altro nome, si vede qui.
      const lista = body.itemList ?? body.items ?? body.aweme_list ?? null;
      info.items = Array.isArray(lista) ? lista.length : null;
      for (const item of lista ?? []) {
        const vid = item?.id ?? item?.aweme_id;
        if (vid) id.add(String(vid));
      }
    } catch (err) {
      info.chiavi = `(corpo illeggibile: ${String(err?.message ?? err).slice(0, 60)})`;
    }
    risposte.push(info);
  });

  try {
    await page.goto(`https://www.tiktok.com/@${handle}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector('a[href*="/video/"]', { timeout: 15000 }).catch(() => null);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(2000);
    }

    const daDom = await page
      .$$eval('a[href*="/video/"]', (link) =>
        link.map((a) => a.getAttribute("href")?.match(/\/video\/(\d+)/)?.[1]).filter(Boolean),
      )
      .catch(() => []);
    for (const v of daDom) id.add(v);

    console.log(`  titolo: ${await page.title().catch(() => null)}`);
    console.log(`  risposte item_list: ${risposte.length}`);
    for (const r of risposte) {
      console.log(`    HTTP ${r.status} | statusCode=${r.statusCode} | items=${r.items}`);
      console.log(`    chiavi: ${r.chiavi}`);
      console.log(`    corpo : ${r.raw}`);
    }
    console.log(`  id dal DOM: ${daDom.length}`);
    console.log(`  --> id totali: ${id.size}`);
    if (handle === "maraalbergo") {
      console.log(`  >>> ${ATTESO} presente: ${id.has(ATTESO) ? "SÌ" : "NO"}`);
    }
    return id.size;
  } catch (err) {
    console.error(`  ERRORE: ${String(err?.message ?? err).slice(0, 200)}`);
    return 0;
  } finally {
    await context.close().catch(() => {});
  }
}

const browser = await chromium.launch({ headless: true });
let trovatiInTotale = 0;

try {
  for (const handle of daProvare) {
    console.log(`\n========== @${handle}`);
    trovatiInTotale += await prova(browser, handle, { conSessione: false });

    if (MS_TOKEN) {
      trovatiInTotale += await prova(browser, handle, { conSessione: true });
    } else {
      console.log("\n  (TIKTOK_MS_TOKEN non nell'ambiente: prova con sessione saltata)");
    }
  }
} finally {
  await browser.close();
}

console.log("\n==================== ESITO");
if (trovatiInTotale > 0) {
  console.log("Almeno una strada restituisce video: l'enumerazione dei profili è praticabile.");
} else {
  console.log(
    "Nessuna strada restituisce video. Guardare `statusCode` e `corpo` qui sopra: se il\n" +
      "corpo è vuoto o porta un codice di errore, TikTok sta rifiutando la richiesta e\n" +
      "l'enumerazione dei profili non è percorribile — resta lo scraping degli hashtag.",
  );
}
