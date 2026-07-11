// Ricontrolla like/commenti dei contenuti Instagram già in
// viral_trend_content (scoperti da sync-viral-trends.mjs) usando solo
// browsing pubblico anonimo (scripts/lib/instagram-public-metrics.mjs) —
// nessun credit anysite, nessun login. Copre solo like+commenti, non
// views/reshare (Instagram non li mostra a un visitatore anonimo).
//
// Volutamente separato da sync-viral-trends.mjs: la scoperta di nuovi topic
// (anysite, a pagamento) e il ricontrollo dei post già noti (gratuito) sono
// due processi indipendenti — questo può girare più spesso perché non ha
// nessun costo di credit, avvicinandoci alla finestra di rilevazione "attuale
// e ristretta" richiesta fin dall'inizio, che con un solo sync al giorno non
// era possibile ottenere.
//
// Rivisitando ogni post nella finestra di 7gg, questo script è anche il
// punto giusto per applicare RETROATTIVAMENTE il filtro lingua italiana
// (looksItalian) introdotto in discover-instagram-hashtag-content.mjs (PR
// #122): quel filtro valeva solo per i contenuti scoperti da quel momento in
// poi, i post già sincronizzati dal percorso gratuito via hashtag (che prima
// non filtrava per lingua) restano da ripulire. Un post che non risulta più
// italiano viene cancellato invece che aggiornato — vedi looksItalian import
// sotto e il ramo deletions.
//
// Variabili d'ambiente:
//   MAX_POSTS               default: 150 — quanti contenuti Instagram ricontrollare per run
//   DELAY_BETWEEN_CALLS_MS  default: 1500 — pausa tra un post e l'altro
//
// Eseguito da .github/workflows/recheck-viral-engagement.yml su schedule.

import { openInstagramMetricsSession } from "./lib/instagram-public-metrics.mjs";
import { looksItalian } from "./lib/social-search.mjs";

const LIST_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/list-instagram-content-urls";
const RECHECK_ENDPOINT = "https://trendzn.lovable.app/api/public/hooks/recheck-viral-engagement";

const MAX_POSTS = parseInt(process.env.MAX_POSTS ?? "150", 10);
const DELAY_MS = parseInt(process.env.DELAY_BETWEEN_CALLS_MS ?? "1500", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchContentToRecheck() {
  const res = await fetch(`${LIST_ENDPOINT}?limit=${MAX_POSTS}`);
  if (!res.ok) {
    throw new Error(`list-instagram-content-urls failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`list-instagram-content-urls error: ${data.error}`);
  return data.items ?? [];
}

async function sendUpdates(updates, deletions) {
  const res = await fetch(RECHECK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates, deletions }),
  });
  if (!res.ok) {
    throw new Error(`recheck-viral-engagement failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// --- Main ---
console.log("=== TRENDZN — Ricontrollo engagement Instagram (gratuito) ===");

const items = await fetchContentToRecheck();
console.log(`Contenuti Instagram da ricontrollare: ${items.length}`);

if (items.length === 0) {
  console.log("Nulla da ricontrollare.");
  process.exit(0);
}

const session = await openInstagramMetricsSession();
const updates = [];
const deletions = [];
let failed = 0;
let skippedNotItalian = 0;

try {
  for (const item of items) {
    const { metrics } = await session.fetchMetricsDetailed(item.url);
    if (!metrics) {
      failed++;
    } else if (!looksItalian(metrics.caption)) {
      deletions.push({ platform: item.platform, external_id: item.external_id });
      skippedNotItalian++;
    } else {
      updates.push({ platform: item.platform, external_id: item.external_id, ...metrics });
    }
    await sleep(DELAY_MS);
  }
} finally {
  await session.close();
}

console.log(
  `Metriche recuperate: ${updates.length}/${items.length} (${failed} falliti/non pubblici, ${skippedNotItalian} non italiani -> da cancellare)`,
);

if (updates.length > 0 || deletions.length > 0) {
  const result = await sendUpdates(updates, deletions);
  console.log(
    `Aggiornati nel database: ${result.updated ?? 0}, cancellati: ${result.deleted ?? 0}`,
  );
} else {
  console.log("Nessun aggiornamento da inviare.");
}
