import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";

export const Route = createFileRoute("/api/public/hooks/delete-canale")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { canaleId } = (await request.json()) as { canaleId: string };
          if (!canaleId) {
            return Response.json({ ok: false, error: "canaleId mancante" }, { status: 400 });
          }

          const token = process.env.GITHUB_TOKEN;
          if (!token) {
            return Response.json({ ok: false, error: "no_token" }, { status: 500 });
          }

          // Leggi trends.json da GitHub
          const res = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`,
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "trendzn-bot",
              },
            },
          );
          if (!res.ok) {
            return Response.json(
              { ok: false, error: `read_failed_${res.status}` },
              { status: 500 },
            );
          }

          const file = await res.json();
          const trends = JSON.parse(atob(file.content.replace(/\n/g, "")));

          // Rimuovi il canale per id
          const before = trends.canali_inspo.length;
          trends.canali_inspo = trends.canali_inspo.filter(
            (c: { id: string }) => c.id !== canaleId,
          );

          if (trends.canali_inspo.length === before) {
            return Response.json(
              { ok: false, error: "canale non trovato" },
              { status: 404 },
            );
          }

          // Scrivi su GitHub
          const writeRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`,
            {
              method: "PUT",
              headers: {
                Authorization: `token ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "trendzn-bot",
              },
              body: JSON.stringify({
                message: `chore: elimina canale ${canaleId} [trendzn-bot]`,
                content: btoa(
                  unescape(encodeURIComponent(JSON.stringify(trends, null, 2))),
                ),
                sha: file.sha,
              }),
            },
          );

          if (!writeRes.ok) {
            const err = await writeRes.text();
            return Response.json(
              { ok: false, error: err.slice(0, 100) },
              { status: 500 },
            );
          }

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 100) },
            { status: 500 },
          );
        }
      },
    },
  },
});
