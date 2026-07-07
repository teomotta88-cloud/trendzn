// Da lanciare UNA TANTUM in locale (non in CI) per creare la sessione
// iniziale autenticata su TikTok Creative Center.
//
// Apre un browser visibile: fai login manualmente con l'account dedicato
// (superando eventuali captcha/verifiche "nuovo dispositivo" a mano), poi
// premi INVIO nel terminale. Lo script salva la sessione e stampa il
// valore da usare per il secret GitHub TIKTOK_CC_SESSION_SEED.
//
// Uso: node scripts/tiktok-cc-bootstrap-session.mjs
//
// Alternativa senza Node/locale: fai login su ads.tiktok.com/creative/creativeCenter
// nel tuo browser normale, esporta i cookie con l'estensione "Cookie-Editor"
// (Export → Export as JSON), e incolla il risultato in un piccolo convertitore
// client-side (nessun dato inviato in rete) che produce lo stesso valore per
// TIKTOK_CC_SESSION_SEED. Vedi la PR/conversazione per il link allo strumento.

import { chromium } from "playwright";
import readline from "node:readline/promises";
import { SESSION_PATH, persistSession, readSessionSeedInstructions } from "./tiktok-cc-session.mjs";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://ads.tiktok.com/i18n/login/", { waitUntil: "domcontentloaded" });

console.log("\nFai login con l'account TikTok dedicato nella finestra del browser.");
console.log("Se richiesto, supera manualmente captcha/verifica email o SMS.");
console.log("Una volta atterrato sulla dashboard (loggato), torna qui e premi INVIO.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Premi INVIO quando hai completato il login… ");
rl.close();

await persistSession(context);
await browser.close();

const seed = readSessionSeedInstructions();
console.log(`\nSessione salvata in ${SESSION_PATH}.`);
console.log("\nAggiungi ora un secret GitHub chiamato TIKTOK_CC_SESSION_SEED con questo valore:\n");
console.log(seed);
console.log("\n(Repo → Settings → Secrets and variables → Actions → New repository secret)");
