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
import { applyEngagement } from "./lib/tiktok-engagement.mjs";
import { createTikTokContext, fetchVideoDetail } from "./lib/tiktok-page.mjs";

// 3, non 1: engagementData è lo stesso campo che usava lo script Emplifi, che
// è arrivato a version 2. Il driver considera "già fatto" un record con status
// e version >= VERSION, quindi partire da 1 lascerebbe per sempre i record
// Emplifi — inclusi i 120 "not_found" sbagliati della sua ultima run — senza
// mai riprovarli da questa fonte.
const VERSION = 3;

const DELAY_MS = Number.parseInt(process.env.DELAY_MS ?? "", 10) || 1200;
const OVERWRITE_EXISTING = process.env.OVERWRITE_EXISTING === "true";

// Sia /video/ che /photo/: gli slideshow di foto hanno la stessa pagina e lo
// stesso itemStruct dei video, quindi gli stessi contatori.
const TIKTOK_POST = /tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i;

// Solo i BSConfirmed, come faceva lo script Emplifi: gli altri sono omonimie
// raccolte dagli hashtag (hotel Serena in Uganda, Pakistan...) e non entrano
// nelle statistiche della pagina. Senza questo filtro la coda passa da 338 a
// 1310 post — lo store contiene solo post TikTok della finestra lug-ago,
// quindi è `verificationStatus` a fare tutta la selezione, non la data.
// Un post che diventa confirmed più avanti (bulk-verify gira ogni settimana)
// non ha ancora un record e viene preso alla run successiva, da solo.
const isConfirmedTikTok = (account) =>
  account.verificationStatus === "confirmed" && TIKTOK_POST.test(account.url ?? "");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const browser = await chromium.launch({ headless: true });
const context = await createTikTokContext(browser);

try {
  await runEnrichment({
    field: "engagementData",
    version: VERSION,
    title: "KPI engagement TikTok dalla pagina del video",
    commitMessage: (n) => `chore: KPI engagement da pagina TikTok su ${n} post [trendzn-bot]`,
    select: isConfirmedTikTok,
    apply: (account, record) => applyEngagement(account, record, { overwrite: OVERWRITE_EXISTING }),
    processPost: async (account) => {
      const record = await fetchVideoDetail(context, account.url);
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
  await context.close().catch(() => {});
  await browser.close();
}
