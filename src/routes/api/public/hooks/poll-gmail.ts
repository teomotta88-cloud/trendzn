import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

// Solo URL che sono effettivamente post social — esclude link firma, siti generici ecc.
const SOCIAL_POST_REGEX =
  /https?:\/\/(www\.)?(instagram\.com\/(p|reel|reels|tv)\/|tiktok\.com\/@[^/\s]+\/(video|photo)\/|youtube\.com\/watch|youtu\.be\/|linkedin\.com\/(embed\/feed\/update\/urn:li:(share|activity|ugcPost):|feed\/update\/urn:li:activity:|posts\/)[^\s<>"')]+)[^\s<>"')]*/gi;

// Per canali inspo accettiamo anche URL di profilo
const PROFILE_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";

const CATEGORY_MAP: Record<string, string> = {
  "trend real time": "Trend Real Time",
  "trend attuali": "Trend Attuali",
  "trend evergreen": "Trend Evergreen",
  "canali inspo": "Canali Inspo",
  linkedin: "LinkedIn",
  influencer: "Influencer",
  "real time": "Trend Real Time",
  attuali: "Trend Attuali",
  evergreen: "Trend Evergreen",
  canali: "Canali Inspo",
};

const SECTION_MAP: Record<string, string> = {
  "trend real time": "trend-real-time",
  "trend attuali": "trend-attuali",
  "trend evergreen": "trend-evergreen",
  "canali inspo": "canali-inspo",
  linkedin: "linkedin",
  influencer: "influencer",
  "real time": "trend-real-time",
  attuali: "trend-attuali",
  evergreen: "trend-evergreen",
  canali: "canali-inspo",
};

function normalizeIndustry(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

// Estrai solo origin + pathname, senza parametri
function urlBase(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url.split("?")[0].replace(/\/$/, "");
  }
}

// Normalizza URL rimuovendo parametri di tracking e trailing slash
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    [
      "igsh",
      "igshid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
      "is_from_webapp",
      "sender_device",
      "trk",
      "trackingId",
      "rcm", // parametri tracking LinkedIn
    ].forEach((p) => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/[).,;]+$/, "");
  }
}

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

// Legge solo text/plain per evitare duplicati da multipart/alternative
function extractTextPlainOnly(payload: GmailPart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.mimeType === "text/html") {
    return "";
  }

  if (payload.parts) {
    for (const p of payload.parts) {
      const text = extractTextPlainOnly(p);
      if (text) return text;
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
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
  const rawTags: string[] = [];
  const hasBrackets = /\[/.test(subject);

  if (hasBrackets) {
    const re = /\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(subject)) !== null) {
      rawTags.push(match[1].trim());
    }
  } else {
    const part = subject.split(/\s{2,}/)[0].trim();
    part.split("-").forEach((t) => {
      const clean = t.trim();
      if (clean) rawTags.push(clean);
    });
  }

  const tagsLower = rawTags.map((t) => t.toLowerCase());
  const categoryKey = tagsLower[0] ?? null;
  const category = categoryKey ? (CATEGORY_MAP[categoryKey] ?? rawTags[0]) : null;
  const section = categoryKey ? (SECTION_MAP[categoryKey] ?? null) : null;
  const industryRaw = rawTags[1] ?? null;
  const industry = industryRaw ? normalizeIndustry(industryRaw) : null;
  const tags = tagsLower;

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
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function syncCanaleToGitHub(url: string, title: string | null): Promise<string> {
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

    function detectPlatformLocal(u: string) {
      if (/instagram\.com/.test(u)) return "instagram";
      if (/tiktok\.com/.test(u)) return "tiktok";
      if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
      if (/linkedin\.com/.test(u)) return "linkedin";
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

    const normalizedUrl = normalizeUrl(url);
    const base = urlBase(normalizedUrl);
    const platform = detectPlatformLocal(normalizedUrl);
    const handle = extractHandleLocal(normalizedUrl);
    const name = title || handle;
    const id = handle.replace(/[^a-z0-9]/gi, "-").toLowerCase();

    const exists = (trends.canali_inspo as { accounts: { url: string }[] }[]).some((c) =>
      c.accounts.some((a) => urlBase(a.url) === base),
    );
    if (exists) return "already_exists";

    trends.canali_inspo.push({
      id,
      name,
      urls: [normalizedUrl],
      descrizione: null,
      accounts: [{ platform, handle, url: normalizedUrl }],
    });

    const writeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "trendzn-bot",
      },
      body: JSON.stringify({
        message: `chore: aggiungi canale ${handle} [trendzn-bot]`,
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

// Stessa logica di syncCanaleToGitHub, ma scrive su influencer_profiles
// invece di canali_inspo, e salva anche il "cliente" a livello di profilo.
async function syncInfluencerToGitHub(
  url: string,
  nomeInfluencer: string | null,
  cliente: string | null,
): Promise<string> {
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

    // influencer_profiles potrebbe non esistere ancora nei JSON più vecchi
    if (!Array.isArray(trends.influencer_profiles)) {
      trends.influencer_profiles = [];
    }

    function detectPlatformLocal(u: string) {
      if (/instagram\.com/.test(u)) return "instagram";
      if (/tiktok\.com/.test(u)) return "tiktok";
      if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
      if (/linkedin\.com/.test(u)) return "linkedin";
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

    const normalizedUrl = normalizeUrl(url);
    const base = urlBase(normalizedUrl);
    const platform = detectPlatformLocal(normalizedUrl);
    const handle = extractHandleLocal(normalizedUrl);
    const name = nomeInfluencer || handle;
    const id = handle.replace(/[^a-z0-9]/gi, "-").toLowerCase();

    const exists = (trends.influencer_profiles as { accounts: { url: string }[] }[]).some((c) =>
      c.accounts.some((a) => urlBase(a.url) === base),
    );
    if (exists) return "already_exists";

    trends.influencer_profiles.push({
      id,
      name,
      cliente: cliente || null,
      urls: [normalizedUrl],
      descrizione: null,
      accounts: [{ platform, handle, url: normalizedUrl }],
    });

    const writeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "trendzn-bot",
      },
      body: JSON.stringify({
        message: `chore: aggiungi influencer ${handle} [trendzn-bot]`,
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
          const syncResults: string[] = [];

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

              const body = extractTextPlainOnly(msg.payload) || msg.snippet || "";
              const raw = `Subject: ${subject}\nFrom: ${from}\n\n${body}`;

              const { tags, category, industry, section } = parseSubject(subject);

              let urls: string[];

              if (section === "canali-inspo" || section === "influencer") {
                // Per canali inspo e influencer: primo URL qualsiasi (è un profilo, non un post)
                const allUrls = Array.from(
                  new Set((body.match(PROFILE_URL_REGEX) ?? []).map((u) => normalizeUrl(u.replace(/[).,;]+$/, "")))),
                );
                urls = allUrls[0] ? [allUrls[0]] : [];
              } else {
                const rawMatches = body.match(SOCIAL_POST_REGEX) ?? [];
                urls = Array.from(new Set(rawMatches.map((u) => normalizeUrl(u.replace(/[).,;]+$/, "")))));
              }

              if (urls.length > 0) {
                const rows: {
                  url: string;
                  submitted_by: string;
                  raw_email: string;
                  title: string | null;
                  tags: string[];
                  category: string | null;
                  industry: string | null;
                  section: string | null;
                  status: "approved";
                }[] = [];

                for (const url of urls) {
                  const base = urlBase(url);
                  const { data: existing } = await supabaseAdmin
                    .from("trend_submissions")
                    .select("id")
                    .like("url", `${base}%`)
                    .maybeSingle();

                  if (existing) {
                    console.log("URL già presente su Supabase, skip:", url);
                    continue;
                  }

                  const derivedTitle =
                    section === "canali-inspo" || section === "influencer"
                      ? tags[2]
                        ? tags.slice(2).join(" ")
                        : extractHandleFromUrl(url)
                      : section === "linkedin"
                        ? tags[2]
                          ? tags.slice(2).join(" ")
                          : subject || null
                        : subject || null;

                  rows.push({
                    url,
                    submitted_by: from,
                    raw_email: raw.slice(0, 10000),
                    title: derivedTitle,
                    tags,
                    category,
                    industry,
                    section,
                    status: "approved",
                  });
                }

                if (rows.length === 0) {
                  processedIds.push(m.id);
                  continue;
                }

                const { error } = await supabaseAdmin.from("trend_submissions").insert(rows);

                if (error) {
                  console.error("Insert error:", error.message);
                  continue;
                }
                inserted += rows.length;

                if (section === "canali-inspo" && urls[0]) {
                  const title = rows[0]?.title ?? null;
                  const result = await syncCanaleToGitHub(urls[0], title);
                  syncResults.push(`${urls[0]}: ${result}`);
                }

                if (section === "influencer" && urls[0]) {
                  // industry = Nome Influencer, title/derivedTitle = Cliente
                  const nomeInfluencer = industry;
                  const cliente = rows[0]?.title ?? null;
                  const result = await syncInfluencerToGitHub(urls[0], nomeInfluencer, cliente);
                  syncResults.push(`${urls[0]}: ${result}`);
                }
              }

              processedIds.push(m.id);
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

          return Response.json({
            ok: true,
            processed: processedIds.length,
            inserted,
            syncResults,
          });
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
