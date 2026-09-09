import { useMemo, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { type EditorialPost, listMedia } from "@/lib/editorialPlan";

// Piani Editoriali IHC — export .xlsx per Canva Bulk Create dei post
// segnati come "Story" o "Foto": una riga per post, con l'immagine
// (incorporata nella cella, stessa logica di /api/public/hooks/export-xlsx)
// o l'URL del video (Excel non può incorporare un video riproducibile), più
// una colonna per ogni campo di copy visual del post (il numero di colonne è
// il massimo tra tutti i post esportati: le celle in eccesso restano vuote).
// L'immagine finisce in una colonna diversa a seconda del formato del post
// ("Media Stories" per le Story, "Media Card" per le Foto), perché sono
// destinate a template Canva diversi.

const MEDIA_COLUMN_BY_FORMAT: Record<string, string> = {
  Story: "Media Stories",
  Foto: "Media Card",
};

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StoryExportPanel({
  posts,
  sheetName,
  canvaTemplateUrl,
}: {
  posts: EditorialPost[];
  sheetName: string;
  // Pagina del template Canva Bulk Create di questo sotto-brand (IHC_BRANDS):
  // aperta in una nuova scheda insieme al download dell'.xlsx.
  canvaTemplateUrl?: string;
}) {
  const exportablePosts = useMemo(
    () => posts.filter((p) => p.formato === "Story" || p.formato === "Foto"),
    [posts],
  );
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (exportablePosts.length === 0) return null;

  async function handleExport() {
    // Va aperto PRIMA di qualunque await: dopo il primo await il browser non
    // considera più il popup come conseguenza diretta del click e lo blocca.
    if (canvaTemplateUrl) {
      window.open(canvaTemplateUrl, "_blank", "noopener,noreferrer");
    }
    setExporting(true);
    setError(null);
    try {
      const mediaByPost = await Promise.all(exportablePosts.map((p) => listMedia(p.id)));

      const maxCopyCount = Math.max(
        1,
        ...exportablePosts.map((p) => p.copy_visual_list?.length ?? (p.copy_visual ? 1 : 0)),
      );
      const copyColumns = Array.from({ length: maxCopyCount }, (_, i) => `Copy Visual ${i + 1}`);
      const mediaColumns = ["Media Stories", "Media Card"];
      const columns = ["Data", ...mediaColumns, "Video (URL)", ...copyColumns];

      const rows = exportablePosts.map((post, i) => {
        const media = mediaByPost[i][0];
        const isVideo = media?.type?.startsWith("video/") ?? false;
        const mediaColumn = MEDIA_COLUMN_BY_FORMAT[post.formato ?? ""];
        const copyList = post.copy_visual_list?.length
          ? post.copy_visual_list
          : post.copy_visual
            ? [post.copy_visual]
            : [];
        const values: Record<string, string> = {
          Data: post.post_date,
          "Media Stories": "",
          "Media Card": "",
          "Video (URL)": media && isVideo ? media.url : "",
        };
        if (media && !isVideo && mediaColumn) values[mediaColumn] = media.url;
        copyColumns.forEach((col, idx) => {
          values[col] = copyList[idx] ?? "";
        });
        return { values };
      });

      const res = await fetch("/api/public/hooks/export-xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName, columns, imageColumns: mediaColumns, rows }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Export fallito (${res.status}): ${text.slice(0, 200)}`);
      }
      const blob = await res.blob();
      downloadBlob(`${sheetName}-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
      <span className="text-sm font-medium text-foreground">Export per Canva Bulk Create</span>
      <span className="text-sm text-muted-foreground">{exportablePosts.length} post pronti</span>
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Crea Stories ({exportablePosts.length})
      </button>
      {!canvaTemplateUrl && (
        <p className="w-full text-xs text-muted-foreground">
          Nessun template Canva configurato per questo sotto-brand: verrà solo scaricato l'.xlsx.
        </p>
      )}
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
