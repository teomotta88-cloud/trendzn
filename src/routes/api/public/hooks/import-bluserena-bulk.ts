import { createFileRoute } from "@tanstack/react-router";
import { decodeBase64Utf8 } from "@/lib/base64";
import ExcelJS from "exceljs";

// Import in bulk dei canali per la pagina Bluserena-monitoring da un file Excel/CSV
// con due colonne (Nome canale, URL). Scrive TUTTI i canali nuovi in un solo
// commit su bluserena-monitoring.json (chiave "canali"), con retry sullo sha per
// non collidere col bot di sync. Salta i duplicati (per URL) sia rispetto ai
// canali già presenti sia all'interno del file stesso.
// Copia di import-aspi-bulk.ts.

const GITHUB_REPO = "teomotta88-cloud/trendzn";
const BLUSERENA_PATH = "src/data/bluserena-monitoring.json";
const MAX_ATTEMPTS = 5;

type Channel = {
  id: string;
  name: string;
  urls: string[];
  descrizione: string | null;
  accounts: { platform: string; handle: string; url: string }[];
};

function detectPlatform(u: string): string {
  if (/instagram\.com/.test(u)) return "instagram";
  if (/tiktok\.com/.test(u)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
  if (/linkedin\.com/.test(u)) return "linkedin";
  if (/facebook\.com|fb\.com/.test(u)) return "facebook";
  if (/(?:\/\/|\.)x\.com|twitter\.com/.test(u)) return "x";
  return "web";
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
      "feedView",
      "originalSubdomain",
    ].forEach((p) => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/[).,;]+$/, "").trim();
  }
}

function urlBase(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return url.split("?")[0].replace(/\/$/, "").toLowerCase();
  }
}

// Handle "leggibile" per la card e per il match del sync (IG/TikTok). Per
// LinkedIn preferiamo lo slug company/in; per gli altri il primo segmento utile.
function extractHandle(url: string, platform: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (platform === "linkedin") {
      const idx = segs.findIndex((s) => s === "company" || s === "in" || s === "school");
      if (idx >= 0 && segs[idx + 1]) return segs[idx + 1];
    }
    if (platform === "tiktok") {
      const at = segs.find((s) => s.startsWith("@"));
      if (at) return at.replace(/^@/, "");
    }
    return (segs[0] || u.hostname).replace(/^@/, "");
  } catch {
    const clean = url.replace(/\/$/, "").split("?")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1].replace(/^@/, "") || url;
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "canale"
  );
}

type Pair = { name: string; url: string };

// Estrae (Nome canale, URL) da un file Excel: prima worksheet, individua le
// colonne dagli header se presenti, altrimenti col1=nome col2=url.
async function parseXlsx(buf: ArrayBuffer): Promise<Pair[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const cellStr = (cell: ExcelJS.Cell): string => {
    const v = cell.value as unknown;
    if (v == null) return "";
    if (typeof v === "object") {
      const o = v as { text?: string; hyperlink?: string; result?: unknown };
      if (o.hyperlink) return String(o.hyperlink);
      if (o.text) return String(o.text);
      if (o.result != null) return String(o.result);
      return "";
    }
    return String(v);
  };
  // Per l'URL preferiamo sempre il target dell'hyperlink se presente
  // (il testo visibile può essere "Nome (@handle) / X").
  const cellUrl = (cell: ExcelJS.Cell): string => {
    const hl = (cell as unknown as { hyperlink?: string }).hyperlink;
    if (hl) return String(hl);
    const v = cell.value as unknown;
    if (v && typeof v === "object") {
      const o = v as { hyperlink?: string; text?: string };
      if (o.hyperlink) return String(o.hyperlink);
      if (o.text) return String(o.text);
    }
    return cellStr(cell);
  };

  const pairs: Pair[] = [];
  let nameCol = 1;
  let urlCol = 2;
  let startRow = 1;

  const header = ws.getRow(1);
  const h1 = cellStr(header.getCell(1)).toLowerCase();
  const h2 = cellStr(header.getCell(2)).toLowerCase();
  const looksHeader = /nome|name|canale|channel/.test(h1) || /url|link/.test(h2);
  if (looksHeader) {
    startRow = 2;
    if (/url|link/.test(h1) && /nome|name|canale/.test(h2)) {
      nameCol = 2;
      urlCol = 1;
    }
  }

  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellStr(row.getCell(nameCol)).trim();
    const url = cellUrl(row.getCell(urlCol)).trim();
    if (!url) continue;
    pairs.push({ name, url });
  }
  return pairs;
}

function parseCsv(text: string): Pair[] {
  const pairs: Pair[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let start = 0;
  if (lines[0] && /nome|name|canale|url|link/i.test(lines[0])) start = 1;
  for (let i = start; i < lines.length; i++) {
    // split semplice su virgola o punto e virgola, rispettando le virgolette
    const cols =
      lines[i].match(/("([^"]*)"|[^,;]+)/g)?.map((c) => c.replace(/^"|"$/g, "").trim()) ?? [];
    if (cols.length === 0) continue;
    const urlIdx = cols.findIndex((c) => /^https?:\/\//i.test(c));
    if (urlIdx === -1) continue;
    const url = cols[urlIdx];
    const name = (cols.find((c, idx) => idx !== urlIdx && c) ?? "").trim();
    pairs.push({ name, url });
  }
  return pairs;
}

async function readStore(token: string) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${BLUSERENA_PATH}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "trendzn-bot",
      },
    },
  );
  if (!res.ok) throw new Error(`read_failed_${res.status}`);
  const file = await res.json();
  const store = JSON.parse(decodeBase64Utf8(file.content.replace(/\n/g, "")));
  if (!Array.isArray(store.canali)) store.canali = [];
  return { store, sha: file.sha as string };
}

export const Route = createFileRoute("/api/public/hooks/import-bluserena-bulk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Accetta sia un file (multipart/form-data, campo "file") sia un JSON
          // { items: [{ name, url }] } già parsato dal client.
          let pairs: Pair[] = [];
          const contentType = request.headers.get("content-type") || "";

          if (contentType.includes("multipart/form-data")) {
            const form = await request.formData();
            const file = form.get("file");
            if (!file || typeof file === "string") {
              return Response.json({ ok: false, error: "file mancante" }, { status: 400 });
            }
            const name = (file as File).name?.toLowerCase() ?? "";
            const buf = await (file as File).arrayBuffer();
            if (name.endsWith(".csv")) {
              pairs = parseCsv(new TextDecoder().decode(buf));
            } else {
              pairs = await parseXlsx(buf);
            }
          } else {
            const body = (await request.json()) as { items?: Pair[] };
            pairs = Array.isArray(body.items) ? body.items : [];
          }

          // Tieni solo URL validi
          pairs = pairs.filter((p) => p.url && /^https?:\/\//i.test(p.url.trim()));
          if (pairs.length === 0) {
            return Response.json(
              { ok: false, error: "Nessun URL valido trovato nel file" },
              { status: 400 },
            );
          }

          const token = process.env.GITHUB_TOKEN;
          if (!token) {
            return Response.json({ ok: false, error: "no_token" }, { status: 500 });
          }

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const { store, sha } = await readStore(token);
            const canali = store.canali as Channel[];

            const existingBases = new Set(
              canali.flatMap((c) => c.accounts.map((a) => urlBase(a.url))),
            );
            const existingIds = new Set(canali.map((c) => c.id));

            let added = 0;
            let skipped = 0;
            const byPlatform: Record<string, number> = {};
            const seenInBatch = new Set<string>();

            for (const { name, url } of pairs) {
              const normalized = normalizeUrl(url.trim());
              const base = urlBase(normalized);
              if (existingBases.has(base) || seenInBatch.has(base)) {
                skipped++;
                continue;
              }
              seenInBatch.add(base);

              const platform = detectPlatform(normalized);
              const handle = extractHandle(normalized, platform);
              const displayName = name?.trim() || handle;

              // id univoco: base slug da handle, con suffisso in caso di collisione
              let id = slugify(handle);
              if (existingIds.has(id)) {
                let n = 2;
                while (existingIds.has(`${id}-${n}`)) n++;
                id = `${id}-${n}`;
              }
              existingIds.add(id);

              canali.push({
                id,
                name: displayName,
                urls: [normalized],
                descrizione: null,
                accounts: [{ platform, handle, url: normalized }],
              });
              added++;
              byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
            }

            if (added === 0) {
              return Response.json({
                ok: true,
                added: 0,
                skipped,
                total: pairs.length,
                byPlatform,
                note: "Tutti i canali erano già presenti.",
              });
            }

            const writeRes = await fetch(
              `https://api.github.com/repos/${GITHUB_REPO}/contents/${BLUSERENA_PATH}`,
              {
                method: "PUT",
                headers: {
                  Authorization: `token ${token}`,
                  "Content-Type": "application/json",
                  "User-Agent": "trendzn-bot",
                },
                body: JSON.stringify({
                  message: `chore: import bulk ${added} canali Bluserena [trendzn-manual]`,
                  content: btoa(unescape(encodeURIComponent(JSON.stringify(store, null, 2)))),
                  sha,
                }),
              },
            );

            if (writeRes.ok) {
              return Response.json({
                ok: true,
                added,
                skipped,
                total: pairs.length,
                byPlatform,
              });
            }

            // sha non più valido (scrittura concorrente del bot): rileggo e riprovo
            if ((writeRes.status === 409 || writeRes.status === 422) && attempt < MAX_ATTEMPTS) {
              continue;
            }

            const err = await writeRes.text();
            return Response.json({ ok: false, error: err.slice(0, 150) }, { status: 500 });
          }

          return Response.json(
            { ok: false, error: "troppi conflitti di scrittura, riprova" },
            { status: 500 },
          );
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
