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

// SBAM AutoGraphics — export CSV per Canva Bulk Create. Sostituisce il
// vecchio percorso plugin Figma (che richiedeva di aprire l'app): qui il
// copywriter sceglie una rubrica, scarica un CSV con una riga per post
// approvato (colonne = i layer/campi della rubrica, con la foto Getty già
// risolta come URL) e lo carica in Canva Bulk Create.

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Il nome colonna nel CSV non porta il prefisso "#" (convenzione Figma): in
// Canva i placeholder tipo {{colonna}} non ne hanno bisogno.
function columnName(layerName: string): string {
  return layerName.replace(/^#/, "");
}

function buildCsv(jobs: ExportableJob[], constraints: TemplateConstraint[]): string {
  const header = ["post_date", ...constraints.map((c) => columnName(c.layer_name))];
  const rows = jobs.map((j) => [
    j.post_date,
    ...constraints.map((c) => j.values[c.layer_name] ?? ""),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function downloadCsv(filename: string, content: string): void {
  // BOM iniziale: senza, Excel interpreta male gli accenti nei valori italiani.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
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
      const csv = buildCsv(jobs, constraints);
      const filename = `${rubrica?.nome ?? "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, csv);
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
        Esporta CSV ({jobs.length})
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
