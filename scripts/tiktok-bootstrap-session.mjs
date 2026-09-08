// Da lanciare UNA TANTUM in locale (non in CI) per creare la sessione
// autenticata su www.tiktok.com usata dallo scraping (KPI, profili autore,
// pagine hashtag): vedi il commento in testa a lib/tiktok-page.mjs per il
// perché (da anonimo le pagine hashtag si fermano a ~58-60 video, da loggati
// un conteggio manuale ne ha trovati 414 sullo stesso hashtag).
//
// Apre un browser visibile: fai login manualmente con l'account sacrificabile
// già usato per TikTok Creative Center (TIKTOK_CC_EMAIL/TIKTOK_CC_PASSWORD
// nei secret, se li hai a portata di mano — qui vanno solo digitati a mano
// nella pagina, lo script non li legge), superando eventuali captcha/verifiche
// "nuovo dispositivo", poi premi INVIO nel terminale. Lo script salva la
// sessione e stampa il valore da usare per il secret GitHub
// TIKTOK_SESSION_SEED.
//
// A differenza della sessione di Creative Center, questa non ha bisogno di
// sopravvivere a settimane di run schedulati: basta che sia valida per la
// durata di UN run one-shot di scoperta, quindi niente fallback di login
// automatico né rinnovo periodico.
//
// Uso: node scripts/tiktok-bootstrap-session.mjs

import { chromium } from "playwright";
import readline from "node:readline/promises";

import {
  persistSession,
  readSessionSeedInstructions,
  REAL_CHROME_UA,
  SESSION_PATH,
} from "./lib/tiktok-page.mjs";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ userAgent: REAL_CHROME_UA });
const page = await context.newPage();

await page.goto("https://www.tiktok.com/login", { waitUntil: "domcontentloaded" });

console.log("\nFai login con l'account TikTok sacrificabile nella finestra del browser.");
console.log("Se richiesto, supera manualmente captcha/verifica email o SMS.");
console.log("Una volta atterrato sul feed (loggato), torna qui e premi INVIO.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Premi INVIO quando hai completato il login… ");
rl.close();

await persistSession(context);
await browser.close();

const seed = readSessionSeedInstructions();
console.log(`\nSessione salvata in ${SESSION_PATH}.`);
console.log("\nAggiungi ora un secret GitHub chiamato TIKTOK_SESSION_SEED con questo valore:\n");
console.log(seed);
console.log("\n(Repo → Settings → Secrets and variables → Actions → New repository secret)");
