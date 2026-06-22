import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { type EditorialPostMedia, addMedia, deleteMedia, listMedia, swapMediaPosition } from "@/lib/editorialPlan";
import { MediaLightbox } from "./MediaLightbox";

function isVideo(url: string, type: string | null) {
  return (!!type && type.startsWith("video")) || /\.(mp4|mov|webm)$/i.test(url);
}

export function PostMediaGallery({ postId }: { postId: string }) {
  const [media, setMedia] = useState<EditorialPostMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  async function refresh() {
    setMedia(await listMedia(postId));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, [postId]);

  async function handleAddFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await addMedia(postId, file);
    }
    await refresh();
    setUploading(false);
  }

  async function handleDelete(item: EditorialPostMedia) {
    if (!window.confirm("Eliminare questo file?")) return;
    await deleteMedia(item.id);
    await refresh();
  }

  async function handleMove(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= media.length) return;
    await swapMediaPosition(media[idx], media[target]);
    await refresh();
  }

  if (loading) return <span className="text-muted-foreground">Carico…</span>;

  return (
    <div className="space-y-2">
      {media.length === 0 ? (
        <span className="text-muted-foreground">Nessun visual caricato</span>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {media.map((item, idx) => (
            <div key={item.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
              <button type="button" className="size-full" onClick={() => setLightboxIndex(idx)}>
                {isVideo(item.url, item.type) ? (
                  <video src={item.url} className="size-full object-cover" muted />
                ) : (
                  <img src={item.url} alt="" className="size-full object-cover" />
                )}
              </button>
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-1 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => handleMove(idx, -1)}
                  disabled={idx === 0}
                  className="rounded bg-white/20 p-0.5 text-white disabled:opacity-30"
                  title="Sposta prima"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="rounded bg-white/20 p-0.5 text-white hover:bg-destructive"
                  title="Elimina"
                >
                  <Trash2 className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(idx, 1)}
                  disabled={idx === media.length - 1}
                  className="rounded bg-white/20 p-0.5 text-white disabled:opacity-30"
                  title="Sposta dopo"
                >
                  <ChevronRight className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
        <Plus className="size-3" />
        {uploading ? "Carico…" : "Aggiungi file"}
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleAddFiles(e.target.files)}
        />
      </label>

      {lightboxIndex !== null && (
        <MediaLightbox media={media} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onNavigate={setLightboxIndex} />
      )}
    </div>
  );
}
