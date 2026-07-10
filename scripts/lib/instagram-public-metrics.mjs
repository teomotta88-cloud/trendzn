// Recupera like/commenti pubblici di un post o Reel Instagram da un
// visitatore anonimo (nessun login, nessuna sessione) leggendo il meta tag
// "description"/"og:description" — quello che Instagram genera per le
// anteprime di condivisione (WhatsApp/Facebook/Slack), nel formato:
// "28K likes, 94 comments - autore on 23 maggio 2026: "didascalia"".
//
// Verificato con un browser reale (Playwright, non un fetch semplice — un
// fetch semplice viene bloccato subito): funziona identico su foto e Reel,
// senza credit anysite, senza login. Copre SOLO like e commenti: Instagram
// non mostra pubblicamente views né reshare a un visitatore anonimo, su
// nessun tipo di contenuto — non è un limite di questa tecnica, la
// piattaforma stessa non li espone a chi non è loggato (confermato su più
// post e Reel reali, vedi scripts/probe-instagram-post.mjs per il diagnostico
// usato per scoprirlo).
//
// ATTENZIONE: come ogni lettura automatizzata di Instagram senza account
// proprio, resta un'attività non prevista dai Termini di Servizio — qui il
// rischio è più contenuto rispetto a uno scraping autenticato (nessun
// account da bannare, nessuna sessione da mantenere), ma non è nullo.

import { chromium } from "playwright";

// "28K likes, 94 comments - ..." / "27 likes, 0 comments - ..." (singolare
// "like"/"comment" quando il numero è 1, gestito da likes?/comments?).
const DESCRIPTION_PATTERN = /^([\d.,]+[KM]?)\s+likes?,\s*([\d.,]+[KM]?)\s+comments?\s*-/i;

function parseCount(text) {
  const match = text.replace(/,/g, "").match(/^([\d.]+)([KM]?)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  return Math.round(n);
}

// Un solo browser per l'intera sessione di ricontrollo (aprirne uno per post
// sarebbe molto più lento): fetchMetrics() apre e chiude solo la scheda.
export async function openInstagramMetricsSession() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  // null quando il post non è più raggiungibile pubblicamente (account
  // diventato privato, post rimosso, formato del meta tag cambiato) — non
  // deve mai interrompere il ricontrollo degli altri post del batch.
  async function fetchMetrics(url) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const description = await page
        .$eval('meta[name="description"], meta[property="og:description"]', (el) =>
          el.getAttribute("content"),
        )
        .catch(() => null);
      if (!description) return null;

      const match = description.match(DESCRIPTION_PATTERN);
      if (!match) return null;

      const likes = parseCount(match[1]);
      const comments = parseCount(match[2]);
      if (likes == null || comments == null) return null;

      return { likes, comments };
    } catch (err) {
      console.error(`  Errore su ${url}: ${String(err)}`);
      return null;
    } finally {
      await page.close();
    }
  }

  async function close() {
    await browser.close();
  }

  // context esposto per chi deve anche navigare pagine diverse dai singoli
  // post/reel nella stessa sessione (es. la pagina hashtag per la discovery,
  // vedi scripts/discover-instagram-hashtag-content.mjs) — un solo browser
  // per l'intero run invece di aprirne uno per scopo.
  return { context, fetchMetrics, close };
}
