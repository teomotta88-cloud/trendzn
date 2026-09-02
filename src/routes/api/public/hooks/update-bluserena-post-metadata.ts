import { createFileRoute } from "@tanstack/react-router";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;

type UpdateRequest = {
  channelId: string;
  postUrl: string;
  sentiment?: "positive" | "negative" | "neutral" | null;
  topics?: string[] | null;
  location?: string | null;
};

export const Route = createFileRoute("/api/public/hooks/update-bluserena-post-metadata")({
  server: {
    handlers: {
      // Aggiorna sentiment/topic/location di un singolo post in bluserena-monitoring.json
      // via GitHub API. Gestisce conflitti di scrittura con retry.
      POST: async ({ request }) => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return Response.json(
            { ok: false, error: "GITHUB_TOKEN non configurato" },
            { status: 500 },
          );
        }

        let body: UpdateRequest;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Body JSON non valido" }, { status: 400 });
        }

        const { channelId, postUrl, sentiment, topics, location } = body;
        if (!channelId || !postUrl) {
          return Response.json(
            { ok: false, error: "Mancano channelId o postUrl" },
            { status: 400 },
          );
        }

        const ghHeaders = {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        };

        try {
          // Prova di aggiornare con retry su conflitto
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            // Leggi metadata file
            const metaRes = await fetch(
              `https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`,
              { headers: ghHeaders },
            );

            if (!metaRes.ok) {
              const errorText = await metaRes.text();
              console.error(`[update-bluserena-post-metadata] GitHub API error ${metaRes.status}:`, errorText);
              return Response.json(
                { ok: false, error: `Lettura metadata fallita: ${metaRes.status}`, details: errorText },
                { status: 500 },
              );
            }

            const meta = await metaRes.json();
            const sha = meta.sha;

            // Leggi contenuto attuale
            const branch = "main";
            const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;
            const rawRes = await fetch(rawUrl, {
              headers: { "User-Agent": "update-bluserena-metadata" },
            });

            if (!rawRes.ok) {
              return Response.json(
                { ok: false, error: `Lettura raw fallita: ${rawRes.status}` },
                { status: 500 },
              );
            }

            const raw = await rawRes.text();
            const store = raw.trim() ? JSON.parse(raw) : { canali: [] };

            // Trova e aggiorna il post
            let found = false;
            for (const canale of store.canali || []) {
              if (canale.id !== channelId) continue;
              const account = (canale.accounts || []).find((a: any) => a.url === postUrl);
              if (account) {
                if (sentiment !== undefined) account.sentiment = sentiment;
                if (topics !== undefined) account.topics = topics;
                if (location !== undefined) account.location = location;
                found = true;
                break;
              }
            }

            if (!found) {
              return Response.json(
                { ok: false, error: "Post non trovato nel canale" },
                { status: 404 },
              );
            }

            // Scrivi su GitHub
            const content = Buffer.from(JSON.stringify(store, null, 2)).toString("base64");
            const writeRes = await fetch(
              `https://api.github.com/repos/${REPO}/contents/${STORE_PATH}`,
              {
                method: "PUT",
                headers: ghHeaders,
                body: JSON.stringify({
                  message: "chore: update bluserena post metadata (sentiment/topic/location) [trendzn-bot]",
                  content,
                  sha,
                }),
              },
            );

            if (writeRes.ok) {
              return Response.json({ ok: true });
            }

            if ((writeRes.status === 409 || writeRes.status === 422) && attempt < MAX_ATTEMPTS) {
              // Conflitto: riprova
              console.log(`Conflitto scrittura (tentativo ${attempt}/${MAX_ATTEMPTS}), riprovo...`);
              continue;
            }

            return Response.json(
              { ok: false, error: `Scrittura fallita: ${writeRes.status}` },
              { status: 500 },
            );
          }

          return Response.json(
            { ok: false, error: "Troppi conflitti di scrittura" },
            { status: 500 },
          );
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
