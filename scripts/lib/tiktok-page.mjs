// Lettura di una pagina TikTok con Playwright: il singolo video e il profilo
// di un autore. È l'unico punto dove si parla con TikTok, così lo User-Agent,
// il riconoscimento del login-wall e i timeout stanno scritti una volta sola.
//
// Usato da scrape-tiktok-engagement.mjs (KPI e caption), da
// discover-tiktok-by-author.mjs (enumerazione dei profili) e da
// scrape-tiktok-hashtag-deep.mjs (post nuovi trovati sulle pagine hashtag).

import { readVideoDetail } from "./tiktok-engagement.mjs";

// Senza uno User-Agent "da browser vero" TikTok serve la pagina di login al
// posto del contenuto: verificato in sync-bluserena-hashtags.mjs, dove la
// caption risultava null su 15/15 post con lo UA headless di default.
export const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HYDRATION = "#__UNIVERSAL_DATA_FOR_REHYDRATION__";

function sembraLoginWall(titolo, url) {
  return /log ?in|accedi/i.test(titolo ?? "") || /\/login/.test(url ?? "");
}

// Contatori + caption di un singolo video. Ritorna sempre un record con
// `status`: chi chiama non deve distinguere fra "non c'è" e "è andata male".
export async function fetchVideoDetail(browser, url) {
  const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const raw = await page.$eval(HYDRATION, (el) => el.textContent).catch(() => null);

    if (!raw) {
      const titolo = await page.title().catch(() => null);
      return {
        status: sembraLoginWall(titolo, page.url()) ? "login_wall" : "no_data",
        reason: `titolo: ${String(titolo).slice(0, 80)}`,
      };
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: "no_data", reason: "JSON di idratazione non parsabile" };
    }

    return readVideoDetail(data);
  } catch (err) {
    return { status: "error", reason: String(err?.message ?? err).slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}

// Scorre una pagina che carica contenuti a scroll infinito (profilo o
// hashtag) e ritorna gli URL dei video trovati.
//
// Si ferma da sola quando due giri di seguito non aggiungono nulla di nuovo,
// invece che a un numero fisso di scroll: i profili vanno da 1 a centinaia di
// video, e un numero fisso o taglia i profili lunghi o spreca minuti su
// quelli corti. `maxScroll` resta come tetto per non restare appesi a una
// pagina che continua a caricare all'infinito.
export async function scrollAndCollectVideoUrls(
  page,
  { maxScroll = 40, giriSenzaNovita = 2, attesaMs = 1500 } = {},
) {
  const trovati = new Set();
  let fermi = 0;

  for (let i = 0; i < maxScroll; i++) {
    const prima = trovati.size;
    const href = await page
      .$$eval('a[href*="/video/"], a[href*="/photo/"]', (link) =>
        link.map((a) => a.getAttribute("href")).filter(Boolean),
      )
      .catch(() => []);

    for (const h of href) {
      trovati.add(h.startsWith("http") ? h : `https://www.tiktok.com${h}`);
    }

    if (trovati.size === prima) {
      fermi++;
      if (fermi >= giriSenzaNovita) break;
    } else {
      fermi = 0;
    }

    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(attesaMs);
  }

  return [...trovati];
}

// Tutti i video pubblici di un autore. È la parte deterministica della
// scoperta: un profilo elenca i suoi video, non un campione, a differenza
// delle pagine hashtag.
//
// Si raccoglie da DUE strade insieme, perché la griglia NON sta nell'HTML: il
// primo run della sonda (07/09/2026) ha trovato la pagina caricata
// correttamente, con webapp.user-detail nello scope di idratazione ma nessuna
// lista di post e zero link nel DOM. TikTok la carica dopo, con una chiamata
// separata.
//
//   1. le risposte XHR /api/post/item_list/ che la pagina fa da sé — la firma
//      (msToken, X-Bogus) la calcola il JS di TikTok, noi leggiamo soltanto
//      la risposta e non dobbiamo riprodurre niente;
//   2. i link nel DOM dopo gli scroll, per quando la griglia si materializza.
//
// L'unione delle due copre entrambi i casi senza dover indovinare quale sia
// quello buono.
export async function fetchAuthorVideos(browser, handle, opzioni = {}) {
  const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
  const daXhr = new Set();

  page.on("response", async (res) => {
    if (!/\/api\/post\/item_list/.test(res.url())) return;
    try {
      const body = await res.json();
      for (const item of body?.itemList ?? []) {
        const id = item?.id;
        const autore = item?.author?.uniqueId ?? handle;
        if (id) daXhr.add(`https://www.tiktok.com/@${autore}/video/${id}`);
      }
    } catch {
      /* risposta non JSON o già consumata: resta la strada del DOM */
    }
  });

  try {
    await page.goto(`https://www.tiktok.com/@${handle}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Aspetta che la griglia compaia invece di scorrere subito nel vuoto; se
    // non arriva si prosegue lo stesso, perché le XHR possono aver già
    // consegnato la lista.
    await page.waitForSelector('a[href*="/video/"]', { timeout: 15000 }).catch(() => null);

    const daDom = await scrollAndCollectVideoUrls(page, opzioni);
    const url = [...new Set([...daXhr, ...daDom])];

    if (url.length === 0) {
      const titolo = await page.title().catch(() => null);
      return {
        status: sembraLoginWall(titolo, page.url()) ? "login_wall" : "no_videos",
        reason: `titolo: ${String(titolo).slice(0, 80)}`,
        url: [],
      };
    }

    return { status: "ok", url, daXhr: daXhr.size, daDom: daDom.length };
  } catch (err) {
    return { status: "error", reason: String(err?.message ?? err).slice(0, 200), url: [] };
  } finally {
    await page.close().catch(() => {});
  }
}
