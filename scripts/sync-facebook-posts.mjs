// Sync Facebook per ASPI-monitoring: a differenza di IG/TikTok (via
// RSS-Bridge), Facebook richiede un browser reale (Playwright) — un fetch
// semplice viene bloccato subito. Legge, per ciascun account Facebook
// presente in aspi-monitoring.json, il/i post visibili SENZA login (chiude
// il primo popup di login, poi legge dal DOM url/data/copy/immagine).
//
// Limite noto (confermato su più run reali, vedi probe-facebook-page.mjs):
// la pagina mostra in modo affidabile solo il post più recente, non un feed
// scorrevole — anche scrollando non emergono altri post. Strategia adottata:
// stessa logica di poll-e-accumula di IG/TikTok — ogni sync legge "l'ultimo
// post" e lo aggiunge allo storico se non c'è già. Con cadenza abbastanza
// frequente e pagine che non postano in continuazione, nel tempo si
// accumula comunque la (quasi) totalità dei post.

import { chromium } from "playwright";

const REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/aspi-monitoring.json";
const MAX_POSTS_PER_CHANNEL = 15;
const MAX_SCROLLS = 4;
const SCROLL_WAIT_MS = 2500;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${token}`,
  Accept: "application/vnd.github.v3+json",
};

async function readStore() {
  const metaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    headers: ghHeaders,
  });

  if (!metaRes.ok) {
    throw new Error(
      `Lettura metadata aspi-monitoring.json fallita: ${metaRes.status} ${await metaRes.text()}`,
    );
  }

  const meta = await metaRes.json();
  const sha = meta.sha;

  const branch = process.env.GITHUB_REF_NAME || "main";
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${TRENDS_PATH}?t=${Date.now()}`;

  const rawRes = await fetch(rawUrl, {
    headers: {
      "User-Agent": "aspi-monitoring-sync-facebook",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!rawRes.ok) {
    throw new Error(
      `Lettura raw aspi-monitoring.json fallita: ${rawRes.status} ${await rawRes.text()}`,
    );
  }

  const raw = await rawRes.text();
  const store = raw.trim() ? JSON.parse(raw) : { canali: [] };
  if (!Array.isArray(store.canali)) store.canali = [];

  return { store, sha };
}

// Come delete-canale.ts: il workflow di sync IG/TikTok scrive sullo stesso
// file; riproviamo su conflitto invece di fallire silenziosamente.
async function writeStore(store) {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { sha } = await readStore();
    const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: sync Facebook posts [trendzn-bot]",
        content,
        sha,
      }),
    });

    if (res.ok) return;

    if ((res.status === 409 || res.status === 422) && attempt < MAX_ATTEMPTS) {
      console.log(
        `Conflitto di scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), rileggo e riprovo...`,
      );
      continue;
    }

    throw new Error(`Scrittura aspi-monitoring.json fallita: ${res.status} ${await res.text()}`);
  }

  throw new Error("Troppi conflitti di scrittura su aspi-monitoring.json.");
}

function isPostUrl(url) {
  return /\/(posts|videos|reel|photos|watch|permalink\.php)\b|story_fbid=/i.test(url);
}

// Gli account salvati in aspi-monitoring.json NON hanno platform: "facebook"
// per la pagina (arrivano da un import generico che li tagga "web"): li
// riconosciamo dall'host dell'URL, non dal campo platform.
function isFacebookUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return host === "facebook.com" || host === "fb.com";
  } catch {
    return false;
  }
}

const MONTHS_IT = {
  gennaio: 0,
  febbraio: 1,
  marzo: 2,
  aprile: 3,
  maggio: 4,
  giugno: 5,
  luglio: 6,
  agosto: 7,
  settembre: 8,
  ottobre: 9,
  novembre: 10,
  dicembre: 11,
};

// Facebook mostra date relative senza anno per i post recenti ("20 maggio",
// "ieri", "3 h", "5 min"). Proviamo a ricostruire una data assoluta;
// ritorniamo null se il formato non è riconosciuto (meglio nessuna data che
// una sbagliata).
function parseItalianRelativeDate(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  const relMatch = t.match(/^(\d+)\s*(min|h|ore|giorni|giorno|settimana|settimane)\b/);
  if (relMatch) {
    const n = Number(relMatch[1]);
    const unit = relMatch[2];
    const now = Date.now();
    const msPerUnit = {
      min: 60_000,
      h: 3_600_000,
      ore: 3_600_000,
      giorno: 86_400_000,
      giorni: 86_400_000,
      settimana: 604_800_000,
      settimane: 604_800_000,
    };
    const ms = msPerUnit[unit];
    if (ms) return new Date(now - n * ms).toISOString();
  }

  if (t === "ieri") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }

  // "20 maggio" oppure "20 maggio 2025"
  const dayMonthMatch = t.match(
    /^(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/,
  );
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = MONTHS_IT[dayMonthMatch[2]];
    const now = new Date();
    let year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : now.getFullYear();

    let date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    // Se il testo non specifica l'anno e la data risultante è nel futuro,
    // FB intende quasi certamente l'anno scorso.
    if (!dayMonthMatch[3] && date.getTime() > now.getTime()) {
      year -= 1;
      date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
    return date.toISOString();
  }

  return null;
}

async function tryCloseFirstPopup(page) {
  const closeSelectors = ['[aria-label="Chiudi"]', '[aria-label="Close"]'];
  for (const sel of closeSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function hasBlockingWall(page) {
  const dialogs = await page.$$('div[role="dialog"]');
  for (const d of dialogs) {
    const visible = await d.isVisible().catch(() => false);
    if (!visible) continue;
    const hasClose = await d
      .$('[aria-label="Chiudi"], [aria-label="Close"]')
      .then((el) => !!el)
      .catch(() => false);
    if (!hasClose) return true;
  }
  return false;
}

function extractPosts() {
  const POST_URL_RE = /\/(posts|videos|reel|photos|watch|permalink\.php)\b|story_fbid=/i;
  const articles = Array.from(document.querySelectorAll('[role="article"]'));

  const posts = [];
  for (const el of articles) {
    const links = Array.from(el.querySelectorAll("a[href]"));
    let permalinkEl = null;
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      if (POST_URL_RE.test(href)) {
        permalinkEl = a;
        break;
      }
    }
    if (!permalinkEl) continue;

    const permalinkHref = permalinkEl.href;
    const dateText = (
      permalinkEl.getAttribute("aria-label") ||
      permalinkEl.textContent ||
      ""
    ).trim();

    const textCandidates = Array.from(el.querySelectorAll('div[dir="auto"]'))
      .map((n) => n.textContent?.trim() || "")
      .filter((t) => t.length > 20);
    const copy = textCandidates.sort((a, b) => b.length - a.length)[0] || null;

    const img = el.querySelector("img[src]");

    posts.push({
      permalinkHref,
      dateText,
      copy: copy || null,
      mediaImage: img ? img.src : null,
    });
  }
  return posts;
}

function stripTrackingParams(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("__cft__[0]");
    u.searchParams.delete("__tn__");
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchLatestFacebookPosts(browser, pageUrl) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 1400 },
    locale: "it-IT",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["it-IT", "it", "en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });

  const page = await context.newPage();

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    await tryCloseFirstPopup(page);
    await page.waitForTimeout(1000);

    let scrolls = 0;
    let lastCount = 0;
    let stagnant = 0;
    while (scrolls < MAX_SCROLLS) {
      if (await hasBlockingWall(page)) break;
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(SCROLL_WAIT_MS);
      scrolls++;
      const count = await page.evaluate(extractPosts).then((p) => p.length);
      if (count === lastCount) {
        stagnant++;
        if (stagnant >= 2) break;
      } else {
        stagnant = 0;
        lastCount = count;
      }
    }

    return await page.evaluate(extractPosts);
  } catch (err) {
    console.error(`Errore su ${pageUrl}: ${String(err)}`);
    return [];
  } finally {
    await context.close();
  }
}

// --- Main ---
const { store } = await readStore();
const list = store.canali;

const facebookAccounts = [];
for (const canale of list) {
  for (const account of canale.accounts || []) {
    if (account.url && isFacebookUrl(account.url)) {
      // L'URL del canale è la pagina Facebook stessa (non un post): la
      // distinguiamo dai post già salvati (quelli hanno isPostUrl(url)===true).
      if (!isPostUrl(account.url)) {
        facebookAccounts.push({ canale, pageUrl: account.url, handle: account.handle });
      }
    }
  }
}

console.log(`Monitoro ${facebookAccounts.length} pagine Facebook.`);

if (facebookAccounts.length === 0) {
  console.log("Nessuna pagina Facebook da monitorare, esco.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
let modified = false;

try {
  for (const { canale, pageUrl, handle } of facebookAccounts) {
    console.log(`Controllo ${pageUrl}...`);
    const posts = await fetchLatestFacebookPosts(browser, pageUrl);
    console.log(`  trovati ${posts.length} post reali.`);

    for (const post of posts) {
      const url = stripTrackingParams(post.permalinkHref);
      const existing = canale.accounts.find((a) => a.url === url);
      if (existing) continue;

      canale.accounts.push({
        platform: "facebook",
        handle,
        url,
        date: parseItalianRelativeDate(post.dateText),
        caption: post.copy,
        imageUrl: post.mediaImage || null,
      });
      modified = true;
      console.log(`  nuovo post aggiunto: ${url}`);

      const posts_ = canale.accounts.filter((a) => isPostUrl(a.url) && a.platform === "facebook");
      if (posts_.length > MAX_POSTS_PER_CHANNEL) {
        canale.accounts = canale.accounts.filter((a) => a.url !== posts_[0].url);
      }
    }
  }
} finally {
  await browser.close();
}

if (!modified) {
  console.log("Nessuna novità, aspi-monitoring.json non modificato.");
  process.exit(0);
}

await writeStore(store);
console.log("aspi-monitoring.json aggiornato su GitHub.");
