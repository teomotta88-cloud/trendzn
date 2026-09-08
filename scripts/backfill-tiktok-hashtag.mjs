// Backfill storico dei post TikTok degli hashtag già monitorati in
// Bluserena-monitoring. Evoluzione di backfill-tiktok-hashtag-apify.mjs:
// stessa idea (chiamare un servizio a pagamento a ripetizione, accumulare i
// post nuovi, fermarsi da solo quando non emergono più novità nelle finestre
// di interesse per il confronto YoY — vedi i probe scripts/probe-tiktok-
// hashtag-*.{mjs,py} per la storia di come si è arrivati a questa scelta),
// ma con DUE fonti in cascata invece di una sola:
//
//   1. Apify (clockworks/tiktok-hashtag-scraper) — prima scelta, già
//      validata (probe-tiktok-hashtag-apify-depth.mjs: 400 post fino al
//      2020, engagement reale). Costa per RISULTATO restituito.
//   2. ScrapeCreators (/v1/tiktok/search/keyword, non /search/hashtag: vedi
//      il commento sopra callScrapeCreators sul perché del cambio il
//      9/09/2026) — backup, usato quando Apify fallisce (in pratica: quando
//      esaurisce il credito, ma vedi nota sotto sul perché si passa alla
//      fonte successiva su QUALSIASI errore, non solo quello). Costa 1
//      credito a CHIAMATA (non per risultato). La loro stessa documentazione
//      conferma lo stesso fenomeno osservato con Apify: "TikTok can return
//      duplicate results for this search" — nessuna fonte, a quanto pare,
//      ha un cursore stabile su questo tipo di ricerca.
//
// Verificato su un run reale (26/08/2026): quando Apify esaurisce il
// credito, l'errore restituito è un generico {"error":{"type":"run-failed",
// "message":"Actor run did not succeed..."}} (HTTP 400) — indistinguibile
// testualmente da un fallimento per qualsiasi altra causa. Per questo lo
// script passa alla fonte successiva su QUALSIASI errore della fonte
// attiva, non solo su un presunto "errore di credito" riconosciuto dal
// testo (approccio provato e scartato: vedi commit precedenti).
//
// Regola di stop (rivista dopo l'analisi del run reale su #bluserena, che
// aveva mostrato "20/20 nuovi ogni chiamata" per 8 chiamate di fila SOLO per
// il bug dell'URL non normalizzato: una volta ricontrollato per video ID
// reale, quelle 8 chiamate avevano trovato 0 post davvero nuovi — la
// saturazione era già arrivata alla seconda chiamata): per OGNI hashtag si
// fanno sempre almeno MIN_CALLS chiamate (default 2); da lì in poi, alla
// prima chiamata senza nessun post NUOVO nelle finestre di interesse ci si
// ferma per quell'hashtag; se anche la chiamata MIN_CALLS trova ancora
// qualcosa, se ne fa una sola in più (tetto MAX_CALLS, default 3) e poi ci
// si ferma comunque. Quando TUTTI gli hashtag sono stati processati, il
// monitoraggio prosegue solo con lo scraping DIY quotidiano
// (sync-bluserena-hashtags.mjs).
//
// Novità rispetto alla versione solo-Apify: oltre ad aggiungere i post mai
// visti, questo script ARRICCHISCE i post già presenti nello store (es.
// trovati in precedenza dallo scraping DIY, quindi tipicamente senza
// like/commenti/condivisioni/views) con i campi mancanti, quando la fonte
// a pagamento li restituisce per lo stesso URL. Un post arricchito non
// conta come "nuovo" ai fini della soglia di stop (quella soglia misura la
// scoperta di post mai visti, non l'arricchimento di quelli già noti).
//
// Nessuna creazione di nuovi canali: arricchisce SOLO hashtag già presenti
// nello store.
//
// Uso:
//   node scripts/backfill-tiktok-hashtag.mjs <hashtag>   — un solo hashtag
//   node scripts/backfill-tiktok-hashtag.mjs             — TUTTI gli hashtag
//     TikTok già presenti nello store, uno dopo l'altro nello stesso run,
//     con una pausa tra un hashtag e il successivo.
// Richiede GITHUB_TOKEN sempre, APIFY_API_TOKEN e/o SCRAPECREATORS_API_KEY
// (basta una delle due per partire; se manca la seconda e la prima esaurisce
// il credito, lo script passa alla successiva invece di crashare).
// Env opzionali: RESULTS_PER_CALL, MIN_CALLS, MAX_CALLS,
// DELAY_BETWEEN_CALLS_MS, WINDOW_A_START/END, WINDOW_B_START/END.
//
// Lettura/scrittura dello store SEMPRE tramite lib/bluserena-store.mjs
// (commitNewPosts/commitField), non con una copia locale: questo script può
// girare per decine di minuti (pausa tra le chiamate + più hashtag), e nel
// frattempo altri workflow scrivono sullo stesso file. Una versione
// precedente teneva un'unica copia in memoria letta a inizio run e la
// riscriveva per intero ad ogni chiamata rileggendo solo lo sha (non il
// contenuto): esattamente il bug "lost update" già documentato nell'header
// di lib/bluserena-store.mjs (53 minuti di trascrizioni audio persi in un
// altro script, 31/08/2026). commitNewPosts/commitField rileggono lo store
// fresco subito prima di ogni scrittura, quindi non serve più tenerne una
// copia locale.

import { commitField, commitNewPosts, readStore, STORE_PATH } from "./lib/bluserena-store.mjs";

const APIFY_ACTOR = "clockworks~tiktok-hashtag-scraper";
const APIFY_COST_PER_ITEM_USD = 0.005; // $5 / 1000 risultati, pricing pubblico dell'actor

const RESULTS_PER_CALL = parseInt(process.env.RESULTS_PER_CALL ?? "400", 10);
// Si fanno sempre almeno MIN_CALLS chiamate per hashtag; da lì in poi ci si
// ferma alla prima chiamata senza post nuovi nelle finestre (non serve più
// attendere chiamate consecutive vuote, vedi commento in testa al file).
// MAX_CALLS è il tetto assoluto per hashtag: con MIN_CALLS=2 e MAX_CALLS=3
// si fa al massimo UNA chiamata in più oltre al minimo, se la seconda aveva
// ancora trovato qualcosa.
const MIN_CALLS = parseInt(process.env.MIN_CALLS ?? "2", 10);
const MAX_CALLS = parseInt(process.env.MAX_CALLS ?? "3", 10);
const DELAY_BETWEEN_CALLS_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "30000", 10);

const WINDOW_A = {
  start: new Date(process.env.WINDOW_A_START ?? "2025-07-01T00:00:00Z"),
  end: new Date(process.env.WINDOW_A_END ?? "2025-08-31T23:59:59Z"),
};
const WINDOW_B = {
  start: new Date(process.env.WINDOW_B_START ?? "2026-07-01T00:00:00Z"),
  end: new Date(process.env.WINDOW_B_END ?? "2026-08-31T23:59:59Z"),
};

function inWindows(date) {
  if (!date) return false;
  const t = date.getTime();
  return (
    (t >= WINDOW_A.start.getTime() && t <= WINDOW_A.end.getTime()) ||
    (t >= WINDOW_B.start.getTime() && t <= WINDOW_B.end.getTime())
  );
}

// Argomento opzionale: se assente (o stringa vuota, come quando il workflow
// GitHub Actions passa un input non compilato), si processano TUTTI gli
// hashtag TikTok già presenti nello store invece di uno solo.
const requestedTag = process.argv[2] || null;

const apifyToken = process.env.APIFY_API_TOKEN;
const scrapeCreatorsKey = process.env.SCRAPECREATORS_API_KEY;
if (!apifyToken && !scrapeCreatorsKey) {
  console.error("Serve almeno una fonte configurata: APIFY_API_TOKEN o SCRAPECREATORS_API_KEY.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ScrapeCreators restituisce share_url con parametri di tracciamento
// (_r, u_code, _d, ecc.) GENERATI A CASO a ogni chiamata, anche per lo
// STESSO identico video — verificato su un run reale: la stessa chiamata
// ripetuta 10 volte ha prodotto 10 URL diversi per il video già visto alla
// prima chiamata, mai deduplicati perché il confronto era per stringa
// esatta. La query string non fa parte dell'identità del video (l'ID è nel
// path), quindi va rimossa sia quando si salva l'URL sia quando si
// confronta con quelli già nello store.
function normalizeTikTokUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

// Stesso criterio usato lato UI e da sync-bluserena-hashtags.mjs: riconosce
// una pagina hashtag dalla FORMA del path, nessun campo extra nello store.
function hashtagInfo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/$/, "");
  const ttMatch = /^\/tags?\/([^/]+)$/.exec(path);
  if (/tiktok\.com$/.test(host) && ttMatch) {
    return { platform: "tiktok", tag: decodeURIComponent(ttMatch[1]) };
  }
  return null;
}

// NON si prova a riconoscere "è un errore di credito esaurito" dal testo
// della risposta: verificato su un run reale che, quando Apify esaurisce il
// credito, l'errore restituito è un generico
// {"error":{"type":"run-failed","message":"Actor run did not succeed..."}}
// (HTTP 400) — indistinguibile testualmente da un fallimento per qualsiasi
// altra ragione. Per questo QUALSIASI errore della fonte attiva fa passare
// alla fonte successiva, se disponibile: non abbiamo un modo affidabile per
// distinguere "credito finito" da altri fallimenti, quindi non ha senso
// continuare a insistere sulla stessa fonte comunque.

// --- Apify ---
// Ignora il cursore: non è paginato allo stesso modo di ScrapeCreators, va
// già in profondità con RESULTS_PER_CALL in una sola chiamata.
async function callApify(tag) {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?timeout=280`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apifyToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hashtags: [tag], resultsPerPage: RESULTS_PER_CALL }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Apify: ${res.status} ${text}`);
  }
  const items = JSON.parse(text);
  return { items: items.map(mapApifyItem), costUsd: items.length * APIFY_COST_PER_ITEM_USD };
}

function mapApifyItem(item) {
  if (!item.webVideoUrl) return null;
  return {
    platform: "tiktok",
    handle: item.authorMeta?.name ?? item.authorMeta?.nickName ?? null,
    url: normalizeTikTokUrl(item.webVideoUrl),
    date:
      item.createTimeISO ??
      (item.createTime ? new Date(item.createTime * 1000).toISOString() : null),
    caption: item.text ?? null,
    location: null,
    views: item.playCount ?? null,
    likes: item.diggCount ?? null,
    comments: item.commentCount ?? null,
    shares: item.shareCount ?? null,
  };
}

// --- ScrapeCreators ---
// Keyword search (/v1/tiktok/search/keyword, parametro `query`), non più
// hashtag search (/v1/tiktok/search/hashtag, parametro `hashtag`): cambio
// deciso il 9/09/2026 dopo aver visto che la ricerca per hashtag, anche con
// paginazione vera via cursore, satura in fretta (0 post nuovi su #bluserena
// dopo 2 pagine reali) — la keyword search cerca il termine ovunque nel
// testo/caption, non solo tra gli hashtag formali del post, quindi copre
// anche i video che citano il termine senza usarlo come hashtag.
//
// Stesso schema di paginazione dell'endpoint hashtag (`cursor`/`has_more`),
// confermato per quello e assunto uguale per questo — sono endpoint fratelli
// sotto lo stesso v1/tiktok/search/*. Non verificabile da qui in anticipo
// (rete di sviluppo bloccata su scrapecreators.com): la risposta completa
// viene loggata alla prima chiamata di ogni termine per confermarlo, e se
// tutti gli item risultano senza URL utilizzabile lo si segnala esplicitamente
// invece di lasciar passare in silenzio come "zero risultati".
let scDiagLoggedFor = null;
async function callScrapeCreators(tag, cursor) {
  const url = new URL("https://api.scrapecreators.com/v1/tiktok/search/keyword");
  url.searchParams.set("query", tag);
  // cursor != null invece di un semplice truthy check: un cursore "0" è
  // falsy ma potrebbe essere un valore di pagina legittimo.
  if (cursor != null && cursor !== "") url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { headers: { "x-api-key": scrapeCreatorsKey } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ScrapeCreators: ${res.status} ${text}`);
  }
  const data = JSON.parse(text);
  // search_item_list confermato su un run reale (9/09/2026, chiavi risposta:
  // success, credits_remaining, credits_charged, search_item_list, cursor,
  // has_more): la ricerca per keyword usa un nome diverso da quello della
  // ricerca per hashtag (aweme_list), da cui lo "0 video restituiti" del
  // primo run dopo il cambio di endpoint — la richiesta funzionava (crediti
  // scalati regolarmente), il parsing della risposta no.
  const list = data.search_item_list ?? data.aweme_list ?? data.videos ?? [];
  if (data.credits_remaining != null) {
    console.log(`  (ScrapeCreators: ${data.credits_remaining} crediti residui)`);
  }
  if (scDiagLoggedFor !== tag) {
    console.log(
      `  (diagnostica keyword search — chiavi risposta: ${Object.keys(data).join(", ")})`,
    );
    scDiagLoggedFor = tag;
  }

  const items = list.map(mapScrapeCreatorsItem);
  if (list.length > 0 && items.every((i) => i == null)) {
    console.log(
      `  ⚠️  ${list.length} risultati ma nessuno con URL riconoscibile: probabile forma diversa ` +
        `dell'item rispetto alla ricerca per hashtag, non un vero zero risultati.`,
    );
  }

  return {
    items,
    costUsd: 0, // 1 credito/chiamata, non per risultato
    cursor: data.has_more ? data.cursor : null,
  };
}

function mapScrapeCreatorsItem(rawItem) {
  // Le API di ricerca generica di TikTok (a differenza di quella per
  // hashtag, che consegna oggetti aweme già "piatti") in genere annidano il
  // video vero sotto `aweme_info`, con `rawItem` che resta un wrapper con
  // `type`/altri metadati di ricerca attorno. Non verificato per QUESTO
  // endpoint in anticipo (rete di sviluppo bloccata su scrapecreators.com):
  // se `aweme_info` non c'è si usa `rawItem` stesso, così un item già piatto
  // funziona comunque.
  const item = rawItem.aweme_info ?? rawItem;
  const rawUrl =
    item.share_url ??
    (item.aweme_id
      ? `https://www.tiktok.com/@${item.author?.unique_id}/video/${item.aweme_id}`
      : null);
  if (!rawUrl) return null;
  return {
    platform: "tiktok",
    handle: item.author?.unique_id ?? item.author?.nickname ?? null,
    url: normalizeTikTokUrl(rawUrl),
    date: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    caption: item.desc ?? null,
    location: null,
    views: item.statistics?.play_count ?? null,
    likes: item.statistics?.digg_count ?? null,
    comments: item.statistics?.comment_count ?? null,
    shares: item.statistics?.share_count ?? null,
  };
}

const SOURCES = [
  { name: "Apify", enabled: !!apifyToken, call: callApify },
  { name: "ScrapeCreators", enabled: !!scrapeCreatorsKey, call: callScrapeCreators },
];

// Aggiorna un post già presente con i campi che gli mancano (mai sovrascrive
// un valore già presente) — non conta come "nuovo" post.
function enrichExisting(existing, fresh) {
  let changed = false;
  for (const field of [
    "date",
    "caption",
    "location",
    "views",
    "likes",
    "comments",
    "shares",
    "handle",
  ]) {
    if ((existing[field] == null || existing[field] === "") && fresh[field] != null) {
      existing[field] = fresh[field];
      changed = true;
    }
  }
  return changed;
}

// Esegue il backfill per UN hashtag/canale. Scrive lo store (via
// commitNewPosts/commitField) a ogni chiamata che produce novità, ognuna
// sulla base di una lettura fresca — non di una copia tenuta in memoria per
// tutto il run, vedi il commento in testa al file sul perché. sourceIdx
// parte sempre dalla prima fonte abilitata: se una fonte esaurisce il
// credito su un hashtag, per quello successivo si riparte comunque da capo
// (magari nel frattempo il credito è tornato, e comunque il costo di
// riprovare una fonte già esaurita è un solo errore veloce).
async function backfillHashtag(tag, canaleName) {
  let sourceIdx = SOURCES.findIndex((s) => s.enabled);
  let call = 0;
  let totalNewPosts = 0;
  let totalEnriched = 0;
  let totalNewInWindows = 0;
  let totalCostUsd = 0;
  let stopReason = "saturazione";
  // Il cursore vale solo per la fonte che l'ha prodotto: cambiando fonte
  // (fallback su errore) si riparte da capo, non ha senso passare un
  // cursore di ScrapeCreators ad Apify o viceversa.
  let cursor = null;

  while (call < MAX_CALLS) {
    if (sourceIdx === -1 || sourceIdx >= SOURCES.length) {
      stopReason = "fonti esaurite";
      break;
    }
    const source = SOURCES[sourceIdx];
    call++;
    console.log(`--- Chiamata ${call}/${MAX_CALLS} (fonte: ${source.name}) ---`);

    let result;
    try {
      result = await source.call(tag, cursor);
    } catch (err) {
      console.error(`  Errore su ${source.name}: ${err.message}`);
      const nextIdx = SOURCES.findIndex((s, i) => i > sourceIdx && s.enabled);
      call--; // la chiamata fallita non conta sul tetto massimo, non ha prodotto nulla
      if (nextIdx === -1) {
        stopReason = "fonti esaurite";
        break;
      }
      console.log(`  Passo alla fonte successiva: ${SOURCES[nextIdx].name}.`);
      sourceIdx = nextIdx;
      cursor = null;
      continue;
    }

    cursor = result.cursor ?? null;
    totalCostUsd += result.costUsd;
    console.log(
      `  ${result.items.length} video restituiti` +
        (source.name === "ScrapeCreators" ? ` (prossimo cursore: ${cursor ?? "nessuno"})` : "") +
        ".",
    );

    // Classificazione su una lettura fresca dello store, fatta ORA — non
    // sulla lista di target letta a inizio run: tra una chiamata e l'altra
    // passano DELAY_BETWEEN_CALLS_MS (30s di default) e possono essere già
    // passati altri hashtag di questo stesso run, per non parlare di altri
    // workflow. `presenti` decide solo new-vs-arricchimento; la scrittura
    // vera e propria (commitNewPosts/commitField) rilegge di nuovo lo store
    // un'ultima volta appena prima di salvare, quindi resta corretta anche
    // se qualcosa cambia nel frattempo fra questa lettura e quella scrittura.
    const { store: frescoStore } = await readStore();
    const canaleFresco = (frescoStore.canali || []).find(
      (c) => (c.name || "").toLowerCase() === canaleName.toLowerCase(),
    );
    const presenti = new Map((canaleFresco?.accounts || []).map((a) => [a.url, a]));

    const nuovi = [];
    const daArricchire = new Map(); // url ESATTO già nello store -> record fresco della fonte
    let newInWindowsThisCall = 0;
    for (const post of result.items) {
      if (!post) continue;
      const existing = presenti.get(post.url);
      if (existing) {
        daArricchire.set(existing.url, post);
        continue;
      }
      nuovi.push(post);
      if (inWindows(post.date ? new Date(post.date) : null)) newInWindowsThisCall++;
    }

    let newThisCall = 0;
    if (nuovi.length) {
      const { aggiunti } = await commitNewPosts({
        byChannel: new Map([[canaleName, nuovi]]),
        message: `chore: backfill storico hashtag TikTok #${tag} [trendzn-bot]`,
        normalizeUrl: normalizeTikTokUrl,
      });
      newThisCall = aggiunti;
    }

    let enrichedThisCall = 0;
    if (daArricchire.size) {
      enrichedThisCall = await commitField({
        field: "backfillEnrichment", // inutilizzato: si passa sempre `apply`
        updates: daArricchire,
        message: `chore: arricchimento storico hashtag TikTok #${tag} [trendzn-bot]`,
        apply: enrichExisting,
      });
    }

    totalNewPosts += newThisCall;
    totalEnriched += enrichedThisCall;
    totalNewInWindows += newInWindowsThisCall;
    console.log(
      `  ${newThisCall} post nuovi (${newInWindowsThisCall} nelle finestre di interesse), ${enrichedThisCall} post esistenti aggiornati.`,
    );

    if (call >= MIN_CALLS && newInWindowsThisCall === 0) {
      console.log(
        `  Nessun post nuovo nelle finestre dopo almeno ${MIN_CALLS} chiamate, mi fermo qui.`,
      );
      stopReason = "saturazione";
      break;
    }

    if (call === MAX_CALLS) {
      stopReason = "tetto massimo chiamate";
      break;
    }

    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  return { call, totalNewPosts, totalEnriched, totalNewInWindows, totalCostUsd, stopReason };
}

// --- Main ---
console.log(
  `Parametri: ${RESULTS_PER_CALL} risultati/chiamata (Apify), minimo ${MIN_CALLS} chiamate poi stop alla prima senza novità nelle finestre, tetto massimo ${MAX_CALLS} chiamate per hashtag.`,
);
console.log(
  `Finestre: ${WINDOW_A.start.toISOString().slice(0, 10)}..${WINDOW_A.end.toISOString().slice(0, 10)} e ${WINDOW_B.start.toISOString().slice(0, 10)}..${WINDOW_B.end.toISOString().slice(0, 10)}`,
);
console.log(
  `Fonti disponibili: ${
    SOURCES.filter((s) => s.enabled)
      .map((s) => s.name)
      .join(" -> ") || "nessuna"
  }\n`,
);

// Solo per costruire l'elenco dei target (tag + nome canale): la scrittura
// vera passa sempre da letture fresche dentro backfillHashtag, non da
// questa copia.
const { store } = await readStore();

const hashtagCanali = store.canali
  .map((c) => ({ canaleName: c.name, info: hashtagInfo(c.urls?.[0] ?? "") }))
  .filter((x) => x.info);

let targets;
if (requestedTag) {
  const match = hashtagCanali.find((x) => x.info.tag.toLowerCase() === requestedTag.toLowerCase());
  if (!match) {
    console.error(
      `Nessun canale hashtag TikTok #${requestedTag} trovato in ${STORE_PATH}. Aggiungilo prima dall'app, poi rilancia questo script.`,
    );
    process.exit(1);
  }
  targets = [match];
} else {
  targets = hashtagCanali;
  console.log(
    `Nessun hashtag specificato: processo tutti i ${targets.length} hashtag TikTok nello store.\n`,
  );
}

const results = [];
for (let i = 0; i < targets.length; i++) {
  const { canaleName, info } = targets[i];
  console.log(`\n=== [${i + 1}/${targets.length}] Backfill storico TikTok: #${info.tag} ===`);
  const summary = await backfillHashtag(info.tag, canaleName);
  results.push({ tag: info.tag, ...summary });

  if (i < targets.length - 1) {
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }
}

console.log("\n\n=== Riepilogo complessivo ===");
for (const r of results) {
  console.log(
    `#${r.tag}: ${r.call} chiamate, ${r.totalNewPosts} post nuovi (${r.totalNewInWindows} nelle finestre), ${r.totalEnriched} arricchiti, stop per "${r.stopReason}", costo Apify ~$${r.totalCostUsd.toFixed(2)}`,
  );
}
const grandTotalNew = results.reduce((sum, r) => sum + r.totalNewPosts, 0);
const grandTotalInWindows = results.reduce((sum, r) => sum + r.totalNewInWindows, 0);
const grandTotalEnriched = results.reduce((sum, r) => sum + r.totalEnriched, 0);
const grandTotalCost = results.reduce((sum, r) => sum + r.totalCostUsd, 0);
const grandTotalCalls = results.reduce((sum, r) => sum + r.call, 0);
console.log(
  `\nTotale: ${targets.length} hashtag, ${grandTotalCalls} chiamate, ${grandTotalNew} post nuovi (${grandTotalInWindows} nelle finestre), ${grandTotalEnriched} arricchiti, costo Apify stimato ~$${grandTotalCost.toFixed(2)} (ScrapeCreators: 1 credito/chiamata, vedi log sopra per i crediti residui).`,
);
console.log(
  "\nQuando un hashtag si ferma per saturazione o fonti esaurite, il suo monitoraggio prosegue solo con lo scraping DIY quotidiano (sync-bluserena-hashtags.yml).",
);
