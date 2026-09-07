// Recupera views/likes/comments/shares per i post Bluserena BSConfirmed
// nella finestra Jul-Ago 2025/2026, usando il modulo Emplifi LISTENING (non
// gli endpoint "profili gestiti" della Analytics API, che richiedono account
// collegati/pubblicati — i post monitorati qui sono di terzi, quindi vanno
// cercati via Listening query).
//
// Perimetro ristretto ai soli BSConfirmed: gli altri sono omonimie da
// hashtag (hotel Serena in Uganda, Pakistan...) e non entrano nelle
// statistiche della pagina — pagare crediti Emplifi per le loro metriche
// sarebbe soldi buttati. Sui dati del 07/09, sono 338 post su 1310.
//
// Precedenza sulle fonti KPI già esistenti: 218 di quei 338 hanno già
// views/like/commenti/condivisioni da backfill-tiktok-hashtag.mjs
// (Apify + ScrapeCreators) — dati dal singolo video, non da un aggregatore
// di terze parti. Emplifi non li tocca mai: entra in gioco SOLO sui post che
// non hanno ancora nessun KPI da nessuna parte, cioè quando i suoi sarebbero
// gli UNICI numeri disponibili per quel post. Vedi hasExistingMetrics() e il
// commento su applyEngagement() più sotto per il dettaglio.
//
// Idempotenza: ogni post tentato riceve un record in engagementData con
// status e version, sullo stesso schema di sentimentData/ocrData/
// audioAnalysis. Un post già tentato (qualunque esito) non viene rifatto
// finché non cambia la VERSION dello script. Questo è il meccanismo che fa
// "ripartire l'analisi solo per i post che hanno cambiato status": un post
// che passa da unconfirmed a confirmed non ha ancora un record — entra nel
// perimetro alla run successiva e viene processato lui solo, senza toccare
// gli altri 337 già fatti.
//
// Flusso:
//   1. GET /3/listening/queries  -> risolve l'ID della query "Bluserena"
//      (nome configurato lato dashboard Emplifi).
//   2. POST /3/listening/posts   -> scarica TUTTI i post della query per le
//      due finestre Jul-Ago (2025 e 2026), in blocco: Emplifi risponde per
//      query+intervallo, non per singolo post, quindi si scarica una volta
//      sola e si fa il match in locale — non ha senso richiamarlo per ogni
//      candidato.
//   3. Match per URL normalizzato con i post BSConfirmed non ancora tentati.
//
// ATTENZIONE: il path e i nomi dei campi di risposta NON sono confermati da
// documentazione pubblica (l'host api.emplifi.io non è raggiungibile da
// questo ambiente di sviluppo per verificarli), sono dedotti dal pattern
// generale delle altre API Emplifi. Se il primo run fallisce o i campi non
// matchano, il log stampa status + body grezzo + le chiavi del primo item
// per poter correggere senza dover indovinare di nuovo alla cieca — usare
// DRY_RUN=true per il primo tentativo, così un path/campo sbagliato non
// scrive nulla di sbagliato nello store.
//
// Env:
//   EMPLIFI_API_TOKEN / EMPLIFI_API_SECRET: obbligatorie
//   GITHUB_TOKEN: obbligatoria
//   DRY_RUN: (opzionale) se true, logga cosa scriverebbe senza committare
//   REPROCESS_NOT_FOUND: (opzionale) riprova anche i post non trovati
//     nell'ultima run — di default no, per non ripetere ogni giorno la
//     stessa query su un post che Emplifi probabilmente non indicizzerà mai

import { readStore, commitField, eachAccount } from "./lib/bluserena-store.mjs";

// Alzare quando cambia l'estrazione dei campi o l'endpoint: il prossimo run
// rifà tutti i BSConfirmed della finestra, non solo i nuovi.
const VERSION = 1;

const EMPLIFI_API_BASE = "https://api.emplifi.io/3";
const LISTENING_QUERY_NAME = process.env.EMPLIFI_LISTENING_QUERY_NAME || "Bluserena";
const PAGE_LIMIT = 200;
const DRY_RUN = process.env.DRY_RUN === "true";
const REPROCESS_NOT_FOUND = process.env.REPROCESS_NOT_FOUND === "true";

// Stessa finestra usata dal resto della pipeline Bluserena (confronto
// Jul-Ago anno su anno). Copiata qui invece che importata: ogni script che
// la usa (analyze-bluserena-sentiment-topic.mjs, lib/bluserena-enrich.mjs)
// ne tiene una copia locale identica, per non far dipendere script diversi
// da un unico modulo che nessuno dei due possiede.
const WINDOWS = [
  { start: "2025-07-01", end: "2025-08-31" },
  { start: "2026-07-01", end: "2026-08-31" },
];

function inWindow(dateStr) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return WINDOWS.some((w) => d >= w.start && d <= w.end);
}

const EMPLIFI_API_SECRET = process.env.EMPLIFI_API_SECRET;
const EMPLIFI_API_TOKEN = process.env.EMPLIFI_API_TOKEN;

if (!EMPLIFI_API_SECRET || !EMPLIFI_API_TOKEN) {
  console.error("❌ Mancano EMPLIFI_API_SECRET / EMPLIFI_API_TOKEN nell'ambiente.");
  process.exit(1);
}

// Formato confermato da documentazione Emplifi: "token:secret" (non il
// contrario) codificato in base64. L'inversione era la causa del 401
// "Authorization is not valid" nel primo run reale della versione precedente
// di questo script.
const authHeader = `Basic ${Buffer.from(`${EMPLIFI_API_TOKEN}:${EMPLIFI_API_SECRET}`).toString("base64")}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

async function emplifiRequest(path, { method = "GET", body } = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${EMPLIFI_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const text = await res.text();

      if (!res.ok) {
        // 4xx: non ha senso ritentare, il path/parametri sono sbagliati.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 2000)}`);
        }
        // 5xx: può essere transitorio, ritenta.
        if (attempt < retries) {
          console.error(`  ⚠️  ${method} ${path} -> ${res.status}, retry ${attempt}/${retries}...`);
          await sleep(2 ** attempt * 1000);
          continue;
        }
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 2000)}`);
      }

      const parsed = text ? JSON.parse(text) : null;

      // L'API Emplifi risponde 200 anche per errori logici (validazione
      // input, ecc.), con {"success":false,...} nel body: senza questo
      // controllo un errore del genere passerebbe per una risposta valida.
      if (parsed && parsed.success === false) {
        throw new Error(`${method} ${path} -> 200 ma success:false: ${text.slice(0, 2000)}`);
      }

      return parsed;
    } catch (err) {
      if (err.name === "AbortError" || err.message?.includes("fetch failed")) {
        if (attempt < retries) {
          console.error(
            `  ⚠️  ${method} ${path} -> ${err.message}, retry ${attempt}/${retries}...`,
          );
          await sleep(2 ** attempt * 1000);
          continue;
        }
      }
      throw err;
    }
  }
}

async function resolveListeningQueryId(name) {
  console.log(`🔎 Cerco la Listening query "${name}"...`);
  const data = await emplifiRequest("/listening/queries");
  const queries = data?.data ?? data?.queries ?? (Array.isArray(data) ? data : []);

  if (!Array.isArray(queries) || queries.length === 0) {
    console.error("❌ Nessuna Listening query trovata nella risposta. Risposta grezza:");
    console.error(JSON.stringify(data).slice(0, 1000));
    process.exit(1);
  }

  console.log(`   Trovate ${queries.length} query: ${queries.map((q) => q.name).join(", ")}`);

  const match = queries.find((q) => (q.name || "").toLowerCase() === name.toLowerCase());
  if (!match) {
    console.error(`❌ Nessuna query chiamata "${name}" tra quelle disponibili.`);
    process.exit(1);
  }

  console.log(`   ✅ Query "${match.name}" -> id=${match.id}`);
  return match.id;
}

async function fetchListeningPosts(queryId, dateStart, dateEnd) {
  console.log(`   📄 Richiesta per ${dateStart}..${dateEnd}...`);
  const data = await emplifiRequest("/listening/posts", {
    method: "POST",
    body: {
      listening_queries: [queryId],
      date_start: dateStart,
      date_end: dateEnd,
      fields: [
        "id",
        "url",
        "message",
        "author",
        "created_time",
        "platform",
        "media_type",
        "content_type",
        "comments",
        "shares",
        "interactions",
        "potential_impressions",
        "post_labels",
        "sentiment",
      ],
      limit: PAGE_LIMIT,
    },
  });

  const items = data?.data ?? data?.posts ?? data?.mentions ?? (Array.isArray(data) ? data : []);
  console.log(`   ${Array.isArray(items) ? items.length : 0} post ricevuti.`);
  if (Array.isArray(items) && items.length > 0) {
    console.log(`   Campi disponibili nel primo item: ${Object.keys(items[0]).join(", ")}`);
  } else {
    console.log("   Risposta grezza (primi 1000 char): " + JSON.stringify(data).slice(0, 1000));
  }

  return Array.isArray(items) ? items : [];
}

function extractPostUrl(item) {
  return item.url || item.post_link || item.permalink || item.link || null;
}

function extractMetrics(item) {
  // Emplifi Listening non fornisce views/likes direttamente: solo commenti,
  // condivisioni e interazioni totali. Questi sono usati come fallback quando
  // nessun'altra fonte (Apify/ScrapeCreators) ha i dati più precisi. La
  // caption viene riportata per eventuali usi futuri, ma non sovrascrive mai
  // quella già presente nel post.
  return {
    caption: item.message || item.content || item.text || item.caption || null,
    views: null, // Listening non espone views direttamente
    likes: null, // Listening non espone likes direttamente
    comments: item.comments ?? null,
    shares: item.shares ?? null,
    interactions: item.interactions ?? null,
    potential_impressions: item.potential_impressions ?? null,
  };
}

// Emplifi è l'ultima arrivata delle fonti KPI: backfill-tiktok-hashtag.mjs
// (Apify + ScrapeCreators) gira da prima e ha già popolato 218 dei 338
// BSConfirmed nella finestra. Quei numeri sono la fonte "primaria" — vengono
// da chi guarda il singolo video, non da un aggregatore di terze parti — e
// Emplifi non deve mai scavalcarli: entra in gioco SOLO quando un post non
// ha ancora nessun KPI da nessuna parte.
//
// `hasExistingMetrics` va controllato su un dato FRESCO (l'account che
// commitField ri-legge appena prima di scrivere), non su quello raccolto in
// fase di selezione: se backfill-tiktok-hashtag.mjs ha scritto i suoi numeri
// nel frattempo — anche a metà della stessa run, sono due workflow diversi
// che possono girare in parallelo — questo controllo li vede e si ferma,
// invece di sovrascriverli con un dato peggiore arrivato prima nella corsa.
function hasExistingMetrics(account) {
  return (
    account.views != null ||
    account.likes != null ||
    account.comments != null ||
    account.shares != null
  );
}

// Il record vive in engagementData, ma la UI legge i campi piatti
// views/likes/comments/shares: quando Emplifi li applica davvero (status
// "ok"), vanno aggiornati insieme. Quando trova dati ma un'altra fonte è
// arrivata prima, il record resta per tracciabilità (si è cercato, si è
// trovato qualcosa) ma con status "shadowed": i campi piatti non si
// toccano, è quel record — non questo — a spiegare perché i numeri visti
// nella UI non sono i suoi.
//
// La caption, quando Emplifi la restituisce e il post non ne ha già una
// propria, viene riportata a costo zero (stesso payload) ma MAI in
// sovrascrittura: una caption già presente (corretta a mano, o letta dalla
// pagina TikTok) vale più di quella che arriva da un aggregatore.
//
// Nota: Emplifi Listening fornisce solo comments/shares (e interactions/
// potential_impressions per riferimento). Views e likes non sono disponibili
// da Listening e rimangono null; solo altre fonti (Apify/ScrapeCreators)
// le forniscono.
function applyEngagement(account, record) {
  if (record.status === "ok" && hasExistingMetrics(account)) {
    account.engagementData = { ...record, status: "shadowed" };
    return;
  }

  account.engagementData = record;
  if (record.status !== "ok") return;
  // Emplifi Listening fornisce solo comments e shares, non views/likes
  if (record.comments != null) account.comments = record.comments;
  if (record.shares != null) account.shares = record.shares;
  if (record.caption && !account.caption) account.caption = record.caption;
}

async function main() {
  console.log("=== KPI engagement Bluserena via Emplifi Listening ===\n");
  if (DRY_RUN) console.log("DRY_RUN: nessuna scrittura, solo report.\n");

  const { store } = await readStore();

  const candidates = [];
  let totaleConfermatiInFinestra = 0;
  let giaConAltraFonte = 0;
  let giaFatti = 0;

  for (const { account } of eachAccount(store)) {
    if (account.verificationStatus !== "confirmed") continue;
    if (!inWindow(account.date)) continue;
    totaleConfermatiInFinestra++;

    // Il caso comune: 218 dei 338 BSConfirmed hanno già i KPI da
    // backfill-tiktok-hashtag.mjs (Apify/ScrapeCreators). Per questi Emplifi
    // non ha nulla da fare — non sono "gli unici KPI presenti" — quindi non
    // li si interroga nemmeno: risparmia il giro e tiene il log pulito. Non è
    // solo un'ottimizzazione: è la stessa regola di precedenza applicata qui
    // invece che dentro applyEngagement, dove serve comunque restare (vedi
    // commento lì) per il caso raro in cui un'altra fonte scriva i suoi
    // numeri PROPRIO durante questa run.
    if (hasExistingMetrics(account)) {
      giaConAltraFonte++;
      continue;
    }

    const existing = account.engagementData;
    const corrente = Boolean(existing?.status) && (existing.version ?? 0) >= VERSION;
    if (corrente) {
      if (!REPROCESS_NOT_FOUND || existing.status !== "not_found") {
        giaFatti++;
        continue;
      }
    }
    candidates.push(account);
  }

  console.log(`BSConfirmed nella finestra Jul-Ago 2025/2026: ${totaleConfermatiInFinestra}`);
  console.log(`Con KPI già da un'altra fonte (skip, Emplifi non li tocca): ${giaConAltraFonte}`);
  console.log(`Già tentati su Emplifi in una run precedente (skip): ${giaFatti}`);
  console.log(`Da recuperare in questa run: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log("Niente da fare: nessun post nuovo o ri-confermato senza KPI da recuperare.");
    return;
  }

  const queryId = await resolveListeningQueryId(LISTENING_QUERY_NAME);

  console.log(
    `\n🔄 Scarico i post dalla Listening query (un colpo solo per finestra, non per post)...\n`,
  );
  const allItems = [];
  for (const w of WINDOWS) {
    allItems.push(...(await fetchListeningPosts(queryId, w.start, w.end)));
  }
  console.log(`\n📊 ${allItems.length} post scaricati da Emplifi Listening in totale.\n`);

  const itemByUrl = new Map();
  for (const item of allItems) {
    const url = extractPostUrl(item);
    if (url) itemByUrl.set(normalizeUrl(url), item);
  }

  const updates = new Map();
  const stats = {};
  const now = new Date().toISOString();

  for (const account of candidates) {
    const item = itemByUrl.get(normalizeUrl(account.url));
    let record;

    if (!item) {
      record = { status: "not_found", version: VERSION, updatedAt: now };
    } else {
      const metrics = extractMetrics(item);
      // Controlla se almeno uno dei campi disponibili è presente
      const hasAnyMetric = [
        metrics.comments,
        metrics.shares,
        metrics.interactions,
        metrics.potential_impressions,
      ].some((v) => v != null);
      record = hasAnyMetric
        ? { status: "ok", source: "emplifi", ...metrics, version: VERSION, updatedAt: now }
        : { status: "no_metrics", version: VERSION, updatedAt: now };
    }

    stats[record.status] = (stats[record.status] ?? 0) + 1;
    updates.set(account.url, record);
  }

  console.log("Esiti:");
  for (const [status, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN: store non scritto.");
    return;
  }

  console.log(`\n💾 Scrivo su GitHub...`);
  const applied = await commitField({
    field: "engagementData",
    updates,
    message: `chore: KPI engagement su ${updates.size} post Bluserena BSConfirmed [trendzn-bot]

Views/like/commenti/condivisioni via Emplifi Listening, solo sui post
BSConfirmed della finestra Jul-Ago 2025/2026 non ancora tentati.
${stats.ok ?? 0} con metriche, ${stats.not_found ?? 0} non trovati su Emplifi, ${stats.no_metrics ?? 0} trovati senza metriche.`,
    apply: applyEngagement,
  });
  console.log(`✅ ${applied} post scritti.`);
}

await main();
