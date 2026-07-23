import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const WORKFLOW_FILE = "run-discovery-pipeline.yml";
const REF = "main";

export const Route = createFileRoute("/api/public/hooks/trigger-discovery-pipeline")({
  server: {
    handlers: {
      // Avvia manualmente "Run Discovery Pipeline" (vedi
      // .github/workflows/run-discovery-pipeline.yml) — l'orchestratore che
      // fa girare tutte le fonti di discovery nell'ordine di dipendenza
      // corretto in un solo run, invece delle 12 GitHub Action separate a
      // cron sfalsato. Stesso pattern/stesso GITHUB_TOKEN già in uso per
      // trigger-sync-canali-feed.ts e trigger-sync-aspi-monitoring.ts (ha
      // già il permesso actions:write, verificato dal fatto che quei due
      // trigger funzionano in produzione).
      //
      // A differenza di quei due, qui il run può durare a lungo (l'intera
      // pipeline in cascata, non un singolo workflow leggero): prima di
      // avviarne uno nuovo, controlla se ce n'è già uno in corso — evita
      // due cascate sovrapposte per un doppio click, non per risparmiare
      // minuti Actions (illimitati e gratuiti su repo pubblico) ma per non
      // raddoppiare le richieste verso le fonti più delicate (Instagram,
      // Google Trends) nella stessa finestra di tempo.
      POST: async () => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return Response.json(
            { ok: false, error: "GITHUB_TOKEN non configurato" },
            { status: 500 },
          );
        }

        const headers = {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "trendzn-bot",
        };

        try {
          const runningRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=in_progress&per_page=1`,
            { headers },
          );
          if (runningRes.ok) {
            const running = await runningRes.json();
            if ((running.total_count ?? 0) > 0) {
              return Response.json(
                { ok: false, error: "already-running", htmlUrl: running.workflow_runs?.[0]?.html_url ?? null },
                { status: 409 },
              );
            }
          }
          // Se il controllo stesso fallisce, procede comunque con il
          // dispatch: meglio un rischio di doppia cascata (raro, richiede
          // un doppio click nella stessa manciata di secondi) che bloccare
          // l'avvio per un problema nella verifica.

          const res = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ ref: REF }),
            },
          );

          if (!res.ok) {
            const text = await res.text();
            return Response.json(
              { ok: false, error: `${res.status} ${text}`.slice(0, 300) },
              { status: 500 },
            );
          }

          return Response.json({
            ok: true,
            runsUrl: `https://github.com/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}`,
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
