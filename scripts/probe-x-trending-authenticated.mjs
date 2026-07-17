// Script diagnostico usa-e-getta: probe-x-trending.mjs ha confermato che
// x.com/explore/tabs/trending redirige al login per un visitatore anonimo.
// Questo probe riprova DA LOGGATI, riusando lo stesso account X dedicato già
// in produzione per ASPI-monitoring (secret RETTIWT_API_KEY) — nessun nuovo
// account/secret necessario.
//
// RETTIWT_API_KEY non è una "API key" in senso stretto: rettiwt-api la
// costruisce come i cookie reali dell'account loggato (auth_token, ct0,
// twid, ...) codificati in base64 (vedi AuthService.decodeCookie in
// node_modules/rettiwt-api/dist/services/internal/AuthService.js). Qui la
// decodifichiamo e iniettiamo gli stessi cookie in un browser Playwright
// vero, per visitare la pagina trending come utente autenticato — non
// tramite l'API di rettiwt-api (che, verificato leggendo il suo enum
// ResourceType, non espone nessun endpoint "trend").
//
// Uso: node scripts/probe-x-trending-authenticated.mjs
//
// Richiede RETTIWT_API_KEY nell'ambiente.

import { chromium } from "playwright";

const API_KEY = process.env.RETTIWT_API_KEY;
const TRENDING_URL = "https://x.com/explore/tabs/trending";

if (!API_KEY) {
  console.error("Manca RETTIWT_API_KEY nei secrets/env.");
  process.exit(1);
}

function decodeCookieString(apiKey) {
  return Buffer.from(apiKey, "base64").toString("ascii");
}

function toPlaywrightCookies(cookieString) {
  return cookieString
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("=");
      if (idx < 1) return null;
      const name = entry.slice(0, idx).trim();
      const value = entry.slice(idx + 1).trim();
      if (!name || !value) return null;
      return { name, value, domain: ".x.com", path: "/" };
    })
    .filter(Boolean);
}

function detectLoginWall(finalUrl, bodyText) {
  const urlHit = /\/(login|i\/flow\/login|account\/access)/.test(finalUrl);
  const textHit =
    /(accedi a x|sign in to x|log in|iscriviti|create account|non perderti mai)/i.test(bodyText);
  return { urlHit, textHit, blocked: urlHit || textHit };
}

const cookieString = decodeCookieString(API_KEY);
const cookieNames = cookieString
  .split(";")
  .map((c) => c.trim().split("=")[0])
  .filter(Boolean);
console.log("=== Probe X Trending (autenticato via cookie RETTIWT_API_KEY) ===");
console.log(`Cookie trovati nell'API key: ${cookieNames.join(", ")}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "it-IT",
});
await context.addCookies(toPlaywrightCookies(cookieString));

const page = await context.newPage();

console.log(`\nNavigo verso: ${TRENDING_URL}`);
const response = await page
  .goto(TRENDING_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  .catch((e) => {
    console.log("Errore di navigazione:", e.message);
    return null;
  });
console.log("Status HTTP:", response ? response.status() : "(nessuna risposta)");

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
  `Login wall? ${login.blocked ? "SÌ (i cookie non hanno funzionato)" : "no — sessione autenticata"} (url-match: ${login.urlHit}, testo-match: ${login.textHit})`,
);

// Da loggati X mostra tipicamente ogni trend con categoria + "N post" sotto
// il nome, dentro [data-testid="trend"] — molto più ricco della sola lista
// anonima. Proviamo più selettori per non perdere nulla.
const trends = await page
  .$$eval('[data-testid="trend"]', (nodes) => nodes.map((n) => n.innerText?.trim()).filter(Boolean))
  .catch(() => []);
console.log(`\n=== Elementi [data-testid="trend"] trovati: ${trends.length} ===`);
console.log(JSON.stringify(trends.slice(0, 50), null, 2));

const tweets = await page
  .$$eval('article[data-testid="tweet"]', (nodes) =>
    nodes.slice(0, 10).map((a) => {
      const link = a.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? null;
      const groupLabel = a.querySelector('[role="group"]')?.getAttribute("aria-label");
      return { link, groupLabel };
    }),
  )
  .catch(() => []);
console.log(`\n=== article[data-testid="tweet"] trovati (max 10): ${tweets.length} ===`);
console.log(JSON.stringify(tweets, null, 2));

console.log("\n=== Primi 3000 caratteri del testo visibile ===");
console.log(bodyText.slice(0, 3000));

await browser.close();
console.log("\n=== Fine probe ===");
