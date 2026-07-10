// Script diagnostico usa-e-getta: apre una pagina di ricerca/hashtag di
// Instagram con Playwright (browser reale, esegue JS — un fetch semplice
// viene bloccato subito) e stampa tutto ciò che potrebbe contenere post o
// engagement: link a /p/ o /reel/, script con dati strutturati incorporati,
// JSON-LD, meta tag, testo visibile. Serve a capire se questa pagina è una
// fonte utilizzabile per la discovery di post virali per hashtag,
// alternativa/complementare alla ricerca via anysite — non è ancora usato
// da nessuna pipeline.
//
// Uso: node scripts/probe-instagram-hashtag.mjs <url-pagina-instagram>
//
// Nota: nessun cookie/sessione di login — legge solo ciò che Instagram mostra
// pubblicamente a un visitatore anonimo.

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/probe-instagram-hashtag.mjs <url-pagina-instagram>");
  process.exit(1);
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

  await page.waitForTimeout(4000);
  console.log("URL finale dopo navigazione/redirect:", page.url());

  // Scroll per innescare eventuale lazy loading dei risultati.
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(1500);
  }

  const postLinks = await page.$$eval("a[href]", (nodes) =>
    nodes
      .map((n) => n.getAttribute("href"))
      .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
  );
  console.log(`\n=== Link a post/reel trovati: ${postLinks.length} ===`);
  console.log(JSON.stringify([...new Set(postLinks)], null, 2));

  const scriptsData = await page.$$eval("script", (nodes) =>
    nodes
      .map((n) => ({ type: n.getAttribute("type"), text: n.textContent || "" }))
      .filter((s) => /shortcode|edge_hashtag|"pk":|hashtag/i.test(s.text))
      .map((s) => ({ type: s.type, snippet: s.text.slice(0, 1500) })),
  );
  console.log(`\n=== Script con dati potenzialmente utili: ${scriptsData.length} ===`);
  console.log(JSON.stringify(scriptsData, null, 2));

  const ldJson = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent),
  );
  console.log(`\n=== JSON-LD trovati: ${ldJson.length} ===`);
  for (const j of ldJson) {
    try {
      console.log(JSON.stringify(JSON.parse(j), null, 2).slice(0, 2000));
    } catch {
      console.log(j.slice(0, 500));
    }
  }

  const meta = await page.$$eval("meta", (nodes) =>
    nodes
      .map((n) => ({
        property: n.getAttribute("property") || n.getAttribute("name"),
        content: n.getAttribute("content"),
      }))
      .filter((m) => m.property && /og:|description/i.test(m.property)),
  );
  console.log("\n=== Meta tag rilevanti ===");
  console.log(JSON.stringify(meta, null, 2));

  const bodyText = await page.innerText("body").catch(() => "");
  console.log("\n=== Primi 3000 caratteri del testo visibile della pagina ===");
  console.log(bodyText.slice(0, 3000));
} finally {
  await browser.close();
}
