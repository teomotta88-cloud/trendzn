// Sonda diagnostica: come si ottiene la lista dei video di un autore TikTok?
//
// PRIMO RUN (07/09/2026), leggendo solo il DOM: fallito, ma non per un
// login-wall — la pagina caricava correttamente ("Mara Albergo (@maraalbergo)
// | TikTok"), lo script di idratazione c'era, e __DEFAULT_SCOPE__ conteneva
// webapp.user-detail (i dati dell'utente) senza nessuna chiave con la lista
// dei post. Zero link video nel DOM. Conclusione: la griglia NON è nell'HTML,
// TikTok la carica con una chiamata separata dopo l'idratazione.
//
// Questo secondo giro prova le tre strade rimaste, e dice quale funziona:
//
//   A. Attendere davvero la griglia (waitForSelector con timeout lungo)
//      invece di scorrere subito: se è solo lentezza, basta questo.
//   B. Intercettare la risposta XHR /api/post/item_list/ che la pagina fa da
//      sé. È la strada più promettente: la firma della richiesta (msToken,
//      X-Bogus) la calcola TikTok nel suo JS, noi leggiamo solo la risposta
//      e non dobbiamo riprodurre nulla.
//   C. Guardare cosa c'è comunque nel DOM dopo gli scroll, come prima, per
//      confronto.
//
// Se nessuna funziona, l'enumerazione dei profili non è praticabile e resta
// solo lo scraping degli hashtag (che invece è già validato).
//
// Uso: node scripts/probe-tiktok-profile-videos.mjs [@handle,...]

import { chromium } from "playwright";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Il caso che ha motivato tutto: se una delle strade funziona, tra i video di
// @maraalbergo deve comparire questo ID, che nello store non c'è.
const ATTESO = "7675653655655140640";
const DEFAULT_HANDLE = ["maraalbergo"];

const handles = (process.argv[2] || "")
  .split(",")
  .map((h) => h.trim().replace(/^@/, ""))
  .filter(Boolean);
const daProvare = handles.length > 0 ? handles : DEFAULT_HANDLE;

const browser = await chromium.launch({ headless: true });

try {
  for (const handle of daProvare) {
    console.log(`\n========== @${handle}`);
    const page = await browser.newPage({ userAgent: REAL_CHROME_UA });

    // B. Tutto ciò che assomiglia alla lista dei post dell'utente, raccolto
    // mentre la pagina fa le sue chiamate.
    const daXhr = new Set();
    const chiamate = [];
    page.on("response", async (res) => {
      const u = res.url();
      if (!/\/api\/(post\/item_list|user\/detail)/.test(u)) return;
      chiamate.push(`${res.status()} ${u.slice(0, 110)}`);
      try {
        const body = await res.json();
        for (const item of body?.itemList ?? []) {
          if (item?.id) daXhr.add(String(item.id));
        }
      } catch {
        /* risposta non JSON o già consumata: la registra comunque `chiamate` */
      }
    });

    try {
      await page.goto(`https://www.tiktok.com/@${handle}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // A. Aspetta la griglia invece di scorrere subito.
      const grigliaComparsa = await page
        .waitForSelector('a[href*="/video/"]', { timeout: 25000 })
        .then(() => true)
        .catch(() => false);
      console.log(`  A) griglia comparsa entro 25s : ${grigliaComparsa ? "SÌ" : "NO"}`);

      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2000);
      }

      // C. Cosa c'è nel DOM adesso.
      const daDom = await page
        .$$eval('a[href*="/video/"]', (link) =>
          link.map((a) => a.getAttribute("href")?.match(/\/video\/(\d+)/)?.[1]).filter(Boolean),
        )
        .catch(() => []);

      const titolo = await page.title().catch(() => null);
      console.log(`  titolo pagina                 : ${titolo}`);
      console.log(`  B) chiamate lista intercettate: ${chiamate.length}`);
      for (const c of chiamate.slice(0, 4)) console.log(`     ${c}`);
      console.log(`  B) id video dalle XHR         : ${daXhr.size}`);
      console.log(`  C) id video dal DOM           : ${new Set(daDom).size}`);

      const tutti = new Set([...daXhr, ...daDom]);
      console.log(`  --> id totali raccolti        : ${tutti.size}`);
      if (tutti.size > 0) console.log(`      primi: ${[...tutti].slice(0, 8).join(", ")}`);
      if (handle === "maraalbergo") {
        console.log(
          `  >>> ${ATTESO} (il post mancante) presente: ${tutti.has(ATTESO) ? "SÌ" : "NO"}`,
        );
      }
      if (tutti.size === 0) {
        console.log(
          "  ⚠️  Nessuna strada ha prodotto video: l'enumerazione dei profili non è praticabile " +
            "così, resta lo scraping degli hashtag.",
        );
      }
    } catch (err) {
      console.error(`  ERRORE: ${String(err?.message ?? err).slice(0, 200)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
