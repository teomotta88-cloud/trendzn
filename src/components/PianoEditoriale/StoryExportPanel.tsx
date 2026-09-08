import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { type EditorialPost, listMedia } from "@/lib/editorialPlan";

// Piani Editoriali IHC — export .xlsx per Canva Bulk Create dei soli post
// segnati come "Story": una riga per post, con l'immagine (incorporata nella
// cella, stessa logica di /api/public/hooks/export-xlsx) o l'URL del video
// (Excel non può incorporare un video riproducibile), più una colonna per
// ogni campo di copy visual del post (il numero di colonne è il massimo tra
// tutti i post esportati: le celle in eccesso restano vuote).

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
}: {
  posts: EditorialPost[];
  sheetName: string;
}) {
  const storyPosts = useMemo(() => posts.filter((p) => p.formato === "Story"), [posts]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (storyPosts.length === 0) return null;

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const mediaByPost = await Promise.all(storyPosts.map((p) => listMedia(p.id)));

      const maxCopyCount = Math.max(
        1,
        ...storyPosts.map((p) => p.copy_visual_list?.length ?? (p.copy_visual ? 1 : 0)),
      );
      const copyColumns = Array.from({ length: maxCopyCount }, (_, i) => `Copy Visual ${i + 1}`);
      const columns = ["Data", "Immagine", "Video (URL)", ...copyColumns];

      const rows = storyPosts.map((post, i) => {
        const media = mediaByPost[i][0];
        const isVideo = media?.type?.startsWith("video/") ?? false;
        const copyList = post.copy_visual_list?.length
          ? post.copy_visual_list
          : post.copy_visual
            ? [post.copy_visual]
            : [];
        const values: Record<string, string> = {
          Data: post.post_date,
          Immagine: media && !isVideo ? media.url : "",
          "Video (URL)": media && isVideo ? media.url : "",
        };
        copyColumns.forEach((col, idx) => {
          values[col] = copyList[idx] ?? "";
        });
        return { values };
      });

      const res = await fetch("/api/public/hooks/export-xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName, columns, imageColumns: ["Immagine"], rows }),
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
      <span className="text-sm font-medium text-foreground">Export Story per Canva Bulk Create</span>
      <span className="text-sm text-muted-foreground">{storyPosts.length} post pronti</span>
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        Esporta .xlsx ({storyPosts.length})
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
