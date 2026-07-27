// Rilevamento collab Instagram (due o più account co-autori dello stesso
// post) da un post pubblico, visitatore anonimo. Estratto da
// probe-instagram-collab.mjs dopo la validazione manuale su più post reali
// (namedsport x altavaltellinabikemarathon, e i post di factanza con 2 e 3
// collaboratori) — l'euristica di base non è cambiata da lì, solo spostata
// qui per essere riusabile dai worker di sync senza duplicare codice.
//
// Euristica: Instagram mostra i co-autori come link a profilo (href
// "/username/") vicino alla cima della pagina, prima della didascalia/dei
// commenti — un post normale ne ha uno solo (l'autore), un post in collab ne
// ha due o più.
//
// BUG trovato in produzione (post seatitalia/Da4tfP9Fw_G, con una didascalia
// corta): con una soglia fissa in pixel, i primi commentatori (es.
// sssilviett, riparorologi) finiscono ENTRO la soglia e vengono scambiati
// per collaboratori — i due post usati per la validazione iniziale avevano
// entrambi zero commenti, quindi il problema non era mai emerso. La
// posizione dei commenti dipende da quanto è lunga la didascalia, quindi
// nessuna soglia fissa in pixel può essere corretta in generale.
//
// Fix: invece di un numero di pixel arbitrario, il confine dell'header è
// ancorato alla posizione dell'elemento <time datetime="..."> del post —
// lo stesso selettore già usato e validato in instagram-public-metrics.mjs
// per estrarre la data di pubblicazione. Quell'elemento compare sempre
// subito dopo l'autore/i e prima della didascalia, quindi qualunque link a
// profilo PRIMA di quel timestamp è un vero autore/collaboratore; tutto
// quello che viene dopo (didascalia, commenti) non lo è, indipendentemente
// da quanto sia lunga la didascalia.
const FALLBACK_HEADER_TOP_THRESHOLD_PX = 600;

// margine di tolleranza: autore e timestamp sono nella stessa riga/blocco,
// un margine piccolo evita di escludere l'autore per un paio di pixel di
// differenza di rendering tra i due elementi.
const HEADER_MARGIN_PX = 15;

// pagina già navigata sul post (page.goto già fatto dal chiamante, così chi
// chiama può decidere come gestire retry/timeout di navigazione).
export async function detectCollaborators(page) {
  if (/\/(accounts\/login|challenge)/.test(page.url())) {
    return { collaborators: null, reason: "login-wall" };
  }

  const timeTop = await page
    .$eval("time[datetime]", (el) => el.getBoundingClientRect().top)
    .catch(() => null);
  const headerBoundary =
    timeTop != null ? timeTop + HEADER_MARGIN_PX : FALLBACK_HEADER_TOP_THRESHOLD_PX;

  const profileLinks = await page.$$eval('a[href^="/"]', (nodes) =>
    nodes
      .map((n) => {
        const rect = n.getBoundingClientRect();
        return { href: n.getAttribute("href"), top: Math.round(rect.top) };
      })
      .filter((n) => n.href && /^\/[A-Za-z0-9._]+\/?$/.test(n.href)),
  );

  const seen = new Set();
  const dedup = profileLinks.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
  const topProfiles = dedup.filter((p) => p.top < headerBoundary && p.top > -50);

  return {
    collaborators: topProfiles.map((p) => p.href.replace(/\//g, "")),
    reason: null,
  };
}
