import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";

const CANALE_TO_PLATFORM: Record<string, string> = {
  IG: "instagram",
  IGS: "instagram",
  FB: "facebook",
  TT: "tiktok",
  LK: "linkedin",
  X: "x",
  YT: "youtube",
};

function urlBase(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url.split("?")[0].replace(/\/$/, "");
  }
}

// Scrive il canale cliente in trends.json sotto "canali_cliente", nella stessa
// struttura usata per "canali_inspo": n8n monitora questa lista senza bisogno
// di modifiche lato suo.
async function syncClientChannelToGitHub(canale: string, handle: string, url: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return "no_token";

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "trendzn-bot",
      },
    });
    if (!res.ok) return `read_failed_${res.status}`;

    const file = await res.json();
    const trends = JSON.parse(atob(file.content.replace(/\n/g, "")));

    if (!Array.isArray(trends.canali_cliente)) {
      trends.canali_cliente = [];
    }

    const platform = CANALE_TO_PLATFORM[canale] ?? "web";
    const base = urlBase(url);

    const exists = (trends.canali_cliente as { accounts: { url: string }[] }[]).some((c) =>
      c.accounts.some((a) => urlBase(a.url) === base),
    );
    if (exists) return "already_exists";

    trends.canali_cliente.push({
      id: handle.replace(/[^a-z0-9]/gi, "-").toLowerCase(),
      name: handle,
      urls: [url],
      descrizione: null,
      accounts: [{ platform, handle, url }],
    });

    const writeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "trendzn-bot",
      },
      body: JSON.stringify({
        message: `chore: aggiungi canale cliente ${handle} [trendzn-manual]`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(trends, null, 2)))),
        sha: file.sha,
      }),
    });

    if (writeRes.ok) return "ok";
    const err = await writeRes.text();
    return `write_failed: ${err.slice(0, 100)}`;
  } catch (err) {
    return `exception: ${String(err).slice(0, 100)}`;
  }
}

export const Route = createFileRoute("/api/public/hooks/add-client-channel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { canale?: string; handle?: string; url?: string };
          const canale = body.canale?.trim();
          const handle = body.handle?.trim();
          const url = body.url?.trim();

          if (!canale || !handle || !url) {
            return Response.json({ ok: false, error: "canale, handle e url sono obbligatori" }, { status: 400 });
          }

          const syncResult = await syncClientChannelToGitHub(canale, handle, url);
          return Response.json({ ok: true, syncResult });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
