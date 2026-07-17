// Script diagnostico usa-e-getta: apre la pagina pubblica di una Pagina
// Facebook SENZA login (browser reale via Playwright, serve JS: un fetch
// semplice viene bloccato subito) e prova a recuperare i post visibili prima
// del login-wall non chiudibile.
//
// Comportamento osservato su facebook.com/<pagina>:
// 1. Al caricamento appare un popup di login CHIUDIBILE (bottone "Chiudi").
// 2. Dopo un po' di scroll ne appare un secondo, NON chiudibile, che blocca
//    ulteriori caricamenti — ma i post già arrivati nel DOM restano leggibili.
//
// Quindi: chiudiamo il primo popup, scrolliamo un numero limitato di volte
// per caricare più post possibile, ci fermiamo quando rileviamo il wall
// definitivo (o dopo N tentativi), poi leggiamo dal DOM tutto ciò che
// somiglia a un post: link permalink, testo, data visibile, media.
//
// Fase 2 (enrichment): per i primi post trovati, apriamo il permalink diretto
// e controlliamo se espone JSON-LD / meta og: più puliti (stesso approccio già
// usato in probe-instagram-post.mjs).
//
// Uso: node scripts/probe-facebook-page.mjs <url-pagina-facebook>

import { chromium } from "playwright";

const pageUrl = process.argv[2] || "https://www.facebook.com/AssociazioneMiDimostro";
const MAX_SCROLLS = 6;
const SCROLL_WAIT_MS = 2200;

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

  return articles.map((el, idx) => {
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

    const permalinkHref = permalinkEl ? permalinkEl.href : null;
    const dateText = permalinkEl
      ? (permalinkEl.getAttribute("aria-label") || permalinkEl.textContent || "").trim()
      : null;

    // Testo del post: cerchiamo il blocco con più testo "leggibile" (non link
    // singoli tipo "Mi piace"/"Commenta"), tipicamente div[dir="auto"].
    const textCandidates = Array.from(el.querySelectorAll('div[dir="auto"]'))
      .map((n) => n.textContent?.trim() || "")
      .filter((t) => t.length > 20);
    const copy = textCandidates.sort((a, b) => b.length - a.length)[0] || null;

    const img = el.querySelector("img[src]");
    const video = el.querySelector("video");

    return {
      index: idx,
      permalinkHref,
      dateText,
      copy: copy ? copy.slice(0, 300) : null,
      mediaImage: img ? img.src : null,
      hasVideo: !!video,
      rawTextLength: el.textContent?.length ?? 0,
    };
  });
}

async function probeIndexPage(browser) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 1400 },
    locale: "it-IT",
  });

  log(`Navigo verso: ${pageUrl}`);
  const response = await page
    .goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      log("Errore di navigazione:", e.message);
      return null;
    });
  log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
  await page.waitForTimeout(2500);

  log("\nProvo a chiudere il popup di login iniziale...");
  await tryCloseFirstPopup(page);

  let scrolls = 0;
  while (scrolls < MAX_SCROLLS) {
    const blocked = await hasBlockingWall(page);
    if (blocked) {
      log(`Wall non chiudibile rilevato dopo ${scrolls} scroll — mi fermo.`);
      break;
    }
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(SCROLL_WAIT_MS);
    scrolls++;
    log(`  scroll #${scrolls} eseguito`);
  }

  const finalBlocked = await hasBlockingWall(page);
  log(`\nWall bloccante presente a fine scroll: ${finalBlocked}`);

  const posts = await page.evaluate(extractPosts);
  log(`\n=== Post individuati nel DOM: ${posts.length} ===`);
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
  log("\n=== Meta tag della pagina (og:) ===");
  log(JSON.stringify(pageMeta, null, 2));

  await page.close();
  return posts.filter((p) => p.permalinkHref);
}

async function probePermalink(browser, url, label) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "it-IT",
  });

  log(`\n--- Enrichment: apro permalink [${label}] ---`);
  log(url);
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      log("Errore di navigazione:", e.message);
      return null;
    });
  log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
  await page.waitForTimeout(2000);
  await tryCloseFirstPopup(page);

  const ldJson = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent),
  );
  log(`JSON-LD trovati: ${ldJson.length}`);
  for (const j of ldJson) {
    try {
      log(JSON.stringify(JSON.parse(j), null, 2).slice(0, 1500));
    } catch {
      log(j.slice(0, 400));
    }
  }

  const meta = await page.$$eval("meta", (nodes) =>
    nodes
      .map((n) => ({
        property: n.getAttribute("property") || n.getAttribute("name"),
        content: n.getAttribute("content"),
      }))
      .filter((m) => m.property && /og:|article:|description|published/i.test(m.property)),
  );
  log("Meta tag rilevanti:");
  log(JSON.stringify(meta, null, 2));

  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  const posts = await probeIndexPage(browser);

  const toEnrich = posts.slice(0, 3);
  for (const p of toEnrich) {
    await probePermalink(browser, p.permalinkHref, `post #${p.index}`);
  }

  log("\n=== Fine probe ===");
} finally {
  await browser.close();
}
