// Script diagnostico usa-e-getta (stesso spirito di probe-instagram-post.mjs e
// probe-instagram-collab.mjs): apre la pagina profilo pubblica di un account
// Instagram con Playwright (visitatore anonimo, nessun login) e prova a
// scoprire QUANTI post della griglia riusciamo a vedere e QUANTO indietro nel
// tempo arriviamo prima che Instagram richieda il login — è la domanda che
// decide se un "check one-shot dell'ultimo anno" (vedi piano collab-detection)
// è davvero fattibile o va ridimensionato a "quanto Instagram lascia vedere
// senza login, poi si recupera il resto nei check giornalieri successivi".
//
// Uso: node scripts/probe-instagram-profile-feed.mjs <url-profilo-instagram>
//
// Nota ToS: come gli altri probe di questa famiglia, legge solo ciò che
// Instagram mostra pubblicamente a un visitatore anonimo — resta comunque una
// lettura automatizzata non prevista dai Termini di Servizio.

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/probe-instagram-profile-feed.mjs <url-profilo-instagram>");
  process.exit(1);
}

// Le date sono opzionali sui thumbnail della griglia (Instagram le mette
// nell'alt text solo per alcuni tipi di contenuto, vedi output). Copriamo
// inglese e italiano, stesso approccio di instagram-public-metrics.mjs.
const ALT_DATE_PATTERN =
  /\bon\s+([a-zàèéìòù]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[a-zàèéìòù]+\s+\d{4})/i;

async function isLoginWall(page) {
  return /\/(accounts\/login|challenge)/.test(page.url());
}

async function collectGridPosts(page) {
  return page.$$eval('a[href^="/"]', (nodes) =>
    nodes
      .map((n) => {
        const img = n.querySelector("img");
        return {
          href: n.getAttribute("href"),
          alt: img ? img.getAttribute("alt") : null,
        };
      })
      .filter((n) => n.href && /^\/[A-Za-z0-9._]+\/(p|reel)\/[^/]+\/?$/.test(n.href)),
  );
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

try {
  console.log(`Navigo verso: ${url}`);
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      console.log("Errore di navigazione:", e.message);
      return null;
    });
  console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
  console.log("URL finale:", page.url());

  if (await isLoginWall(page)) {
    console.log("\nBLOCCATO SUBITO: Instagram ha reindirizzato a login/challenge già sulla pagina profilo.");
    await browser.close();
    process.exit(0);
  }

  await page.waitForTimeout(3000);

  const meta = await page.$$eval("meta", (nodes) =>
    nodes
      .map((n) => ({
        property: n.getAttribute("property") || n.getAttribute("name"),
        content: n.getAttribute("content"),
      }))
      .filter((m) => m.property && /og:|description/i.test(m.property)),
  );
  console.log("\n=== Meta tag profilo (followers/post count spesso qui) ===");
  console.log(JSON.stringify(meta, null, 2));

  // Ciclo di scroll: dopo ogni scroll aspettiamo il caricamento, ricontiamo i
  // post trovati e controlliamo il login-wall. Ci fermiamo quando: il conteggio
  // smette di crescere per 3 scroll di fila (probabile fine contenuto
  // anonimo raggiungibile), oppure scatta il login-wall, oppure dopo un tetto
  // di sicurezza di scroll (per non restare bloccati all'infinito su un
  // account che continua a caricare).
  const MAX_SCROLLS = 40;
  const STALL_LIMIT = 3;
  let stallCount = 0;
  let lastCount = 0;
  let stoppedReason = "max-scrolls-reached";

  for (let i = 0; i < MAX_SCROLLS; i++) {
    if (await isLoginWall(page)) {
      stoppedReason = `login-wall-after-${i}-scrolls`;
      break;
    }

    const posts = await collectGridPosts(page);
    const uniqueHrefs = new Set(posts.map((p) => p.href));
    console.log(`Scroll ${i}: post unici finora = ${uniqueHrefs.size}`);

    if (uniqueHrefs.size === lastCount) {
      stallCount++;
      if (stallCount >= STALL_LIMIT) {
        stoppedReason = `stallo-dopo-${i}-scroll-nessuna-crescita`;
        break;
      }
    } else {
      stallCount = 0;
    }
    lastCount = uniqueHrefs.size;

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
  }

  console.log(`\n=== Motivo di stop: ${stoppedReason} ===`);

  const finalPosts = await collectGridPosts(page);
  const dedup = [...new Map(finalPosts.map((p) => [p.href, p])).values()];

  console.log(`\n=== Totale post distinti trovati nella griglia: ${dedup.length} ===`);

  const withDates = dedup
    .map((p) => {
      const m = p.alt?.match(ALT_DATE_PATTERN);
      return { href: p.href, alt: p.alt?.slice(0, 80) ?? null, rawDate: m ? m[1] : null };
    })
    .filter((p) => p.rawDate);

  console.log(`\n=== Thumbnail con una data leggibile nell'alt text: ${withDates.length}/${dedup.length} ===`);
  console.log(JSON.stringify(withDates, null, 2));

  console.log("\n=== Tutti gli href trovati (primi 60) ===");
  console.log(JSON.stringify(dedup.slice(0, 60).map((p) => p.href), null, 2));

  const bodyText = await page.innerText("body").catch(() => "");
  console.log("\n=== Primi 1500 caratteri del testo visibile (per capire se c'è un banner login/limite) ===");
  console.log(bodyText.slice(0, 1500));
} finally {
  await browser.close();
}
