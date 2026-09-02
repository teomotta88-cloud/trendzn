import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import ExcelJS from "exceljs";
import type { CanaleInspo } from "@/lib/trends";
import { PlatformIcon } from "@/components/SocialEmbed";
import { ManualSubmitDialog } from "@/components/ManualSubmitDialog";
import { BluserenaBackfillStats } from "@/components/BluserenaBackfillStats";
import { BluserenaFeedAdvanced } from "@/components/BluserenaFeedAdvanced";
import { Search, Trash2, Upload, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FeedPageToggle, TrendzFeed, SyncButton } from "./feed.index";

// Duplicato di aspi-monitoring.index.tsx per la pagina "Bluserena-monitoring" —
// stessa logica, store INDIPENDENTE (bluserena-monitoring.json, sezione
// "bluserena-monitoring" in trend_submissions). Parte vuota: nessun canale
// precaricato.

export const Route = createFileRoute("/bluserena-monitoring/")({
  head: () => ({
    meta: [
      { title: "Bluserena-monitoring" },
      {
        name: "description",
        content: "Monitoraggio di account social selezionati, caricati manualmente.",
      },
    ],
  }),
  component: BluserenaMonitoringPage,
});

const BLUSERENA_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/bluserena-monitoring.json";
const BLUSERENA_SYNC_ENDPOINT = "/api/public/hooks/trigger-sync-bluserena-monitoring";
const BLUSERENA_HASHTAG_SYNC_ENDPOINT = "/api/public/hooks/trigger-sync-bluserena-hashtags";
const BULK_IMPORT_ENDPOINT = "/api/public/hooks/import-bluserena-bulk";

type BulkImportStatus = "idle" | "reading" | "importing" | "success" | "error";

type BulkImportPreviewRow = {
  title: string;
  url: string;
};

type BulkImportResult = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function BluserenaMonitoringPage() {
  const [tab, setTab] = useState<string>("canali");

  return tab === "canali" ? (
    <BluserenaCanaliView tab={tab} setTab={setTab} />
  ) : (
    <BluserenaFeedAdvanced
      tab={tab}
      setTab={setTab}
      jsonUrl={BLUSERENA_JSON_URL}
    />
  );
}

function detectPlatform(
  url: string,
): "instagram" | "tiktok" | "youtube" | "linkedin" | "x" | "web" {
  const normalized = url.toLowerCase();
  if (/instagram\.com/.test(normalized)) return "instagram";
  if (/tiktok\.com/.test(normalized)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(normalized)) return "youtube";
  if (/linkedin\.com/.test(normalized)) return "linkedin";
  if (/x\.com|twitter\.com/.test(normalized)) return "x";
  return "web";
}

function extractHandle(url: string): string {
  try {
    const clean = url.replace(/\/$/, "").split("?")[0];
    const parts = clean.split("/").filter(Boolean);
    return parts[parts.length - 1]?.replace(/^@/, "") || url;
  } catch {
    return url;
  }
}

// Riconosce le pagine hashtag (Instagram /explore/tags/<tag>/, TikTok
// /tag/<tag>, X /hashtag/<tag>) per distinguerle dai profili in fase di
// visualizzazione — nessun campo extra nello store, la forma del path basta
// (stessa tecnica usata da sync-bluserena-hashtags.mjs lato server).
function isHashtagUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    if (/instagram\.com$/.test(host)) return /^\/explore\/tags\/[^/]+$/.test(path);
    if (/tiktok\.com$/.test(host)) return /^\/tags?\/[^/]+$/.test(path);
    if (/^(x\.com|twitter\.com)$/.test(host)) return /^\/hashtag\/[^/]+$/.test(path);
    return false;
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if ("text" in value && value.text) return String(value.text).trim();
    if ("hyperlink" in value && value.hyperlink) return String(value.hyperlink).trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((item) => item.text)
        .join("")
        .trim();
    }
    if ("result" in value && value.result != null) return String(value.result).trim();
  }

  return String(value).trim();
}

async function readBluserenaExcel(file: File): Promise<BulkImportPreviewRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.getWorksheet("TOTALONE") ?? workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values as ExcelJS.CellValue[];

  let titleColumn = 1;
  let urlColumn = 2;

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(getCellText(header));
    if (normalized === "nome canale" || normalized === "nome" || normalized === "canale") {
      titleColumn = index;
    }
    if (normalized === "url" || normalized === "link") {
      urlColumn = index;
    }
  });

  const rows: BulkImportPreviewRow[] = [];
  const seen = new Set<string>();

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const title = getCellText(row.getCell(titleColumn).value);
    const url = normalizeUrl(getCellText(row.getCell(urlColumn).value));

    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;

    const dedupeKey = url.toLowerCase().replace(/\/$/, "");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    rows.push({
      title: title || extractHandle(url),
      url,
    });
  });

  return rows;
}

async function importRowsInBatches(rows: BulkImportPreviewRow[]): Promise<BulkImportResult> {
  const result: BulkImportResult = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    const res = await fetch(BULK_IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: rows.map((r) => ({ name: r.title, url: r.url })) }),
    });

    let data: { ok?: boolean; added?: number; skipped?: number; error?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (res.ok && data?.ok) {
      result.imported = data.added ?? 0;
      result.skipped = data.skipped ?? 0;
    } else {
      result.failed = rows.length;
      result.errors.push(data?.error || "errore durante l'import");
    }
  } catch {
    result.failed = rows.length;
    result.errors.push("errore di rete durante l'import");
  }

  return result;
}

type DbRow = {
  id: string;
  url: string;
  title: string | null;
  industry: string | null;
  category: string | null;
};

function rowToCanale(row: DbRow): CanaleInspo {
  const platform = detectPlatform(row.url);
  const handle = extractHandle(row.url);

  return {
    id: row.id,
    name: row.title ?? handle,
    urls: [row.url],
    descrizione: row.industry ?? null,
    accounts: [{ platform, handle, url: row.url }],
  };
}

function BulkImportButton({ onSuccess }: { onSuccess: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<BulkImportStatus>("idle");
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = status === "reading" || status === "importing";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";

    if (!file) return;

    setResult(null);
    setError(null);
    setStatus("reading");

    try {
      const rows = await readBluserenaExcel(file);

      if (rows.length === 0) {
        setStatus("error");
        setError(
          "Nessun canale valido trovato nel file. Controlla che esistano le colonne 'Nome canale' e 'URL'.",
        );
        return;
      }

      const confirmed = window.confirm(
        `Ho trovato ${rows.length} canali da importare in Bluserena-monitoring. Procedo?`,
      );

      if (!confirmed) {
        setStatus("idle");
        return;
      }

      setStatus("importing");
      const importResult = await importRowsInBatches(rows);
      setResult(importResult);
      setStatus(importResult.failed > 0 ? "error" : "success");
      onSuccess();
    } catch (err) {
      console.error(err);
      setStatus("error");
      setError("Errore durante la lettura del file Excel.");
    }
  }

  const label: Record<BulkImportStatus, string> = {
    idle: "Importa Excel",
    reading: "Leggo file…",
    importing: "Importo…",
    success: "Import completato",
    error: "Import non completato",
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Upload size={15} />
        {label[status]}
      </button>

      {result && (
        <div className="max-w-md rounded-lg border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Import:</span> {result.imported} aggiunti,{" "}
          {result.skipped} già presenti, {result.failed} errori.
          {result.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-destructive">Dettaglio errori</summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {result.errors.slice(0, 10).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function BluserenaCanaliView({
  tab,
  setTab,
}: {
  tab: "feed" | "canali";
  setTab: (t: "feed" | "canali") => void;
}) {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState("");
  const [dbRows, setDbRows] = useState<DbRow[]>([]);
  const [jsonCanali, setJsonCanali] = useState<CanaleInspo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingId) return;
    const t = setTimeout(() => setConfirmingId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmingId]);

  const fetchJson = useCallback(() => {
    // ?t= evita la cache di qualche minuto di raw.githubusercontent.com:
    // senza, un aggiornamento del json (es. dopo un workflow) può non
    // vedersi in pagina per un po' anche ricaricando.
    return fetch(`${BLUSERENA_JSON_URL}?t=${Date.now()}`)
      .then((r) => r.json())
      .then((decoded) => {
        setJsonCanali(decoded.canali || []);
      })
      .catch((e) => console.error("Errore caricamento bluserena-monitoring.json:", e));
  }, []);

  const fetchDb = useCallback(() => {
    return supabase
      .from("trend_submissions")
      .select("id, url, title, industry, category")
      .eq("section", "bluserena-monitoring")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }: { data: unknown[] | null }) => {
        if (data) setDbRows(data as DbRow[]);
      });
  }, []);

  useEffect(() => {
    Promise.all([fetchJson(), fetchDb()]).finally(() => setLoading(false));
  }, [fetchJson, fetchDb]);

  const handleManualSuccess = useCallback(() => {
    fetchDb();
    setTimeout(fetchJson, 1500);
  }, [fetchDb, fetchJson]);

  const handleBulkSuccess = useCallback(() => {
    fetchDb();
    setTimeout(fetchJson, 1500);
  }, [fetchDb, fetchJson]);

  const handleToDbId = useMemo(() => {
    const map = new Map<string, string>();
    dbRows.forEach((r) => {
      const handle = extractHandle(r.url).toLowerCase();
      if (!map.has(handle)) map.set(handle, r.id);
    });
    return map;
  }, [dbRows]);

  const handleDeleteSupabase = useCallback(async (dbId: string) => {
    setConfirmingId(null);
    setDeleting(dbId);

    try {
      const res = await fetch("/api/public/hooks/delete-trend-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dbId }),
      });

      if (res.ok) {
        setDbRows((prev) => prev.filter((r) => r.id !== dbId));
      } else {
        setDeleteError("Errore durante l'eliminazione. Riprova.");
        setTimeout(() => setDeleteError(null), 4000);
      }
    } catch {
      setDeleteError("Errore di rete. Riprova.");
      setTimeout(() => setDeleteError(null), 4000);
    }

    setDeleting(null);
  }, []);

  const handleDeleteJson = useCallback(async (canaleId: string) => {
    setConfirmingId(null);
    setDeleting(canaleId);

    try {
      const res = await fetch("/api/public/hooks/delete-canale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canaleId, store: "bluserena-monitoring" }),
      });

      if (res.ok) {
        setJsonCanali((prev) => prev.filter((c) => c.id !== canaleId));
      } else {
        setDeleteError("Errore durante l'eliminazione. Riprova.");
        setTimeout(() => setDeleteError(null), 4000);
      }
    } catch {
      setDeleteError("Errore di rete. Riprova.");
      setTimeout(() => setDeleteError(null), 4000);
    }

    setDeleting(null);
  }, []);

  const jsonHandles = useMemo(
    () => new Set(jsonCanali.flatMap((c) => c.accounts.map((a) => a.handle.toLowerCase()))),
    [jsonCanali],
  );

  const dbCanali = useMemo(
    () =>
      dbRows
        .map(rowToCanale)
        .filter((c) => !c.accounts.some((a) => jsonHandles.has(a.handle.toLowerCase()))),
    [dbRows, jsonHandles],
  );

  const allCanali = useMemo(() => [...dbCanali, ...jsonCanali], [dbCanali, jsonCanali]);
  const dbIds = useMemo(() => new Set(dbRows.map((r) => r.id)), [dbRows]);

  const platforms = useMemo(
    () => Array.from(new Set(allCanali.flatMap((c) => c.accounts.map((a) => a.platform)))).sort(),
    [allCanali],
  );

  const filtered = useMemo(
    () =>
      allCanali.filter((c) => {
        if (plat && !c.accounts.some((a) => a.platform === plat)) return false;

        if (q) {
          const hay = (
            c.name +
            " " +
            (c.descrizione ?? "") +
            " " +
            c.accounts.map((a) => a.handle).join(" ")
          ).toLowerCase();

          if (!hay.includes(q.toLowerCase())) return false;
        }

        return true;
      }),
    [allCanali, q, plat],
  );

  if (loading) {
    return (
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Bluserena-monitoring</h1>
          <p className="text-sm text-muted-foreground">Caricamento canali…</p>
        </header>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Bluserena-monitoring</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Account social selezionati da monitorare, oppure pagine hashtag di Instagram, TikTok e
            X. Caricali manualmente con "Aggiungi" oppure importa un file Excel in bulk.
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2">
          <SyncButton endpoint={BLUSERENA_HASHTAG_SYNC_ENDPOINT} label="↻ Sincronizza hashtag" />
          <BulkImportButton onSuccess={handleBulkSuccess} />
          <ManualSubmitDialog section="bluserena-monitoring" onSuccess={handleManualSuccess} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex">
          <FeedPageToggle tab={tab} setTab={setTab} canaliLabel="Bluserena-monitoring" />
        </div>
        <Link to="/ai-intelligence" className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline">
          <BarChart3 className="size-3.5" />
          Dashboard AI Intelligence
        </Link>
      </div>

      {/* Backfill Statistics */}
      {tab === "canali" && allCanali.length > 0 && (
        <BluserenaBackfillStats />
      )}

      {deleteError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {allCanali.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nessun canale ancora. Aggiungine uno con "Aggiungi" oppure importa un Excel.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cerca account o descrizione…"
                className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>

            <select
              value={plat}
              onChange={(e) => setPlat(e.target.value)}
              className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Tutte le piattaforme</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} / {allCanali.length}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((c) => {
              const main = c.accounts[0];
              // isHashtag si basa su c.urls[0] (l'URL originale inserito),
              // non su main.url: più esplicito da leggere, ed è comunque la
              // stessa fonte usata per creare main al momento dell'inserimento.
              const isHashtag = isHashtagUrl(c.urls[0] ?? "");
              const displayHandle = main?.handle || extractHandle(c.urls[0] ?? "");
              const initial =
                c.name
                  .replace(/[^a-zA-Z0-9]/g, "")
                  .charAt(0)
                  .toUpperCase() || "•";

              const isDb = dbIds.has(c.id);
              const isJsonCanale = jsonCanali.some((j) => j.id === c.id);

              const dbIdForCanale = isDb
                ? c.id
                : (c.accounts.map((a) => handleToDbId.get(a.handle.toLowerCase())).find(Boolean) ??
                  null);

              const canDeleteJson = isJsonCanale;
              const canDeleteSupabase = !!dbIdForCanale && !isJsonCanale;
              const deletingThis = !!deleting && (deleting === dbIdForCanale || deleting === c.id);

              const cardContent = (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {initial}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold text-foreground">{c.name}</h2>
                      {displayHandle && (
                        <p className="truncate text-xs text-muted-foreground">
                          {isHashtag ? "#" : "@"}
                          {displayHandle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {c.accounts.map((a, i) => (
                      <span
                        key={`${a.platform}-${a.handle}-${i}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        <PlatformIcon platform={a.platform} />
                        {a.platform}
                      </span>
                    ))}
                  </div>

                  {c.descrizione && (
                    <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {c.descrizione}
                    </p>
                  )}
                </>
              );

              return (
                <div key={c.id} className="group relative">
                  {canDeleteSupabase &&
                    (() => {
                      const isConfirming = confirmingId === dbIdForCanale;

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isConfirming) handleDeleteSupabase(dbIdForCanale!);
                            else setConfirmingId(dbIdForCanale);
                          }}
                          disabled={deletingThis}
                          className={
                            "absolute right-2 top-2 z-10 rounded-lg border p-1.5 text-xs font-medium transition " +
                            (isConfirming
                              ? "flex items-center gap-1 border-destructive bg-destructive text-destructive-foreground"
                              : "hidden border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex")
                          }
                          title={isConfirming ? "Clicca di nuovo per confermare" : "Elimina"}
                        >
                          <Trash2 size={14} />
                          {isConfirming && "Confermi?"}
                        </button>
                      );
                    })()}

                  {canDeleteJson &&
                    (() => {
                      const isConfirming = confirmingId === c.id;

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isConfirming) handleDeleteJson(c.id);
                            else setConfirmingId(c.id);
                          }}
                          disabled={deletingThis}
                          className={
                            "absolute right-2 top-2 z-10 rounded-lg border p-1.5 text-xs font-medium transition " +
                            (isConfirming
                              ? "flex items-center gap-1 border-destructive bg-destructive text-destructive-foreground"
                              : "hidden border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex")
                          }
                          title={isConfirming ? "Clicca di nuovo per confermare" : "Elimina"}
                        >
                          <Trash2 size={14} />
                          {isConfirming && "Confermi?"}
                        </button>
                      );
                    })()}

                  {isJsonCanale ? (
                    <Link
                      to="/bluserena-monitoring/$id"
                      params={{ id: c.id }}
                      className="flex min-h-[150px] flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary"
                    >
                      {cardContent}
                    </Link>
                  ) : (
                    <a
                      href={main?.url ?? c.urls[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[150px] flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary"
                    >
                      {cardContent}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
