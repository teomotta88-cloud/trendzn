// Script diagnostico usa-e-getta: verifica cosa espone pubblicamente, SENZA
// login, la pagina "Trending" di X.com (x.com/explore/tabs/trending) a un
// visitatore anonimo — e, se passato un secondo argomento, la pagina di
// ricerca di un hashtag (x.com/search?q=%23<hashtag>). Serve a decidere se X
// è una fonte utilizzabile per la discovery di hashtag in trend e per il
// monitoraggio volumi/engagement dei post, PRIMA di costruirci una pipeline
// (stesso approccio "probe first" già usato per Instagram).
//
// X (ex Twitter) da tempo restringe pesantemente l'accesso anonimo: è molto
// probabile che la pagina rediriga al login. Questo probe serve proprio a
// confermarlo o smentirlo su dati reali, e nel caso a capire quali dati
// (nomi trend, volumi, post, contatori di engagement) siano leggibili.
//
// Uso:
//   node scripts/probe-x-trending.mjs                    # solo pagina trending
//   node scripts/probe-x-trending.mjs <hashtag>          # trending + ricerca #hashtag
//
// Nessun cookie/sessione di login: legge solo ciò che X mostra a un anonimo.

import { chromium } from "playwright";

const TRENDING_URL = "https://x.com/explore/tabs/trending";
const hashtagArg = process.argv[2]?.replace(/^#/, "") ?? null;

// Indizi che la pagina è finita su un muro di login invece del contenuto.
function detectLoginWall(finalUrl, bodyText) {
  const urlHit = /\/(login|i\/flow\/login|account\/access)/.test(finalUrl);
  const textHit =
    /(accedi a x|sign in to x|log in|iscriviti|create account|non perderti mai)/i.test(bodyText);
  return { urlHit, textHit, blocked: urlHit || textHit };
}

async function probe(page, label, url) {
  console.log(`\n\n########## ${label} ##########`);
  console.log(`Navigo verso: ${url}`);
  const response = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .catch((e) => {
      console.log("Errore di navigazione:", e.message);
      return null;
    });
  console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");

  // X carica tutto via JS: diamo tempo e scrolliamo per innescare il lazy load.
  await page.waitForTimeout(5000);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
  }

  const finalUrl = page.url();
  console.log("URL finale dopo navigazione/redirect:", finalUrl);

  const bodyText = await page.innerText("body").catch(() => "");
  const login = detectLoginWall(finalUrl, bodyText);
  console.log(
    `Login wall? ${login.blocked ? "SÌ" : "no"} (url-match: ${login.urlHit}, testo-match: ${login.textHit})`,
  );

  // Trend: X li rende con [data-testid="trend"]; ogni cella contiene nome +
  // spesso "N post"/"N mila post". Proviamo più selettori per robustezza.
  const trends = await page
    .$$eval('[data-testid="trend"]', (nodes) =>
      nodes.map((n) => n.innerText?.trim()).filter(Boolean),
    )
    .catch(() => []);
  console.log(`\n=== Elementi [data-testid="trend"] trovati: ${trends.length} ===`);
  console.log(JSON.stringify(trends.slice(0, 40), null, 2));

  // Post/tweet: article[data-testid="tweet"]; i contatori di engagement sono
  // in aria-label sui pulsanti reply/retweet/like/view.
  const tweets = await page
    .$$eval('article[data-testid="tweet"]', (nodes) =>
      nodes.slice(0, 10).map((a) => {
        const link = a.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? null;
        const engagementLabels = Array.from(
          a.querySelectorAll('[data-testid="like"],[data-testid="retweet"],[data-testid="reply"]'),
        )
          .map((b) => b.getAttribute("aria-label"))
          .filter(Boolean);
        const groupLabel = a.querySelector('[role="group"]')?.getAttribute("aria-label");
        return { link, engagementLabels, groupLabel };
      }),
    )
    .catch(() => []);
  console.log(`\n=== article[data-testid="tweet"] trovati (max 10): ${tweets.length} ===`);
  console.log(JSON.stringify(tweets, null, 2));

  // Link a /status/ (post) comunque presenti nel DOM, anche fuori da article.
  const statusLinks = await page
    .$$eval("a[href]", (nodes) =>
      nodes.map((n) => n.getAttribute("href")).filter((h) => h && /\/status\/\d+/.test(h)),
    )
    .catch(() => []);
  console.log(`\n=== Link a /status/<id> nel DOM: ${new Set(statusLinks).size} distinti ===`);
  console.log(JSON.stringify([...new Set(statusLinks)].slice(0, 20), null, 2));

  const meta = await page
    .$$eval("meta", (nodes) =>
      nodes
        .map((n) => ({
          property: n.getAttribute("property") || n.getAttribute("name"),
          content: n.getAttribute("content"),
        }))
        .filter((m) => m.property && /og:|description|title/i.test(m.property)),
    )
    .catch(() => []);
  console.log("\n=== Meta tag rilevanti ===");
  console.log(JSON.stringify(meta, null, 2));

  console.log("\n=== Primi 2500 caratteri del testo visibile ===");
  console.log(bodyText.slice(0, 2500));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "it-IT",
});

try {
  await probe(page, "PAGINA TRENDING", TRENDING_URL);
  if (hashtagArg) {
    await probe(
      page,
      `RICERCA #${hashtagArg}`,
      `https://x.com/search?q=${encodeURIComponent("#" + hashtagArg)}&f=top`,
    );
  }
} finally {
  await browser.close();
}
