import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const WORKFLOW_FILE = "sync-bluserena-monitoring.yml";
const REF = "main";

export const Route = createFileRoute("/api/public/hooks/trigger-sync-bluserena-monitoring")({
  server: {
    handlers: {
      // Avvia manualmente la GitHub Action "Sync Bluserena Monitoring" via
      // workflow_dispatch (stesso pattern di trigger-sync-aspi-monitoring.ts),
      // usando il GITHUB_TOKEN server-side.
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

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
