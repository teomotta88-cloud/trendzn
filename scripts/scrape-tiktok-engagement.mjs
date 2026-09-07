// Recupera views/like/commenti/condivisioni dei post TikTok Bluserena
// leggendoli dalla PAGINA DEL SINGOLO VIDEO, che li incorpora già nel JSON di
// idratazione (script#__UNIVERSAL_DATA_FOR_REHYDRATION__ ->
// __DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.stats).
//
// Sostituisce il tentativo via Emplifi Listening (scrape-engagement-batch.mjs):
// quella strada costa crediti, espone solo commenti/condivisioni e — sui dati
// veri — indicizza Instagram/Facebook, mentre i post da arricchire sono tutti
// TikTok. Qui la fonte è la pagina del video stesso: gratis, per-post, con
// tutte e quattro le metriche, e funziona anche sui post nuovi.
//
// Costo: solo minuti Actions. Il driver condiviso (lib/bluserena-enrich.mjs,
// lo stesso di OCR e trascrizione audio) dà budget di run, commit
// incrementali, ripresa e freno sui fallimenti consecutivi, quindi la coda si
// smaltisce su più run senza rifare ogni volta gli stessi post.
//
// RISCHIO NOTO: login-wall dagli IP datacenter. Senza uno User-Agent da
// browser vero TikTok serve la schermata di login al posto del video — è già
// successo in sync-bluserena-hashtags.mjs (15/15 caption a null), risolto con
// lo stesso REAL_CHROME_UA usato qui. Non è verificabile dall'ambiente di
// sviluppo, dove la policy di rete nega tiktok.com: per questo lo status
// "login_wall" è distinto dagli altri errori. Se il primo run reale lo
// restituisce in serie, il freno del driver ferma tutto dopo 10 post
// consecutivi e il log dice esattamente cosa è successo, invece di marcare
// centinaia di post come tentati e falliti. In quel caso restano i cookie di
// sessione (TIKTOK_MS_TOKEN, TIKTOK_CC_*) già presenti nei secret.
//
// Env:
//   GITHUB_TOKEN: obbligatoria
//   MAX_POSTS / MAX_MINUTES / BATCH_SIZE / FAIL_STREAK: budget (vedi driver)
//   REPROCESS_FAILED: riprova i post con status != "ok"
//   OVERWRITE_EXISTING: sovrascrivi anche i KPI già presenti da altre fonti
//   DRY_RUN: fa il lavoro ma non scrive
//   DELAY_MS: pausa tra un video e l'altro (default 1200)

import { chromium } from "playwright";

import { runEnrichment } from "./lib/bluserena-enrich.mjs";
import { applyEngagement, readVideoDetail } from "./lib/tiktok-engagement.mjs";

// 3, non 1: engagementData è lo stesso campo che usava lo script Emplifi, che
// è arrivato a version 2. Il driver considera "già fatto" un record con status
// e version >= VERSION, quindi partire da 1 lascerebbe per sempre i record
// Emplifi — inclusi i 120 "not_found" sbagliati della sua ultima run — senza
// mai riprovarli da questa fonte.
const VERSION = 3;

// Senza uno User-Agent "da browser vero" TikTok serve la pagina di login al
// posto del video: verificato in sync-bluserena-hashtags.mjs, dove la caption
// risultava null su 15/15 post con lo UA headless di default. Stesso UA già
// usato con successo per la pagina hashtag in scrape-tiktok-hashtag.mjs.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DELAY_MS = Number.parseInt(process.env.DELAY_MS ?? "", 10) || 1200;
const OVERWRITE_EXISTING = process.env.OVERWRITE_EXISTING === "true";

// Sia /video/ che /photo/: gli slideshow di foto hanno la stessa pagina e lo
// stesso itemStruct dei video, quindi gli stessi contatori.
const TIKTOK_POST = /tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapePost(browser, url) {
  const page = await browser.newPage({ userAgent: REAL_CHROME_UA });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const raw = await page
      .$eval("#__UNIVERSAL_DATA_FOR_REHYDRATION__", (el) => el.textContent)
      .catch(() => null);

    if (!raw) {
      // Nessuno script di idratazione: quasi sempre è il login-wall. Titolo e
      // URL finale lo dicono, e servono a distinguerlo da un guasto vero.
      const title = await page.title().catch(() => null);
      const finalUrl = page.url();
      const isLogin = /log ?in|accedi/i.test(title ?? "") || /\/login/.test(finalUrl);
      return {
        status: isLogin ? "login_wall" : "no_data",
        reason: `titolo: ${String(title).slice(0, 80)}`,
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

const browser = await chromium.launch({ headless: true });

try {
  await runEnrichment({
    field: "engagementData",
    version: VERSION,
    title: "KPI engagement TikTok dalla pagina del video",
    commitMessage: (n) => `chore: KPI engagement da pagina TikTok su ${n} post [trendzn-bot]`,
    select: (account) => TIKTOK_POST.test(account.url ?? ""),
    apply: (account, record) => applyEngagement(account, record, { overwrite: OVERWRITE_EXISTING }),
    processPost: async (account) => {
      const record = await scrapePost(browser, account.url);
      if (record.status === "ok") {
        console.log(
          `  views=${record.views ?? "-"} likes=${record.likes ?? "-"} ` +
            `commenti=${record.comments ?? "-"} condivisioni=${record.shares ?? "-"}`,
        );
      } else {
        console.log(`  ${record.status}: ${record.reason ?? ""}`);
      }
      await sleep(DELAY_MS);
      return record;
    },
  });
} finally {
  await browser.close();
}
