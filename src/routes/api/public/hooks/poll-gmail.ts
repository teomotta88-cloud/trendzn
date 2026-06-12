import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

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
    // formato [tag1][tag2][tag3]
    const re = /\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(subject)) !== null) {
      tags.push(match[1].trim().toLowerCase());
    }
  } else {
    // formato tag1-tag2-tag3 (eventuale testo libero dopo doppio spazio ignorato)
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
  return res.json();
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

              const urls = Array.from(new Set((body.match(URL_REGEX) ?? []).map((u) => u.replace(/[).,;]+$/, ""))));

              if (urls.length > 0) {
                const { tags, category, industry, section } = parseSubject(subject);

                const rows = urls.map((url) => ({
                  url,
                  submitted_by: from,
                  raw_email: raw.slice(0, 10000),
                  title: subject || null,
                  tags,
                  category,
                  industry,
                  section,
                  status: "approved" as const,
                }));

                const { error } = await supabaseAdmin.from("trend_submissions").insert(rows);

                if (error) {
                  console.error("Insert error:", error.message);
                  continue;
                }
                inserted += rows.length;
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
