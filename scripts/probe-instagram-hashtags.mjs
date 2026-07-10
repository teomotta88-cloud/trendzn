// Script diagnostico usa-e-getta: ripete la stessa sonda di
// probe-instagram-hashtag.mjs su più hashtag in una sola sessione di
// browser, per confrontare i risultati fianco a fianco. Serve a capire se
// il redirect /explore/tags/<tag>/ -> /popular/<tag>/ (che espone link a
// reel reali senza login) è un comportamento stabile o un caso isolato, e
// se il numero che compare accanto a ogni autore è coerente con un
// follower count piuttosto che con l'engagement del singolo post.
//
// Uso: node scripts/probe-instagram-hashtags.mjs "tag1,tag2,tag3"
//   (senza #, separati da virgola — es: "whattoeat,foodtiktok,recipe")
//
// Nota: nessun cookie/sessione di login — legge solo ciò che Instagram
// mostra pubblicamente a un visitatore anonimo.

import { chromium } from "playwright";

const raw = process.argv[2];
if (!raw) {
  console.error('Uso: node scripts/probe-instagram-hashtags.mjs "tag1,tag2,tag3"');
  process.exit(1);
}

const hashtags = raw
  .split(",")
  .map((s) => s.trim().replace(/^#/, ""))
  .filter(Boolean);

if (hashtags.length === 0) {
  console.error("Nessun hashtag valido fornito.");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

try {
  for (const tag of hashtags) {
    const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
    console.log(`\n\n########## #${tag} ##########`);
    console.log(`Navigo verso: ${url}`);

    const page = await context.newPage();
    try {
      const response = await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch((e) => {
          console.log("Errore di navigazione:", e.message);
          return null;
        });
      console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");

      await page.waitForTimeout(4000);
      console.log("URL finale dopo navigazione/redirect:", page.url());

      const postLinks = await page.$$eval("a[href]", (nodes) =>
        nodes
          .map((n) => n.getAttribute("href"))
          .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
      );
      const uniqueLinks = [...new Set(postLinks)];
      console.log(`Link a post/reel trovati: ${uniqueLinks.length}`);
      console.log(JSON.stringify(uniqueLinks, null, 2));

      const bodyText = await page.innerText("body").catch(() => "");
      console.log("--- Primi 3000 caratteri del testo visibile ---");
      console.log(bodyText.slice(0, 3000));
    } finally {
      await page.close();
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
} finally {
  await browser.close();
}
