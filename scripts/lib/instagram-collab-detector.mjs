// Rilevamento collab Instagram (due o più account co-autori dello stesso
// post) da un post pubblico, visitatore anonimo. Estratto da
// probe-instagram-collab.mjs dopo la validazione manuale su più post reali
// (namedsport x altavaltellinabikemarathon, e i post di factanza con 2 e 3
// collaboratori) — l'euristica non è cambiata da lì, solo spostata qui per
// essere riusabile dai worker di sync senza duplicare codice.
//
// Euristica: Instagram mostra i co-autori come link a profilo (href
// "/username/") vicino alla cima della pagina, prima della didascalia/dei
// commenti — un post normale ne ha uno solo (l'autore), un post in collab ne
// ha due o più. La soglia verticale (600px) è quella verificata nei probe:
// separa nettamente i link dell'header (sempre entro i primi ~400px nei
// test reali) dai link più in basso (commentatori, account suggeriti,
// "Popular" nel footer, visto a ~2000px+).
const HEADER_TOP_THRESHOLD_PX = 600;

// pagina già navigata sul post (page.goto già fatto dal chiamante, così chi
// chiama può decidere come gestire retry/timeout di navigazione).
export async function detectCollaborators(page) {
  if (/\/(accounts\/login|challenge)/.test(page.url())) {
    return { collaborators: null, reason: "login-wall" };
  }

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
  const topProfiles = dedup.filter((p) => p.top < HEADER_TOP_THRESHOLD_PX && p.top > -50);

  return {
    collaborators: topProfiles.map((p) => p.href.replace(/\//g, "")),
    reason: null,
  };
}
