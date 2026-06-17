import { createFileRoute } from "@tanstack/react-router";

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const TRENDS_PATH = "src/data/trends.json";

const VALID_SECTIONS = [
  "trend-real-time",
  "trend-attuali",
  "trend-evergreen",
  "canali-inspo",
  "linkedin",
  "influencer",
] as const;

type Section = (typeof VALID_SECTIONS)[number];

function normalizeIndustry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function urlBase(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url.split("?")[0].replace(/\/$/, "");
  }
}

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
      "rcm",
    ].forEach((p) => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/[).,;]+$/, "").trim();
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

// Le stesse categorie/label usate in poll-gmail.ts, per coerenza con i dati da mail
const CATEGORY_LABEL: Record<Section, string> = {
  "trend-real-time": "Trend Real Time",
  "trend-attuali": "Trend Attuali",
  "trend-evergreen": "Trend Evergreen",
  "canali-inspo": "Canali Inspo",
  linkedin: "LinkedIn",
  influencer: "Influencer",
};

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
        message: `chore: aggiungi canale ${handle} [trendzn-manual]`,
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
        message: `chore: aggiungi influencer ${handle} [trendzn-manual]`,
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

export const Route = createFileRoute("/api/public/hooks/submit-manual")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            section: string;
            url: string;
            industry?: string | null;
            title?: string | null;
            cliente?: string | null;
          };

          const { section, url } = body;

          if (!section || !VALID_SECTIONS.includes(section as Section)) {
            return Response.json({ ok: false, error: "section non valida" }, { status: 400 });
          }
          if (!url || !/^https?:\/\//.test(url.trim())) {
            return Response.json({ ok: false, error: "url non valido" }, { status: 400 });
          }

          const cleanUrl = normalizeUrl(url.trim());
          const industry = body.industry ? normalizeIndustry(body.industry) : null;
          const title = body.title?.trim() || null;
          const category = CATEGORY_LABEL[section as Section];

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Evita duplicati, stesso criterio usato per le mail
          const base = urlBase(cleanUrl);
          const { data: existing } = await supabaseAdmin
            .from("trend_submissions")
            .select("id")
            .like("url", `${base}%`)
            .maybeSingle();

          if (existing) {
            return Response.json({ ok: false, error: "Questo URL è già presente" }, { status: 409 });
          }

          const derivedTitle =
            section === "canali-inspo" || section === "influencer" ? title || extractHandleFromUrl(cleanUrl) : title;

          const { data: inserted, error } = await supabaseAdmin
            .from("trend_submissions")
            .insert({
              url: cleanUrl,
              submitted_by: "manual",
              raw_email: `Inserimento manuale — ${category}`,
              title: derivedTitle,
              tags: [section, industry].filter((t): t is string => Boolean(t)),
              category,
              industry,
              section,
              status: "approved" as const,
            })
            .select("id")
            .single();

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          let syncResult: string | null = null;
          if (section === "canali-inspo") {
            syncResult = await syncCanaleToGitHub(cleanUrl, derivedTitle);
          }
          if (section === "influencer") {
            // industry = Nome Influencer, derivedTitle = Cliente (fallback handle se vuoto)
            const cliente = title || null;
            syncResult = await syncInfluencerToGitHub(cleanUrl, industry, cliente);
          }

          return Response.json({ ok: true, id: inserted?.id, syncResult });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
