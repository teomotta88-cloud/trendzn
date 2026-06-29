import { createFileRoute } from "@tanstack/react-router";
import { decodeBase64Utf8 } from "@/lib/base64";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";
const MAX_ATTEMPTS = 5;

async function readTrendsJson(token: string) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "trendzn-bot",
    },
  });
  if (!res.ok) {
    throw new Error(`read_failed_${res.status}`);
  }
  const file = await res.json();
  const trends = JSON.parse(decodeBase64Utf8(file.content.replace(/\n/g, "")));
  return { trends, sha: file.sha as string };
}

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

          // Il workflow di sync (sync-canali-feed.yml) scrive su trends.json ogni
          // poche ore, e più spesso per i canali con account molto attivi: senza
          // retry, una collisione sullo sha (409, concurrent update) fa fallire
          // silenziosamente la cancellazione e il canale resta lì per sempre,
          // pur sembrando "non eliminabile" solo per quell'account specifico.
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const { trends, sha } = await readTrendsJson(token);

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
                  sha,
                }),
              },
            );

            if (writeRes.ok) {
              return Response.json({ ok: true });
            }

            // 409/422 = sha non più valido (scrittura concorrente, es. il bot di
            // sync): ri-leggo l'ultima versione e riprovo, invece di arrendermi.
            if ((writeRes.status === 409 || writeRes.status === 422) && attempt < MAX_ATTEMPTS) {
              continue;
            }

            const err = await writeRes.text();
            return Response.json(
              { ok: false, error: err.slice(0, 100) },
              { status: 500 },
            );
          }

          return Response.json(
            { ok: false, error: "troppi conflitti di scrittura, riprova" },
            { status: 500 },
          );
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
