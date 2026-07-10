// Recupera like/commenti (e, quando possibile, la data di pubblicazione) di
// un post/carosello/Reel Instagram da un visitatore anonimo (nessun login,
// nessuna sessione) leggendo il meta tag "description"/"og:description" —
// quello che Instagram genera per le anteprime di condivisione
// (WhatsApp/Facebook/Slack), nel formato:
// "28K likes, 94 comments - autore on 23 maggio 2026: "didascalia"".
//
// Verificato con un browser reale (Playwright, non un fetch semplice — un
// fetch semplice viene bloccato subito): funziona identico su foto/caroselli
// e Reel, senza credit anysite, senza login. Copre SOLO like e commenti:
// Instagram non mostra pubblicamente views né reshare a un visitatore
// anonimo, su nessun tipo di contenuto — non è un limite di questa tecnica,
// la piattaforma stessa non li espone a chi non è loggato (confermato su più
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

// Il resto della description ha il formato "... - autore on <data>: "didascalia""
// — la data compare sia in stile USA ("May 23, 2026") sia in stile europeo
// ("23 maggio 2026"), a seconda della lingua che Instagram assegna alla
// richiesta anonima (non controllabile da qui). Copre inglese e italiano;
// se il formato non combacia (altra lingua, cambio di formato lato
// Instagram) parseDescriptionDate ritorna null — meglio "data sconosciuta"
// che una data sbagliata.
const DATE_PATTERN =
  /\bon\s+([a-zàèéìòù]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[a-zàèéìòù]+\s+\d{4})\s*:/i;

const MONTH_NAMES = {
  january: 0,
  jan: 0,
  gennaio: 0,
  february: 1,
  feb: 1,
  febbraio: 1,
  march: 2,
  mar: 2,
  marzo: 2,
  april: 3,
  apr: 3,
  aprile: 3,
  may: 4,
  maggio: 4,
  june: 5,
  jun: 5,
  giugno: 5,
  july: 6,
  jul: 6,
  luglio: 6,
  august: 7,
  aug: 7,
  agosto: 7,
  september: 8,
  sep: 8,
  sept: 8,
  settembre: 8,
  october: 9,
  oct: 9,
  ottobre: 9,
  november: 10,
  nov: 10,
  novembre: 10,
  december: 11,
  dec: 11,
  dicembre: 11,
};

function parseDescriptionDate(description) {
  const match = description.match(DATE_PATTERN);
  if (!match) return null;
  const raw = match[1].toLowerCase().replace(",", "");

  const us = raw.match(/^([a-zàèéìòù]+)\s+(\d{1,2})\s+(\d{4})$/);
  const eu = raw.match(/^(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})$/);

  let day, month, year;
  if (us && MONTH_NAMES[us[1]] != null) {
    [, , day, year] = us;
    month = MONTH_NAMES[us[1]];
  } else if (eu && MONTH_NAMES[eu[2]] != null) {
    day = eu[1];
    month = MONTH_NAMES[eu[2]];
    year = eu[3];
  } else {
    return null;
  }

  const date = new Date(Date.UTC(Number(year), month, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

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
  //
  // publishedAt: prova prima l'elemento <time datetime="..."> (ISO, non
  // dipende dalla lingua — se Instagram lo espone è la fonte più affidabile),
  // poi ripiega sulla data testuale nella description. null se nessuna delle
  // due funziona: meglio "data sconosciuta" (il chiamante decide come
  // trattarla) che una data indovinata.
  async function fetchMetrics(url) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      const isoDatetime = await page
        .$eval("time[datetime]", (el) => el.getAttribute("datetime"))
        .catch(() => null);

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

      const publishedAt = isoDatetime ?? parseDescriptionDate(description);

      return { likes, comments, publishedAt };
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
