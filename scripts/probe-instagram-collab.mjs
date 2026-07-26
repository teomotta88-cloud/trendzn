// Script diagnostico usa-e-getta (stesso spirito di probe-instagram-post.mjs):
// apre un singolo URL di post Instagram con Playwright (browser reale, non un
// fetch semplice — Instagram lo blocca subito) e stampa TUTTO ciò che
// potrebbe rivelare se il post è un "collab" (co-autore, la feature nativa di
// Instagram in cui due account risultano entrambi autori del post — icona
// doppia, "<utente1> e <utente2>" nell'header). Nessuna pipeline lo usa
// ancora: serve solo a capire, con dati reali, QUALI segnali sono presenti e
// affidabili prima di scrivere l'estrazione vera.
//
// Uso: node scripts/probe-instagram-collab.mjs <url-post-instagram>
//
// Nota ToS: come instagram-public-metrics.mjs, legge solo ciò che Instagram
// mostra pubblicamente a un visitatore anonimo (nessun login/sessione) — resta
// comunque una lettura automatizzata non prevista dai Termini di Servizio.
//
// Perché non basta og:description/JSON-LD (già usati per like/commenti in
// instagram-public-metrics.mjs): quei campi riportano tipicamente UN solo
// nome autore, quello dell'account "principale". Il collab, quando esiste,
// va cercato nell'header visivo del post (doppio avatar + "utente1 e
// utente2"), che qui proviamo a leggere dal DOM — da verificare con un post
// reale, perché non è documentato da Instagram.

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/probe-instagram-collab.mjs <url-post-instagram>");
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
  console.log("URL finale:", page.url());

  if (/\/(accounts\/login|challenge)/.test(page.url())) {
    console.log("\nBLOCCATO: Instagram ha reindirizzato a login/challenge, nessun dato leggibile anonimamente.");
  }

  await page.waitForTimeout(3000);

  // --- 1. JSON-LD: a volte contiene un campo "author" ---
  const ldJson = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent),
  );
  console.log(`\n=== JSON-LD trovati: ${ldJson.length} ===`);
  for (const j of ldJson) {
    try {
      console.log(JSON.stringify(JSON.parse(j), null, 2).slice(0, 3000));
    } catch {
      console.log(j.slice(0, 1000));
    }
  }

  // --- 2. Meta tag (og:title/og:description contengono di solito UN autore:
  // "<autore> on Instagram: <N> likes, <N> comments - ...") ---
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

  console.log("\n=== <title> ===");
  console.log(await page.title());

  // --- 3. Link a profilo (href tipo /username/) trovati in TUTTA la pagina,
  // con il testo associato e l'offset verticale (top): i link dell'header
  // del post (autore/i) sono quelli più vicini all'inizio della pagina,
  // prima della didascalia e dei commenti — utile per distinguerli dai link
  // a profili suggeriti/commentatori più in basso. ---
  const profileLinks = await page.$$eval('a[href^="/"]', (nodes) =>
    nodes
      .map((n) => {
        const rect = n.getBoundingClientRect();
        return {
          href: n.getAttribute("href"),
          text: n.textContent?.trim(),
          top: Math.round(rect.top),
        };
      })
      .filter((n) => n.href && /^\/[A-Za-z0-9._]+\/?$/.test(n.href)),
  );
  const seen = new Set();
  const dedup = profileLinks.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
  dedup.sort((a, b) => a.top - b.top);
  console.log("\n=== Link a profilo trovati (ordinati per posizione verticale) ===");
  console.log(JSON.stringify(dedup.slice(0, 15), null, 2));

  // --- 4. Contenuto del primo elemento <header> (se esiste): nell'interfaccia
  // Instagram è la barra in cima al post con avatar+username+"···" — il posto
  // più probabile dove cercare "utente1 e utente2" o un doppio avatar. ---
  const headerInfo = await page
    .$eval("header", (el) => ({
      text: el.textContent?.trim().slice(0, 500),
      html: el.innerHTML.slice(0, 4000),
    }))
    .catch(() => null);
  console.log("\n=== Contenuto del primo <header> trovato ===");
  console.log(headerInfo ? JSON.stringify(headerInfo, null, 2) : "(nessun <header> trovato)");

  // --- 5. Testo alt delle immagini vicino all'inizio (Instagram a volte
  // genera alt text descrittivi tipo "Photo by X on ...", "Photo shared by
  // X and Y") ---
  const altTexts = await page.$$eval("img", (nodes) =>
    nodes.map((n) => n.getAttribute("alt")).filter(Boolean).slice(0, 10),
  );
  console.log("\n=== Alt text delle immagini (prime 10) ===");
  console.log(JSON.stringify(altTexts, null, 2));

  // --- 6. Testo visibile grezzo, primi 3000 caratteri ---
  const bodyText = await page.innerText("body").catch(() => "");
  console.log("\n=== Primi 3000 caratteri del testo visibile della pagina ===");
  console.log(bodyText.slice(0, 3000));

  // --- 7. Verdetto EURISTICO, da validare con dati reali ---
  // Ipotesi da confermare: se ci sono >= 2 link a profilo distinti "in cima"
  // (entro i primi ~600px, sopra la didascalia/i commenti) è probabile un
  // collab; con 1 solo è un post normale. La soglia 600 e la definizione di
  // "in cima" vanno tarate guardando l'output qui sopra su post reali (uno
  // sicuramente in collab, uno sicuramente no) prima di fidarsi di questo
  // numero.
  const topProfiles = dedup.filter((p) => p.top < 600 && p.top > -50);
  console.log("\n=== Verdetto euristico (SPERIMENTALE, da tarare) ===");
  console.log(`Profili distinti entro i primi 600px: ${topProfiles.length}`);
  console.log(JSON.stringify(topProfiles, null, 2));
  console.log(
    topProfiles.length >= 2
      ? "→ Possibile COLLAB (più di un account nell'header) — verificare a occhio."
      : "→ Probabile autore singolo — verificare a occhio.",
  );
} finally {
  await browser.close();
}
