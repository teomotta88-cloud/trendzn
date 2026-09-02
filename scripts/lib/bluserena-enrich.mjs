// Driver condiviso dei due script di arricchimento Bluserena (OCR e
// trascrizione audio). Ognuno dei due possiede UN campo dello store e non
// tocca nient'altro: qui vive tutta la parte comune — selezione dei post,
// budget di esecuzione, commit incrementali, riepilogo.
//
// Tre problemi del vecchio codice risolti qui:
//
//  1. Copertura. Il cap "postsToAnalyze > 100" rompeva ANCHE il loop sui
//     canali, quindi si restava sempre dentro il primo canale: 100 post su
//     1444 eleggibili, sempre gli stessi. Qui i candidati si raccolgono su
//     tutti i canali e il budget taglia solo la coda.
//
//  2. Idempotenza. Lo skip era `if (account.ocrData)`, ma ocrData veniva
//     scritto solo in caso di successo: siccome l'OCR falliva sempre, nessun
//     post veniva mai marcato e ogni run ripartiva dagli stessi 100. Qui il
//     record viene scritto SEMPRE, anche in caso di fallimento, con uno
//     `status` che dice com'è andata; la run successiva riprende da dove si
//     era fermata. REPROCESS_FAILED=true riprova i post con status != "ok".
//
//  3. Durabilità. Un solo commit in fondo alla run significa che un conflitto
//     o un timeout del job buttano via tutto. Qui si committa ogni
//     BATCH_SIZE post.

import { readStore, eachAccount, commitField } from "./bluserena-store.mjs";

// Stessi intervalli di prima: confronto anno-su-anno luglio-agosto.
const DATE_RANGES = [
  { start: new Date("2025-07-01T00:00:00Z"), end: new Date("2025-08-31T23:59:59Z") },
  { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-08-31T23:59:59Z") },
];

// Solo contenuti video: TikTok /video/, Instagram /reel/ o /reels/.
const VIDEO_URL = /\/(video|reel|reels)\//i;

function isInDateRange(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  return DATE_RANGES.some((r) => date >= r.start && date <= r.end);
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runEnrichment({ field, title, commitMessage, processPost }) {
  const maxPosts = intEnv("MAX_POSTS", 400);
  const maxMinutes = intEnv("MAX_MINUTES", 300);
  const batchSize = intEnv("BATCH_SIZE", 25);
  const reprocessFailed = process.env.REPROCESS_FAILED === "true";

  console.log(`${title}\n${"=".repeat(title.length)}\n`);
  console.log(
    `Budget: max ${maxPosts} post, max ${maxMinutes} min, commit ogni ${batchSize}` +
      `${reprocessFailed ? ", riprovo i falliti" : ""}\n`,
  );

  const { store } = await readStore();

  let eligible = 0;
  let done = 0;
  const queue = [];

  for (const { account } of eachAccount(store)) {
    if (!account.url || !VIDEO_URL.test(account.url)) continue;
    if (!isInDateRange(account.date)) continue;
    eligible++;

    // Solo i record scritti da QUESTO script contano come già elaborati: si
    // riconoscono dallo `status`. I record legacy della vecchia analisi LLM
    // non ce l'hanno e hanno transcript/testo nulli, quindi vanno rifatti —
    // altrimenti resterebbero esclusi per sempre (erano 100 post).
    const existing = account[field];
    if (existing?.status) {
      if (!reprocessFailed || existing.status === "ok") {
        done++;
        continue;
      }
    }
    queue.push(account);
  }

  console.log(`Post video nell'intervallo: ${eligible}`);
  console.log(`Già elaborati: ${done}`);
  console.log(`Da elaborare: ${queue.length} (in coda ora: ${Math.min(queue.length, maxPosts)})\n`);

  if (!queue.length) {
    console.log("Niente da fare.");
    return;
  }

  // Un guasto sistematico (TikTok che blocca i download, una chiave scaduta)
  // marcherebbe altrimenti centinaia di post come "tentati e falliti",
  // escludendoli dalle run successive. Dopo N fallimenti di fila senza un
  // solo esito buono si abortisce senza salvare nulla, e il workflow va rosso.
  const failFast = intEnv("FAIL_FAST", 5);
  // no_text/no_speech sono esiti legittimi: il video semplicemente non aveva
  // testo o parlato, la pipeline ha funzionato.
  const HEALTHY = new Set(["ok", "no_text", "no_speech"]);

  const deadline = Date.now() + maxMinutes * 60_000;
  const pending = new Map();
  const stats = {};
  let processed = 0;
  let committed = 0;
  let stoppedBy = null;
  let healthy = 0;
  let consecutiveFailures = 0;

  const flush = async () => {
    if (!pending.size) return;
    // commitField ritorna le OCCORRENZE scritte: lo stesso URL può comparire in
    // più canali e in quel caso il record finisce su tutte le copie.
    const occorrenze = await commitField({
      field,
      updates: pending,
      message: commitMessage(pending.size),
    });
    committed += pending.size;
    const extra = occorrenze > pending.size ? ` (${occorrenze} occorrenze)` : "";
    console.log(`  💾 Salvati ${pending.size} post${extra} — totale run: ${committed}\n`);
    pending.clear();
  };

  for (const account of queue) {
    if (processed >= maxPosts) {
      stoppedBy = `limite di ${maxPosts} post`;
      break;
    }
    if (Date.now() > deadline) {
      stoppedBy = `budget di ${maxMinutes} minuti`;
      break;
    }

    processed++;
    console.log(`[${processed}/${Math.min(queue.length, maxPosts)}] ${account.url}`);

    let record;
    try {
      record = await processPost(account);
    } catch (err) {
      // processPost non dovrebbe lanciare, ma un post rotto non deve mai
      // fermare la run: si registra l'errore e si va avanti.
      record = { status: "error", error: String(err?.message ?? err).slice(0, 200) };
    }

    record.updatedAt = new Date().toISOString();
    stats[record.status] = (stats[record.status] ?? 0) + 1;
    pending.set(account.url, record);

    if (HEALTHY.has(record.status)) {
      healthy++;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (!healthy && consecutiveFailures >= failFast) {
        // Niente flush: i post restano non marcati e la prossima run li rivede.
        pending.clear();
        console.error(
          `\n❌ ${consecutiveFailures} fallimenti di fila e nessun esito buono: ` +
            "sembra un guasto sistematico, non i singoli post.",
        );
        console.error(`   Ultimo errore: ${record.reason ?? record.status}`);
        console.error("   Niente salvato: i post restano da elaborare.");
        throw new Error("Interrotto per fallimenti consecutivi");
      }
    }

    if (pending.size >= batchSize) await flush();
  }

  await flush();

  console.log("\n📈 Riepilogo");
  console.log(`  Post elaborati: ${processed}`);
  console.log(`  Post salvati:   ${committed}`);
  for (const [status, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status}: ${count}`);
  }
  const left = queue.length - processed;
  if (stoppedBy) {
    console.log(`  Fermato dal ${stoppedBy}: restano ${left} post per la prossima run.`);
  } else {
    console.log("  Coda esaurita.");
  }
}
