// Script diagnostico usa-e-getta: verifica se l'endpoint ScrapeCreators
// /v1/tiktok/search/hashtag accetta più hashtag in una sola chiamata (utile
// per risparmiare crediti quando monitoreremo una decina di hashtag reali,
// invece di una chiamata per hashtag). La documentazione pubblica non lo
// conferma né lo esclude esplicitamente (il path è singolare "hashtag", non
// "hashtags" — indizio ma non prova), quindi si prova empiricamente un paio
// di formati plausibili su due hashtag di test.
//
// Nessuna scrittura su store: solo output in console. Consuma qualche
// credito ScrapeCreators (1 per chiamata provata).
//
// Uso: node scripts/probe-scrapecreators-multi-hashtag.mjs <hashtag1> <hashtag2>
// Richiede SCRAPECREATORS_API_KEY nell'ambiente.

const [tag1, tag2] = process.argv.slice(2);
if (!tag1 || !tag2) {
  console.error("Uso: node scripts/probe-scrapecreators-multi-hashtag.mjs <hashtag1> <hashtag2>");
  process.exit(1);
}

const apiKey = process.env.SCRAPECREATORS_API_KEY;
if (!apiKey) {
  console.error("Manca SCRAPECREATORS_API_KEY nell'ambiente.");
  process.exit(1);
}

async function tryFormat(label, url) {
  console.log(`\n--- ${label} ---`);
  console.log(`GET ${url}`);
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  if (!res.ok) {
    console.log(`Risposta: ${text.slice(0, 500)}`);
    return;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("Risposta non-JSON, primi 300 caratteri:", text.slice(0, 300));
    return;
  }
  const list = data.aweme_list ?? data.videos ?? [];
  console.log(`credits_remaining: ${data.credits_remaining ?? "n/d"}`);
  console.log(`Video restituiti: ${list.length}`);
  const authors = new Set(list.map((v) => v.author?.unique_id).filter(Boolean));
  const captions = list
    .slice(0, 5)
    .map((v) => (v.desc ?? "").slice(0, 60))
    .join(" | ");
  console.log(`Autori distinti nel campione: ${authors.size}`);
  console.log(`Prime 5 caption: ${captions}`);
  const mentionsTag1 = list.filter((v) => (v.desc ?? "").toLowerCase().includes(tag1.toLowerCase())).length;
  const mentionsTag2 = list.filter((v) => (v.desc ?? "").toLowerCase().includes(tag2.toLowerCase())).length;
  console.log(`Caption che citano "${tag1}": ${mentionsTag1}/${list.length}`);
  console.log(`Caption che citano "${tag2}": ${mentionsTag2}/${list.length}`);
}

console.log(`=== Probe ScrapeCreators: più hashtag in una chiamata? (${tag1} + ${tag2}) ===`);

// Formato A: baseline, un solo hashtag (per avere un riferimento di quanti
// risultati/credito costa normalmente una chiamata singola).
await tryFormat("A. Baseline singolo hashtag", `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(tag1)}`);

// Formato B: comma-separated nello stesso parametro.
await tryFormat(
  "B. Comma-separated (?hashtag=a,b)",
  `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(tag1)},${encodeURIComponent(tag2)}`,
);

// Formato C: parametro ripetuto (convenzione comune per array in querystring).
await tryFormat(
  "C. Parametro ripetuto (?hashtag=a&hashtag=b)",
  `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(tag1)}&hashtag=${encodeURIComponent(tag2)}`,
);

// Formato D: nome parametro plurale, per esclusione (se l'endpoint fosse
// stato documentato in modo incompleto).
await tryFormat(
  "D. Parametro plurale (?hashtags=a,b)",
  `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtags=${encodeURIComponent(tag1)},${encodeURIComponent(tag2)}`,
);

console.log(
  "\nConfronta i risultati: se B/C/D restituiscono video con caption di ENTRAMBI gli hashtag (non solo il primo) ed 'errors' non compare, il formato funziona davvero — altrimenti l'endpoint probabilmente ignora tutto tranne il primo hashtag o restituisce un errore, confermando che va chiamato un hashtag per volta.",
);
