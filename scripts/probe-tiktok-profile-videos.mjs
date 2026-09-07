// Sonda diagnostica: la pagina PROFILO di un autore TikTok espone la lista
// dei suoi video a Playwright?
//
// Perché serve. Il post @maraalbergo/video/7675653655655140640 (19/08/2026)
// ha #bluserena in caption ma non è mai entrato nello store, pur essendo
// l'autore già noto con altri 3 post. È sfuggito allo scraping hashtag DIY
// mentre girava ogni 3 ore, per 13 giorni: le liste hashtag di TikTok sono
// parziali e non deterministiche (vedi il commento in testa a
// backfill-tiktok-hashtag.mjs), quindi campionarle più spesso non chiude il
// buco.
//
// L'alternativa è deterministica: un profilo elenca TUTTI i video di quel
// autore. Su 993 autori già noti nello store, enumerarli chiuderebbe il buco
// per tutti i post di autori che conosciamo — gratis, con la stessa tecnica
// Playwright già validata in scrape-tiktok-engagement.mjs.
//
// Ma la fattibilità NON è data per scontata: la pagina video espone i dati
// in __UNIVERSAL_DATA_FOR_REHYDRATION__, il profilo potrebbe caricare la
// griglia via API separata e restituire un login-wall. Questa sonda lo
// verifica sul campo prima di costruirci sopra — stessa disciplina dei
// probe-tiktok-*.mjs già nel repo.
//
// Uso: node scripts/probe-tiktok-profile-videos.mjs [@handle,...]
// Default: gli autori del caso reale, con l'ID atteso da ritrovare.

import { chromium } from "playwright";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Il primo è il caso che ha motivato tutto: se la sonda funziona, tra i suoi
// video deve comparire ATTESO, che nello store non c'è.
const ATTESO = "7675653655655140640";
const DEFAULT_HANDLE = ["maraalbergo", "manuenatyboutique", "vaniagossip81"];

const handles = (process.argv[2] || "")
  .split(",")
  .map((h) => h.trim().replace(/^@/, ""))
  .filter(Boolean);
const daProvare = handles.length > 0 ? handles : DEFAULT_HANDLE;

const browser = await chromium.launch({ headless: true });

try {
  for (const handle of daProvare) {
    const url = `https://www.tiktok.com/@${handle}`;
    console.log(`\n========== @${handle}`);
    const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // La griglia si popola dopo l'idratazione; qualche scroll per vedere
      // se arrivano altri video oltre al primo blocco.
      await page.waitForTimeout(3000);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      const esito = await page.evaluate(() => {
        const link = [...document.querySelectorAll('a[href*="/video/"]')]
          .map((a) => a.getAttribute("href"))
          .filter(Boolean);
        const raw = document.querySelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent;
        let scope = [];
        try {
          scope = Object.keys(JSON.parse(raw ?? "{}")?.__DEFAULT_SCOPE__ ?? {});
        } catch {
          /* JSON assente o illeggibile: lo dice già `idratazione` qui sotto */
        }
        return {
          titolo: document.title,
          idratazione: Boolean(raw),
          scope,
          link: [...new Set(link)],
        };
      });

      const id = esito.link.map((l) => l.match(/\/video\/(\d+)/)?.[1]).filter(Boolean);
      console.log(`  titolo pagina : ${esito.titolo}`);
      console.log(`  script idratazione presente: ${esito.idratazione}`);
      console.log(`  chiavi __DEFAULT_SCOPE__   : ${esito.scope.join(", ") || "(nessuna)"}`);
      console.log(`  video elencati nel DOM     : ${id.length}`);
      if (id.length > 0) console.log(`  primi id: ${id.slice(0, 8).join(", ")}`);
      if (handle === "maraalbergo") {
        console.log(
          `  >>> ${ATTESO} (il post mancante) presente: ${id.includes(ATTESO) ? "SÌ" : "NO"}`,
        );
      }
      if (id.length === 0) {
        console.log("  ⚠️  Nessun video nel DOM: probabile login-wall o griglia caricata via API.");
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
