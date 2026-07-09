// Script diagnostico usa-e-getta: apre un singolo URL di post Instagram con
// Playwright (browser reale, esegue JS — a differenza di un fetch semplice,
// che Instagram blocca subito) e stampa tutto ciò che potrebbe contenere il
// numero di like/commenti: JSON-LD strutturato, meta tag OpenGraph, e il
// testo visibile della pagina. Serve a capire QUALE fonte è più stabile
// prima di scrivere l'estrazione vera — non è ancora usato da nessuna pipeline.
//
// Uso: node scripts/probe-instagram-post.mjs <url-post-instagram>
//
// Nota: qui NON si usa nessun cookie/sessione di login — legge solo ciò che
// Instagram mostra pubblicamente a un visitatore anonimo (funziona solo per
// account non privati, come i post che la pipeline Trend Virali già trova
// via ricerca anysite).

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/probe-instagram-post.mjs <url-post-instagram>");
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

  await page.waitForTimeout(3000);

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

  // Cerca elementi il cui testo somiglia a un numero (like/commenti visibili)
  const numberish = await page.$$eval("section, span, a", (nodes) =>
    nodes
      .map((n) => n.textContent?.trim())
      .filter((t) => t && /^[\d.,]+\s*(mila|mln|k|m)?$/i.test(t) && t.length < 12),
  );
  console.log("\n=== Testi che somigliano a numeri (candidati like/commenti) ===");
  console.log(JSON.stringify([...new Set(numberish)], null, 2));

  const bodyText = await page.innerText("body").catch(() => "");
  console.log("\n=== Primi 3000 caratteri del testo visibile della pagina ===");
  console.log(bodyText.slice(0, 3000));
} finally {
  await browser.close();
}
