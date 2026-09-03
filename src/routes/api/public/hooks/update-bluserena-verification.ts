import { createFileRoute } from "@tanstack/react-router";
import { describeGithubFailure } from "@/lib/githubApiError";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;

type UpdateRequest = {
  channelId: string;
  postUrl: string;
  verificationStatus: "confirmed" | "unconfirmed";
};

export const Route = createFileRoute("/api/public/hooks/update-bluserena-verification")({
  server: {
    handlers: {
      // Aggiorna verification status di un singolo post in bluserena-monitoring.json
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

        const { channelId, postUrl, verificationStatus } = body;
        if (!channelId || !postUrl || !verificationStatus) {
          return Response.json(
            { ok: false, error: "Mancano channelId, postUrl o verificationStatus" },
            { status: 400 },
          );
        }

        // GitHub rifiuta con 403 le richieste senza User-Agent: il runtime
        // serverless non ne aggiunge uno di default, quindi va esplicitato.
        const ghHeaders = {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "trendzn-bot",
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
              console.error(
                `[update-bluserena-verification] GitHub API error ${metaRes.status}:`,
                errorText,
              );
              return Response.json(
                {
                  ok: false,
                  error: `Lettura metadata fallita: ${describeGithubFailure(metaRes, errorText)}`,
                  details: errorText,
                },
                { status: 500 },
              );
            }

            const meta = await metaRes.json();
            const sha = meta.sha;

            // Il file supera 1 MB: l'endpoint contents non restituisce il
            // contenuto, si scarica il blob identificato dallo sha appena letto
            // (coerente per costruzione, a differenza della CDN raw).
            const blobRes = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`, {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.raw",
                "User-Agent": "trendzn-bot",
              },
            });

            if (!blobRes.ok) {
              const blobError = await blobRes.text();
              console.error(
                `[update-bluserena-verification] GitHub blob error ${blobRes.status}:`,
                blobError,
              );
              return Response.json(
                {
                  ok: false,
                  error: `Lettura blob fallita: ${describeGithubFailure(blobRes, blobError)}`,
                  details: blobError,
                },
                { status: 500 },
              );
            }

            const raw = await blobRes.text();
            const store = raw.trim() ? JSON.parse(raw) : { canali: [] };

            // Trova e aggiorna il post
            let found = false;
            for (const canale of store.canali || []) {
              if (canale.id !== channelId) continue;
              const account = (canale.accounts || []).find((a: any) => a.url === postUrl);
              if (account) {
                account.verificationStatus = verificationStatus;
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
                  message: "chore: update bluserena post verification status [trendzn-bot]",
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

            const writeError = await writeRes.text();
            console.error(
              `[update-bluserena-verification] GitHub write error ${writeRes.status}:`,
              writeError,
            );
            return Response.json(
              {
                ok: false,
                error: `Scrittura fallita: ${describeGithubFailure(writeRes, writeError)}`,
                details: writeError,
              },
              { status: 500 },
            );
          }

          return Response.json(
            { ok: false, error: "Troppi conflitti di scrittura" },
            { status: 500 },
          );
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
