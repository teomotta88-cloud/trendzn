import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const WORKFLOW_FILE = "analyze-new-bsconfirmed.yml";
const REF = "main";

// Pagina Actions del workflow: il dispatch non restituisce l'id della run, e
// per il pulsante nel feed avere un link dove guardare com'è andata vale più
// di un id che l'API non ci dà.
const RUNS_URL = `https://github.com/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}`;

export const Route = createFileRoute("/api/public/hooks/trigger-analyze-new-bsconfirmed")({
  server: {
    handlers: {
      // Avvia "Analizza nuovi BSConfirmed" via workflow_dispatch (stesso
      // pattern di trigger-sync-bluserena-monitoring.ts), col GITHUB_TOKEN
      // server-side: il token non arriva mai al browser.
      POST: async () => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return Response.json(
            { ok: false, error: "GITHUB_TOKEN non configurato" },
            { status: 500 },
          );
        }

        try {
          const res = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
            {
              method: "POST",
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                // GitHub rifiuta con 403 le richieste senza User-Agent: il
                // runtime serverless non ne aggiunge uno di default.
                "User-Agent": "trendzn-bot",
              },
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

          return Response.json({ ok: true, runsUrl: RUNS_URL });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
