// Probe diagnostico: verifica che, con un account X dedicato (autenticazione via
// cookie codificati in RETTIWT_API_KEY), riusciamo a leggere i post recenti di
// un profilo e le relative metriche di engagement (like/repost/reply/views).
//
// Non modifica nulla: stampa solo cosa riesce a recuperare. Da lanciare via il
// workflow "Probe X Account" (workflow_dispatch) dopo aver aggiunto il secret
// RETTIWT_API_KEY al repo. Serve a decidere se la strada "account dedicato +
// cookie" regge, prima di costruire la sync X per ASPI-monitoring.
//
// rettiwt-api viene installato al volo dal workflow (npm install --no-save), non
// è (ancora) una dipendenza del progetto.

import { Rettiwt } from "rettiwt-api";

const API_KEY = process.env.RETTIWT_API_KEY;
const TARGET = (process.env.PROBE_SCREEN_NAME || "X").replace(/^@/, "").trim();

function line(...args) {
  console.log(...args);
}

async function main() {
  line("=== Probe X account ===");
  line("target:", "@" + TARGET);

  if (!API_KEY) {
    console.error("ERRORE: RETTIWT_API_KEY non configurato (secret mancante).");
    process.exit(1);
  }
  line("API_KEY presente:", `sì (${API_KEY.length} char)`);

  const rettiwt = new Rettiwt({ apiKey: API_KEY });

  // 1) Verifica autenticazione + risoluzione profilo
  let userId = null;
  try {
    const details = await rettiwt.user.details(TARGET);
    userId = details?.id ?? null;
    line("");
    line("[user.details] OK");
    line("  userName:", details?.userName);
    line("  fullName:", details?.fullName);
    line("  id:", userId);
    line("  followers:", details?.followersCount);
    line("  statuses:", details?.statusesCount);
  } catch (err) {
    console.error("[user.details] FALLITO:", err?.message || String(err));
    console.error("  → probabile problema di autenticazione (cookie scaduti/flaggati) o account non trovato.");
  }

  // 2) Recupero post recenti + engagement
  try {
    const res = await rettiwt.tweet.search({ fromUsers: [TARGET] });
    const list = res?.list ?? (Array.isArray(res) ? res : []);
    line("");
    line("[tweet.search fromUsers] OK");
    line("  post recuperati:", list.length);

    list.slice(0, 5).forEach((t, i) => {
      const handle = t?.tweetBy?.userName ?? TARGET;
      const url = t?.id ? `https://x.com/${handle}/status/${t.id}` : "(no id)";
      line("");
      line(`  #${i + 1} ${url}`);
      line("     data:", t?.createdAt);
      line(
        "     engagement:",
        `like=${t?.likeCount} repost=${t?.retweetCount} reply=${t?.replyCount} quote=${t?.quoteCount} views=${t?.viewCount}`,
      );
      const text = (t?.fullText || "").replace(/\s+/g, " ").slice(0, 100);
      line("     testo:", text);
    });

    if (list[0]) {
      line("");
      line("  RAW chiavi primo post:", Object.keys(list[0]).join(", "));
    }
  } catch (err) {
    console.error("[tweet.search fromUsers] FALLITO:", err?.message || String(err));
  }

  line("");
  line("=== Fine probe ===");
}

main().catch((err) => {
  console.error("Errore inatteso:", err?.message || String(err));
  process.exit(1);
});
