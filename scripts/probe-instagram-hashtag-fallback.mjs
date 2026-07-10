// Script diagnostico usa-e-getta: quando /explore/tags/<hashtag>/ finisce
// su login wall invece che sulla popular page (vedi
// probe-instagram-hashtags.mjs — non è garantito su tutti gli hashtag),
// prova strutture URL alternative, diverse da /popular/<hashtag>/, per
// capire se esiste un percorso più affidabile per lo stesso hashtag.
//
// Uso: node scripts/probe-instagram-hashtag-fallback.mjs <hashtag>
//   (senza #)
//
// Nota: nessun cookie/sessione di login.

import { chromium } from "playwright";

const tag = process.argv[2];
if (!tag) {
  console.error("Uso: node scripts/probe-instagram-hashtag-fallback.mjs <hashtag>");
  process.exit(1);
}

const candidates = [
  {
    label: "explore/tags (baseline, per confronto)",
    url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
  },
  {
    label: "legacy __a=1 JSON",
    url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/?__a=1&__d=dis`,
  },
  {
    label: "web/search/topsearch JSON",
    url: `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent("#" + tag)}`,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});

try {
  for (const c of candidates) {
    console.log(`\n\n########## ${c.label} ##########`);
    console.log(`Navigo verso: ${c.url}`);

    const page = await context.newPage();
    try {
      const response = await page
        .goto(c.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch((e) => {
          console.log("Errore di navigazione:", e.message);
          return null;
        });
      console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");
      console.log("Content-Type:", response ? response.headers()["content-type"] : "(sconosciuto)");

      await page.waitForTimeout(3000);
      console.log("URL finale dopo navigazione/redirect:", page.url());

      const isLoginWall = page.url().includes("/accounts/login");
      console.log("Login wall:", isLoginWall);

      if (!isLoginWall) {
        const postLinks = await page.$$eval("a[href]", (nodes) =>
          nodes
            .map((n) => n.getAttribute("href"))
            .filter((h) => h && (/^\/p\//.test(h) || /^\/reel\//.test(h))),
        );
        console.log(`Link a post/reel trovati: ${[...new Set(postLinks)].length}`);
      }

      const bodyText = await page.innerText("body").catch(() => "");
      console.log("--- Primi 1500 caratteri del testo/JSON restituito ---");
      console.log(bodyText.slice(0, 1500));
    } finally {
      await page.close();
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
} finally {
  await browser.close();
}
