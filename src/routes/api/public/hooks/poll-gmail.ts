import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";

const CATEGORY_TO_SECTION: Record<string, string> = {
  "trend real time": "trend-real-time",
  "trend attuali": "trend-attuali",
  "trend evergreen": "trend-evergreen",
  "canali inspo": "canali-inspo",
  "real time": "trend-real-time",
  attuali: "trend-attuali",
  evergreen: "trend-evergreen",
  canali: "canali-inspo",
};

function extractHandleFromUrl(url: string): string | null {
  try {
    const clean = url.replace(/\/$/, "").split("?")[0];
    const parts = clean.split("/");
    const handle = parts[parts.length - 1].replace(/^@/, "");
    return handle || null;
  } catch {
    return null;
  }
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return new TextDecoder("utf-8").decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

function extractText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  let out = "";
  if (payload.body?.data) out += decodeBase64Url(payload.body.data) + "\n";
  if (payload.parts) for (const p of payload.parts) out += extractText(p) + "\n";
  return out;
}

function findHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  if (!headers) return "";
  return headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseSubject(subject: string): {
  tags: string[];
  category: string | null;
  industry: string | null;
  section: string | null;
} {
  const tags: string[] = [];
  const hasBrackets = /\[/.test(subject);

  if (hasBrackets) {
    const re = /\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(subject)) !== null) {
      tags.push(match[1].trim().toLowerCase());
    }
  } else {
    const part = subject.split(/\s{2,}/)[0].trim();
    part.split("-").forEach((t) => {
      const clean = t.trim().toLowerCase();
      if (clean) tags.push(clean);
    });
  }

  const category = tags[0] ?? null;
  const industry = tags[1] ?? null;
  const section = category ? (CATEGORY_TO_SECTION[category] ?? null) : null;
  return { tags, category, industry, section };
}

async function gmailFetch(path: string, init?: RequestInit) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_MAIL_API_KEY;
  if (!lovableKey || !connKey) throw new Error("Missing gateway credentials");
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail ${path} ${res.status}: ${body}`);
  }
  // Alcune risposte Gmail (es. batchModify) sono 204 No Content con body vuoto:
  // fare res.json() su un body vuoto lancia "Unexpected end of JSON input".
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function syncCanaleToGitHub(url: string, title: string | null) {
  // Letto qui (non a livello di modulo) così le modifiche alle env var
  // vengono raccolte senza dipendere dal momento di inizializzazione del modulo.
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("GITHUB_TOKEN non configurato, skip sync GitHub");
    return;
  }

  try {
    // Leggi il file attuale da GitHub
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) {
      console.error("GitHub read failed:", res.status);
      return;
    }
    const file = await res.json();
    const trends = JSON.parse(atob(file.content.replace(/\n/g, "")));

    function detectPlatformLocal(u: string) {
      if (/instagram\.com/.test(u)) return "instagram";
      if (/tiktok\.com/.test(u)) return "tiktok";
      if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
      return "web";
    }
    function extractHandleLocal(u: string) {
      try {
        const clean = u.replace(/\/$/, "").split("?")[0];
        const parts = clean.split("/");
        return parts[parts.length - 1].replace(/^@/, "") || u;
      } catch {
        return u;
      }
    }

    const platform = detectPlatformLocal(url);
    const handle = extractHandleLocal(url);
    const name = title || handle;
    const id = handle.replace(/[^a-z0-9]/gi, "-").toLowerCase();

    // Evita duplicati
    const exists = (trends.canali_inspo as { accounts: { url: string }[] }[]).some((c) =>
      c.accounts.some((a) => a.url === url),
    );
    if (exists) {
      console.log("Canale già presente in trends.json, skip");
      return;
    }

    // Aggiungi il canale
    trends.canali_inspo.push({
      id,
      name,
      urls: [url],
      descrizione: null,
      accounts: [{ platform, handle, url }],
    });

    // Scrivi su GitHub
    const writeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `chore: aggiungi canale ${handle} [trendzn-bot]`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(trends, null, 2)))),
        sha: file.sha,
      }),
    });

    if (writeRes.ok) {
      console.log(`Canale ${handle} aggiunto a trends.json`);
    } else {
      const err = await writeRes.text();
      console.error("GitHub write failed:", err);
    }
  } catch (err) {
    console.error("syncCanaleToGitHub error:", err);
  }
}

export const Route = createFileRoute("/api/public/hooks/poll-gmail")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const list = (await gmailFetch(
            `/users/me/messages?q=${encodeURIComponent("is:unread in:inbox")}&maxResults=50`,
          )) as { messages?: { id: string }[] };

          const messages = list.messages ?? [];
          if (messages.length === 0) {
            return Response.json({ ok: true, processed: 0, inserted: 0 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let inserted = 0;
          const processedIds: string[] = [];

          for (const m of messages) {
            try {
              const msg = (await gmailFetch(`/users/me/messages/${m.id}?format=full`)) as {
                id: string;
                payload?: GmailPart;
                snippet?: string;
              };

              const headers = msg.payload?.headers;
              const from = findHeader(headers, "From");
              const subject = findHeader(headers, "Subject");
              const body = extractText(msg.payload) || msg.snippet || "";
              const raw = `Subject: ${subject}\nFrom: ${from}\n\n${body}`;

              const { tags, category, industry, section } = parseSubject(subject);

              const allUrls = Array.from(new Set((body.match(URL_REGEX) ?? []).map((u) => u.replace(/[).,;]+$/, ""))));

              const urls = section === "canali-inspo" ? (allUrls[0] ? [allUrls[0]] : []) : allUrls;

              if (urls.length > 0) {
                const rows = urls.map((url) => {
                  const derivedTitle =
                    section === "canali-inspo"
                      ? tags[2]
                        ? tags.slice(2).join(" ")
                        : extractHandleFromUrl(url)
                      : subject || null;

                  return {
                    url,
                    submitted_by: from,
                    raw_email: raw.slice(0, 10000),
                    title: derivedTitle,
                    tags,
                    category,
                    industry,
                    section,
                    status: "approved" as const,
                  };
                });

                const { error } = await supabaseAdmin.from("trend_submissions").insert(rows);

                if (error) {
                  console.error("Insert error:", error.message);
                  continue;
                }
                inserted += rows.length;

                // Sync su GitHub per canali inspo
                if (section === "canali-inspo" && urls[0]) {
                  const title = rows[0]?.title ?? null;
                  await syncCanaleToGitHub(urls[0], title).catch((e) => console.error("GitHub sync failed:", e));
                }
              }

              processedIds.push(msg.id);
            } catch (err) {
              console.error("Message error:", err);
            }
          }

          if (processedIds.length > 0) {
            await gmailFetch(`/users/me/messages/batchModify`, {
              method: "POST",
              body: JSON.stringify({ ids: processedIds, removeLabelIds: ["UNREAD"] }),
            });
          }

          return Response.json({ ok: true, processed: processedIds.length, inserted });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("poll-gmail failed:", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
