// Gestione della sessione autenticata per TikTok Creative Center.
//
// La pagina dei trending hashtag richiede login. Per non dover fare un
// login "a freddo" ad ogni esecuzione (rischio captcha/verifica nuovo
// dispositivo) la sessione (cookie + storage) viene salvata su disco e
// riusata tra un'esecuzione e l'altra. In CI il file viene persistito
// tramite cache di GitHub Actions (gratuita), non serve un server sempre
// acceso.
//
// Ordine con cui viene cercata una sessione utilizzabile:
//   1. file locale già presente (SESSION_PATH, es. ripristinato dalla cache)
//   2. TIKTOK_CC_SESSION_SEED (secret, sessione codificata in base64 creata
//      una tantum con scripts/tiktok-cc-bootstrap-session.mjs)
//   3. login automatico con TIKTOK_CC_EMAIL / TIKTOK_CC_PASSWORD
//      (funziona solo se l'account non richiede verifiche aggiuntive)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SESSION_PATH = process.env.TIKTOK_CC_SESSION_PATH || ".tiktok-session/state.json";
export const CC_TRENDS_URL =
  "https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?locale=en&deviceType=pc&region=IT&period=7";
const LOGIN_URL = "https://ads.tiktok.com/i18n/login/";

function seedSessionFromEnv() {
  const seed = process.env.TIKTOK_CC_SESSION_SEED;
  if (!seed) return false;
  try {
    const json = Buffer.from(seed, "base64").toString("utf-8");
    JSON.parse(json); // valida che sia JSON valido prima di scrivere il file
    mkdirSync(dirname(SESSION_PATH), { recursive: true });
    writeFileSync(SESSION_PATH, json);
    console.error("[session] Sessione inizializzata da TIKTOK_CC_SESSION_SEED.");
    return true;
  } catch (err) {
    console.error(`[session] TIKTOK_CC_SESSION_SEED non valido: ${String(err)}`);
    return false;
  }
}

async function isLoggedIn(page) {
  // Se la sessione non è valida, TikTok reindirizza alla pagina di login.
  await page.waitForTimeout(1500);
  const url = page.url();
  return !url.includes("/login");
}

async function loginWithCredentials(page) {
  const email = process.env.TIKTOK_CC_EMAIL;
  const password = process.env.TIKTOK_CC_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Nessuna sessione valida disponibile e mancano TIKTOK_CC_EMAIL/TIKTOK_CC_PASSWORD per il login automatico.",
    );
  }

  console.error("[session] Nessuna sessione valida, provo login automatico con email/password…");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // TikTok mostra di default il login via QR code: va selezionato il tab
  // "usa email/nome utente". Il testo esatto del link può variare per
  // lingua/versione della pagina: proviamo alcune varianti note.
  const emailTabCandidates = [
    "text=/log in with email/i",
    "text=/accedi con e-mail/i",
    "text=/use phone \\/ email/i",
  ];
  for (const selector of emailTabCandidates) {
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.click().catch(() => {});
      break;
    }
  }

  await page.waitForTimeout(1000);

  const emailInput = page.locator('input[type="text"], input[type="email"]').first();
  await emailInput.waitFor({ timeout: 15000 });
  await emailInput.fill(email);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);

  const submitButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Accedi")').first();
  await submitButton.click();

  await page.waitForTimeout(4000);

  if (!(await isLoggedIn(page))) {
    throw new Error(
      "Login automatico fallito: TikTok richiede probabilmente una verifica aggiuntiva (captcha/email/SMS) " +
        "che non può essere superata in automatico. Rifai il bootstrap manuale con " +
        "scripts/tiktok-cc-bootstrap-session.mjs e aggiorna il secret TIKTOK_CC_SESSION_SEED.",
    );
  }

  console.error("[session] Login automatico riuscito.");
}

// Crea un BrowserContext con la sessione salvata (se presente), senza
// navigare da nessuna parte: la navigazione/login la fa ensureLoggedIn
// sulla pagina che il chiamante vuole effettivamente usare, per evitare
// una doppia navigazione con impostazioni diverse.
export async function createAuthenticatedContext(browser) {
  if (!existsSync(SESSION_PATH)) {
    seedSessionFromEnv();
  }

  const hasStoredSession = existsSync(SESSION_PATH);
  return browser.newContext({
    storageState: hasStoredSession ? SESSION_PATH : undefined,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
}

// Naviga la pagina data verso Creative Center e, se la sessione non è
// valida, fa login e ci torna. Usa "domcontentloaded" (non "networkidle":
// Creative Center ha polling/analytics continui che a volte non lasciano
// mai la rete "inattiva", causando timeout).
export async function ensureLoggedIn(page) {
  await page.goto(CC_TRENDS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  if (await isLoggedIn(page)) return;

  await loginWithCredentials(page);
  await page.goto(CC_TRENDS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
}

// Risalva sempre lo stato aggiornato (i cookie di sessione TikTok
// ruotano nel tempo): mantiene la sessione valida più a lungo senza
// dover rifare login.
export async function persistSession(context) {
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.error(`[session] Sessione salvata in ${SESSION_PATH}.`);
}

export function readSessionSeedInstructions() {
  const json = readFileSync(SESSION_PATH, "utf-8");
  return Buffer.from(json).toString("base64");
}
