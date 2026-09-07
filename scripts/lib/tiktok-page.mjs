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
export async function fetchAuthorVideos(browser, handle, opzioni = {}) {
  const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
  try {
    await page.goto(`https://www.tiktok.com/@${handle}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    const url = await scrollAndCollectVideoUrls(page, opzioni);

    if (url.length === 0) {
      const titolo = await page.title().catch(() => null);
      return {
        status: sembraLoginWall(titolo, page.url()) ? "login_wall" : "no_videos",
        reason: `titolo: ${String(titolo).slice(0, 80)}`,
        url: [],
      };
    }

    return { status: "ok", url };
  } catch (err) {
    return { status: "error", reason: String(err?.message ?? err).slice(0, 200), url: [] };
  } finally {
    await page.close().catch(() => {});
  }
}
