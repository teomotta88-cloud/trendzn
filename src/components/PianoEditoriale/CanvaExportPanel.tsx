import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { EditorialPost } from "@/lib/editorialPlan";
import {
  type ExportableJob,
  type Rubrica,
  type TemplateConstraint,
  listExportableJobs,
  listRubriche,
  markJobsExported,
} from "@/lib/autographics";

// SBAM AutoGraphics — export .xlsx per Canva Bulk Create. Sostituisce il
// vecchio percorso plugin Figma (che richiedeva di aprire l'app): qui il
// copywriter sceglie una rubrica e scarica un .xlsx — generato server-side
// da /api/public/hooks/export-xlsx — con una riga per post approvato e le
// foto Getty già incorporate come immagini vere nelle celle (non un URL
// testuale: Canva Bulk Create riconosce come immagine solo un'immagine
// incorporata nel file, stessa logica del flusso Google Sheets già in uso
// in agenzia).

// Il nome colonna non porta il prefisso "#" (convenzione Figma): in Canva
// i placeholder tipo {{colonna}} non ne hanno bisogno.
function columnName(layerName: string): string {
  return layerName.replace(/^#/, "");
}

async function requestXlsx(
  sheetName: string,
  jobs: ExportableJob[],
  constraints: TemplateConstraint[],
): Promise<Blob> {
  const columns = ["post_date", ...constraints.map((c) => columnName(c.layer_name))];
  const imageColumns = constraints
    .filter((c) => c.layer_type === "image")
    .map((c) => columnName(c.layer_name));
  const rows = jobs.map((j) => ({
    values: {
      post_date: j.post_date,
      ...Object.fromEntries(
        constraints.map((c) => [columnName(c.layer_name), j.values[c.layer_name] ?? ""]),
      ),
    },
  }));

  const res = await fetch("/api/public/hooks/export-xlsx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetName, columns, imageColumns, rows }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export fallito (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.blob();
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CanvaExportPanel({ posts }: { posts: EditorialPost[] }) {
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [rubricaId, setRubricaId] = useState("");
  const [jobs, setJobs] = useState<ExportableJob[]>([]);
  const [constraints, setConstraints] = useState<TemplateConstraint[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRubriche(true)
      .then(setRubriche)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!rubricaId) {
      setJobs([]);
      setConstraints([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listExportableJobs(
      rubricaId,
      posts.map((p) => p.id),
    )
      .then((result) => {
        if (cancelled) return;
        setJobs(result.jobs);
        setConstraints(result.constraints);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rubricaId, posts]);

  async function handleExport() {
    if (jobs.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const rubrica = rubriche.find((r) => r.id === rubricaId);
      const sheetName = rubrica?.nome ?? "Export";
      const blob = await requestXlsx(sheetName, jobs, constraints);
      downloadBlob(`${sheetName}-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
      await markJobsExported(jobs.map((j) => j.job_id));
      const refreshed = await listExportableJobs(
        rubricaId,
        posts.map((p) => p.id),
      );
      setJobs(refreshed.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  if (rubriche.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
      <span className="text-sm font-medium text-foreground">Export Canva Bulk Create</span>
      <select
        value={rubricaId}
        onChange={(e) => setRubricaId(e.target.value)}
        className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">— Seleziona rubrica —</option>
        {rubriche.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nome}
          </option>
        ))}
      </select>
      {rubricaId && (
        <span className="text-sm text-muted-foreground">
          {loading ? "Verifico…" : `${jobs.length} post pronti per l'export`}
        </span>
      )}
      <button
        type="button"
        onClick={handleExport}
        disabled={!rubricaId || jobs.length === 0 || exporting}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        Esporta .xlsx ({jobs.length})
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
