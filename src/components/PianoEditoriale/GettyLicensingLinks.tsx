import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { type GraphicJobImage, getJobForPost, listGraphicJobImages } from "@/lib/autographics";

// Le foto scelte da Getty nel wizard di composizione post (VisualWizardModal)
// sono bozzetti con watermark: il PNG finale caricato nel post le contiene
// già "cotte" nel design, ma per scaricare l'asset vero in HD serve andare
// su Getty e cercarlo per ID (non esiste un endpoint di download automatico
// senza un abbonamento/API key Getty, vedi getty-search.ts). Questo pannello
// elenca quei link, uno per campo immagine Getty usato in questo post.
export function GettyLicensingLinks({ postId }: { postId: string }) {
  const [images, setImages] = useState<GraphicJobImage[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const job = await getJobForPost(postId);
      if (!job) return;
      const imgs = await listGraphicJobImages(job.id);
      if (!cancelled) setImages(imgs.filter((img) => img.source === "getty"));
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (images.length === 0) return null;

  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border p-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Foto Getty da scaricare in HD
      </span>
      {images.map((img) => (
        <a
          key={img.id}
          href={`https://www.gettyimages.com/search/2/image?phrase=${img.asset_id}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="size-3" />
          {img.layer_name}: cerca l'asset {img.asset_id} su Getty Images
        </a>
      ))}
    </div>
  );
}
