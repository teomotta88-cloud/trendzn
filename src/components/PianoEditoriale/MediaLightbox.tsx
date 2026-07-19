import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { type EditorialPostMedia } from "@/lib/editorialPlan";

function isVideo(url: string, type: string | null) {
  return (!!type && type.startsWith("video")) || /\.(mp4|mov|webm)$/i.test(url);
}

export function MediaLightbox({
  media,
  index,
  onClose,
  onNavigate,
}: {
  media: EditorialPostMedia[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNavigate((index - 1 + media.length) % media.length);
      if (e.key === "ArrowRight") onNavigate((index + 1) % media.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, media.length, onClose, onNavigate]);

  const current = media[index];
  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <a
        href={current.url}
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute right-16 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="Scarica"
      >
        <Download className="size-5" />
      </a>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="Chiudi"
      >
        <X className="size-5" />
      </button>

      {media.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate((index - 1 + media.length) % media.length);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title="Precedente"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}

      <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        {isVideo(current.url, current.type) ? (
          <video
            src={current.url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        ) : (
          <img
            src={current.url}
            alt=""
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        )}
      </div>

      {media.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate((index + 1) % media.length);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title="Successivo"
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      {media.length > 1 && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {index + 1} / {media.length}
        </span>
      )}
    </div>
  );
}
