// Script diagnostico usa-e-getta: apre la pagina pubblica di una Pagina
// Facebook SENZA login (browser reale via Playwright, serve JS: un fetch
// semplice viene bloccato subito) e prova a recuperare i post visibili prima
// del login-wall non chiudibile.
//
// Comportamento osservato su facebook.com/<pagina>:
// 1. Al caricamento appare un popup di login CHIUDIBILE (bottone "Chiudi").
// 2. Dopo un po' di scroll ne appare un secondo, NON chiudibile, che blocca
//    ulteriori caricamenti — ma i post già arrivati nel DOM restano leggibili
//    (in alcune run il wall non compare affatto entro MAX_SCROLLS).
//
// V2, dopo la prima run reale (6 scroll → un solo post utile su 3 elementi
// [role="article"] trovati, gli altri 2 erano widget vuoti, non post):
// - MAX_SCROLLS alzato e attese più lunghe: il caricamento lazy in headless
//   sembra più lento che in un browser reale.
// - navigator.webdriver mascherato: Facebook potrebbe limitare
//   deliberatamente il contenuto mostrato a browser riconosciuti come
//   automatizzati (pagina comunque pubblica, nessun bypass di login/paywall).
// - L'enrichment sul permalink è stato rimosso: nella run reale non ha
//   prodotto nulla (0 JSON-LD, 0 meta) — i dati buoni (permalink, data,
//   copy, immagine del post) arrivano tutti dalla pagina indice.
// - extractPosts ora scarta direttamente gli elementi senza permalink, così
//   il conteggio riportato è quello dei post reali, non del rumore ARIA.
//
// Uso: node scripts/probe-facebook-page.mjs <url-pagina-facebook>

import { chromium } from "playwright";

const pageUrl = process.argv[2] || "https://www.facebook.com/AssociazioneMiDimostro";
const MAX_SCROLLS = 20;
const SCROLL_WAIT_MS = 3000;

function log(...args) {
  console.log(...args);
}

async function tryCloseFirstPopup(page) {
  const closeSelectors = [
    '[aria-label="Chiudi"]',
    '[aria-label="Close"]',
    'div[role="dialog"] [aria-label="Chiudi"]',
    'div[role="dialog"] [aria-label="Close"]',
  ];
  for (const sel of closeSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      log(`  trovato bottone chiudi popup: ${sel}`);
      await btn.click({ timeout: 3000 }).catch((e) => log("  click fallito:", e.message));
      await page.waitForTimeout(800);
      return true;
    }
  }
  // Fallback: Escape
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

// Il secondo wall (non chiudibile) di solito copre la metà inferiore dello
// schermo con un CTA "Accedi"/"Registrati" fisso. Lo rileviamo cercando un
// dialog visibile che NON ha bottone di chiusura.
async function hasBlockingWall(page) {
  const dialogs = await page.$$('div[role="dialog"]');
  for (const d of dialogs) {
    const visible = await d.isVisible().catch(() => false);
    if (!visible) continue;
    const hasClose = await d
      .$('[aria-label="Chiudi"], [aria-label="Close"]')
      .then((el) => !!el)
      .catch(() => false);
    if (!hasClose) return true;
  }
  return false;
}

function extractPosts() {
  // Eseguito nel browser (page.evaluate): FB usa classi generate/offuscate,
  // quindi ci basiamo su ruoli/attributi ARIA e pattern di URL, non su classi.
  const POST_URL_RE = /\/(posts|videos|reel|photos|watch|permalink\.php)\b|story_fbid=/i;

  const articles = Array.from(document.querySelectorAll('[role="article"]'));

  const posts = [];
  for (const el of articles) {
    const links = Array.from(el.querySelectorAll("a[href]"));

    // Il link permalink è quello (spesso vicino all'header) il cui href
    // contiene un pattern da post ed è relativamente corto (non un link a
    // profilo/commento specifico).
    let permalinkEl = null;
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      if (POST_URL_RE.test(href)) {
        permalinkEl = a;
        break;
      }
    }

    // Scartiamo subito gli elementi [role="article"] senza permalink: sono
    // widget/placeholder che condividono il ruolo ARIA ma non sono post
    // (osservato nella prima run: 2 elementi su 3 erano completamente vuoti).
    if (!permalinkEl) continue;

    const permalinkHref = permalinkEl.href;
    const dateText = (
      permalinkEl.getAttribute("aria-label") ||
      permalinkEl.textContent ||
      ""
    ).trim();

    // Testo del post: cerchiamo il blocco con più testo "leggibile" (non link
    // singoli tipo "Mi piace"/"Commenta"), tipicamente div[dir="auto"].
    const textCandidates = Array.from(el.querySelectorAll('div[dir="auto"]'))
      .map((n) => n.textContent?.trim() || "")
      .filter((t) => t.length > 20);
    const copy = textCandidates.sort((a, b) => b.length - a.length)[0] || null;

    const img = el.querySelector("img[src]");
    const video = el.querySelector("video");

    posts.push({
      index: posts.length,
      permalinkHref,
      dateText,
      copy: copy ? copy.slice(0, 300) : null,
      mediaImage: img ? img.src : null,
      hasVideo: !!video,
      rawTextLength: el.textContent?.length ?? 0,
    });
  }
  return posts;
}

// Diagnostica testuale sullo stato della pagina in un dato momento: titolo,
// quanti dialog ARIA sono presenti (visibili/chiudibili o no), e un estratto
// del testo visibile — utile a distinguere "nessun post caricato" da "la
// pagina sta mostrando un wall/errore che il codice non riconosce ancora".
async function logPageDiagnostics(page, label) {
  const info = await page
    .evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      return {
        title: document.title,
        dialogCount: dialogs.length,
        dialogsVisible: dialogs.filter((d) => d.getClientRects().length > 0).length,
        articleCount: document.querySelectorAll('[role="article"]').length,
        bodySnippet: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
      };
    })
    .catch(() => null);

  if (!info) {
    log(`  [diagnostica: ${label}] valutazione pagina fallita`);
    return;
  }
  log(`  [diagnostica: ${label}]`);
  log(`    titolo pagina: ${info.title}`);
  log(`    dialog ARIA: ${info.dialogCount} (${info.dialogsVisible} visibili)`);
  log(`    elementi [role="article"]: ${info.articleCount}`);
  log(`    testo visibile (primi 400 char): ${info.bodySnippet}`);
}

async function probeIndexPage(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 1400 },
    locale: "it-IT",
  });

  // Maschera i segnali più comuni di automazione: Facebook potrebbe
  // mostrare meno contenuto (o caricarlo più lentamente) a un browser
  // riconosciuto come headless/Playwright. La pagina resta comunque
  // pubblica: non aggiriamo nessun login, solo la rilevazione del bot.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["it-IT", "it", "en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });

  const page = await context.newPage();

  log(`Navigo verso: ${pageUrl}`);
  const response = await page
    .goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      log("Errore di navigazione:", e.message);
      return null;
    });
  log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
  await page.waitForTimeout(2500);

  await logPageDiagnostics(page, "subito dopo il caricamento");
  await page
    .screenshot({ path: "probe-facebook-01-caricamento.png", fullPage: false })
    .catch((e) => {
      log("Screenshot fallito:", e.message);
    });

  log("\nProvo a chiudere il popup di login iniziale...");
  const closed = await tryCloseFirstPopup(page);
  if (!closed) {
    log("  nessun popup chiudibile trovato con i selettori noti.");
  }
  await page.waitForTimeout(1000);
  await logPageDiagnostics(page, "dopo il tentativo di chiusura popup");
  await page
    .screenshot({ path: "probe-facebook-02-dopo-popup.png", fullPage: false })
    .catch((e) => {
      log("Screenshot fallito:", e.message);
    });

  let scrolls = 0;
  let lastPostCount = 0;
  let stagnantRounds = 0;

  while (scrolls < MAX_SCROLLS) {
    const blocked = await hasBlockingWall(page);
    if (blocked) {
      log(`Wall non chiudibile rilevato dopo ${scrolls} scroll — mi fermo.`);
      break;
    }
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(SCROLL_WAIT_MS);
    scrolls++;

    const currentCount = await page.evaluate(extractPosts).then((p) => p.length);
    log(`  scroll #${scrolls} eseguito — post reali nel DOM finora: ${currentCount}`);

    // Se per 4 scroll di fila non arrivano nuovi post, probabilmente non ce
    // ne sono altri da caricare (o siamo bloccati in altro modo): ci
    // fermiamo prima di MAX_SCROLLS invece di continuare a vuoto.
    if (currentCount === lastPostCount) {
      stagnantRounds++;
      if (stagnantRounds >= 4) {
        log(`  nessun nuovo post dopo ${stagnantRounds} scroll consecutivi — mi fermo.`);
        break;
      }
    } else {
      stagnantRounds = 0;
      lastPostCount = currentCount;
    }
  }

  const finalBlocked = await hasBlockingWall(page);
  log(`\nWall bloccante presente a fine scroll: ${finalBlocked}`);
  await logPageDiagnostics(page, "a fine scroll");
  await page
    .screenshot({ path: "probe-facebook-03-fine-scroll.png", fullPage: false })
    .catch((e) => {
      log("Screenshot fallito:", e.message);
    });

  const posts = await page.evaluate(extractPosts);
  log(`\n=== Post reali individuati nel DOM: ${posts.length} ===`);
  for (const p of posts) {
    log(`\n#${p.index}`);
    log("  permalink:", p.permalinkHref);
    log("  data (testo visibile):", p.dateText);
    log("  copy:", p.copy);
    log("  media immagine:", p.mediaImage);
    log("  ha video:", p.hasVideo);
    log("  lunghezza testo grezzo elemento:", p.rawTextLength);
  }

  const pageMeta = await page.$$eval("meta", (nodes) =>
    nodes
      .map((n) => ({
        property: n.getAttribute("property") || n.getAttribute("name"),
        content: n.getAttribute("content"),
      }))
      .filter((m) => m.property && /og:|description/i.test(m.property)),
  );
  log("\n=== Meta tag della pagina (og:, solo informativi — non per-post) ===");
  log(JSON.stringify(pageMeta, null, 2));

  await context.close();
  return posts;
}

const browser = await chromium.launch({ headless: true });
try {
  await probeIndexPage(browser);
  log("\n=== Fine probe ===");
} finally {
  await browser.close();
}
