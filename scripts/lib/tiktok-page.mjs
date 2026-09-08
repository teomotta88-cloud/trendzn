// Lettura di una pagina TikTok con Playwright: il singolo video e il profilo
// di un autore. È l'unico punto dove si parla con TikTok, così lo User-Agent,
// la sessione autenticata, il riconoscimento del login-wall e i timeout
// stanno scritti una volta sola.
//
// Usato da scrape-tiktok-engagement.mjs (KPI e caption), da
// discover-tiktok-by-author.mjs (enumerazione dei profili) e da
// scrape-tiktok-hashtag-deep.mjs (post nuovi trovati sulle pagine hashtag).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

// --------------------------------------------------------- sessione TikTok
//
// Da anonimo la pagina hashtag si ferma a ~58-60 video (il tetto verificato
// due volte, con tecniche diverse: scroll del DOM e paginazione via API) e i
// profili non consegnano affatto la griglia. Da loggati un conteggio manuale
// ne ha trovati 414 sullo stesso hashtag — non è un limite del contenuto, è
// un limite imposto alle sessioni anonime.
//
// Il login vero va fatto una volta sola FUORI da CI (scripts/
// tiktok-bootstrap-session.mjs, stesso schema di tiktok-cc-bootstrap-
// session.mjs per Creative Center): farlo da un runner GitHub, da IP
// datacenter, farebbe quasi certamente scattare un captcha/verifica.
//
// Niente fallback di login automatico via email/password qui, a differenza
// di tiktok-cc-session.mjs: quel fallback è pensato per sessioni che devono
// sopravvivere settimane di run schedulati, non è il caso — qui basta una
// sessione valida per la durata di UN run one-shot. Se la sessione seed non
// c'è o non è più valida, meglio fermarsi e dirlo che tentare un login
// automatico che dal runner fallirebbe comunque.
export const SESSION_PATH =
  process.env.TIKTOK_SESSION_PATH || ".tiktok-session/consumer-state.json";

function seedSessionFromEnv() {
  const seed = process.env.TIKTOK_SESSION_SEED;
  if (!seed) return false;
  try {
    const json = Buffer.from(seed, "base64").toString("utf-8");
    JSON.parse(json); // valida che sia JSON valido prima di scrivere il file
    mkdirSync(dirname(SESSION_PATH), { recursive: true });
    writeFileSync(SESSION_PATH, json);
    console.error("[sessione tiktok] Inizializzata da TIKTOK_SESSION_SEED.");
    return true;
  } catch (err) {
    console.error(`[sessione tiktok] TIKTOK_SESSION_SEED non valido: ${String(err)}`);
    return false;
  }
}

// Un BrowserContext con la sessione salvata, se presente, altrimenti uno
// anonimo — mai un errore: chi chiama prosegue comunque, con la copertura
// ridotta che questo modulo già gestisce (login_wall, no_videos, ecc.).
export async function createTikTokContext(browser) {
  if (!existsSync(SESSION_PATH)) seedSessionFromEnv();
  const hasSession = existsSync(SESSION_PATH);
  console.log(
    hasSession
      ? "[sessione tiktok] Sessione autenticata caricata."
      : "[sessione tiktok] Nessuna sessione: navigazione anonima (copertura ridotta, vedi commento in testa a tiktok-page.mjs).",
  );
  return browser.newContext({
    storageState: hasSession ? SESSION_PATH : undefined,
    userAgent: REAL_CHROME_UA,
  });
}

// Usate solo dal bootstrap manuale (tiktok-bootstrap-session.mjs): salvano la
// sessione appena creata a mano e producono il valore per il secret GitHub.
export async function persistSession(context) {
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.error(`[sessione tiktok] Sessione salvata in ${SESSION_PATH}.`);
}

export function readSessionSeedInstructions() {
  const json = readFileSync(SESSION_PATH, "utf-8");
  return Buffer.from(json).toString("base64");
}

// Contatori + caption di un singolo video. Ritorna sempre un record con
// `status`: chi chiama non deve distinguere fra "non c'è" e "è andata male".
export async function fetchVideoDetail(context, url) {
  const page = await context.newPage();
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
  { maxScroll = 300, giriSenzaNovita = 3, attesaMs = 1500 } = {},
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
export async function fetchAuthorVideos(context, handle, opzioni = {}) {
  const page = await context.newPage();
  const daXhr = new Set();
  // Diagnostica delle risposte item_list, non solo i video estratti: la
  // sonda originale (probe-tiktok-profile-videos.mjs) aveva scoperto così
  // che l'endpoint può rispondere HTTP 200 con corpo vuoto — indistinguibile
  // da "zero video" se ci si ferma al risultato finale.
  const xhr = [];

  page.on("response", async (res) => {
    if (!/\/api\/post\/item_list/.test(res.url())) return;
    const info = { status: res.status(), chiavi: null, items: null };
    try {
      const testo = await res.text();
      info.raw = testo.slice(0, 150);
      const body = JSON.parse(testo);
      info.chiavi = Object.keys(body).join(",");
      const lista = body?.itemList ?? [];
      info.items = lista.length;
      for (const item of lista) {
        const id = item?.id;
        const autore = item?.author?.uniqueId ?? handle;
        if (id) daXhr.add(`https://www.tiktok.com/@${autore}/video/${id}`);
      }
    } catch (err) {
      info.chiavi = `corpo illeggibile: ${String(err?.message ?? err).slice(0, 60)}`;
    }
    xhr.push(info);
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
      // Stessa diagnostica usata per le pagine hashtag (scrape-tiktok-
      // hashtag-deep.mjs), dove ha permesso di scoprire che il vero motivo
      // dietro "pagina vuota" con sessione autenticata era il captcha
      // anti-automazione di TikTok, non un problema di sessione: titolo e
      // URL da soli non bastavano a distinguerlo da un vero "zero video".
      const titolo = await page.title().catch(() => null);
      const urlFinale = page.url();
      const testo = await page
        .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "")
        .catch(() => "");
      const xhrRiassunto =
        xhr.length === 0
          ? "nessuna risposta item_list intercettata"
          : xhr
              .map(
                (r, i) =>
                  `#${i} HTTP ${r.status} items=${r.items} chiavi=${r.chiavi}` +
                  (r.items === null ? ` corpo="${r.raw}"` : ""),
              )
              .join(" | ");
      return {
        status: sembraLoginWall(titolo, page.url()) ? "login_wall" : "no_videos",
        reason:
          `titolo: ${String(titolo).slice(0, 80)} — url finale: ${urlFinale}` +
          (testo ? ` — testo pagina: "${testo}"` : "") +
          ` — item_list: ${xhrRiassunto}`,
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
