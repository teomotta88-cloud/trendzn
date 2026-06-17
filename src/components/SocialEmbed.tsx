import { useEffect, useState } from "react";
import { detectPlatform, embedUrl } from "@/lib/trends";
import { ExternalLink, Instagram, Music2, Youtube, Globe, Linkedin } from "lucide-react";

type LinkPreview = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

function LinkedInPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/hooks/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok && (data.title || data.image)) {
          setPreview(data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        Caricamento anteprima…
      </div>
    );
  }

  // Fallback al link semplice se non troviamo dati utili
  if (failed || !preview) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
      >
        <span>
          <Linkedin className="mx-auto mb-2 size-5" />
          Apri su LinkedIn
        </span>
      </a>
    );
  }

  // LinkedIn restituisce spesso un'immagine generica di brand invece della
  // foto specifica del post (i post pubblici non autenticati sono limitati).
  // La riconosciamo dal pattern dell'URL e la trattiamo come "nessuna immagine".
  const isGenericLinkedInImage =
    !preview.image ||
    /static[.-]licdn\.com.*(logo|brand|default)/i.test(preview.image) ||
    /licdn\.com\/aero-v1/i.test(preview.image);

  const hasRealImage = preview.image && !isGenericLinkedInImage;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex aspect-[9/16] w-full flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary"
    >
      {hasRealImage ? (
        <div className="relative flex-1 overflow-hidden bg-muted">
          <img
            src={preview.image!}
            alt=""
            className="absolute inset-0 size-full object-cover transition group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#0a66c2]/5 p-6 text-center">
          <Linkedin className="size-8 text-[#0a66c2]/60" />
          {preview.title && (
            <p className="line-clamp-4 text-sm font-semibold leading-snug text-foreground">{preview.title}</p>
          )}
        </div>
      )}
      <div className="space-y-1 border-t border-border p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[#0a66c2]">
          <Linkedin className="size-3" />
          LinkedIn
        </div>
        {hasRealImage && preview.title && (
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">{preview.title}</p>
        )}
        {preview.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{preview.description}</p>}
      </div>
    </a>
  );
}

export function SocialEmbed({ url }: { url: string }) {
  const platform = detectPlatform(url);
  const embed = embedUrl(url);

  // LinkedIn: se abbiamo un embed reale (activity ID trovato), usalo.
  // Altrimenti fallback all'anteprima Open Graph.
  if (!embed && platform === "linkedin") {
    return <LinkedInPreview url={url} />;
  }

  if (!embed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
      >
        <span>
          <ExternalLink className="mx-auto mb-2 size-5" />
          Apri link esterno
        </span>
      </a>
    );
  }

  if (platform === "linkedin") {
    return (
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-white"
        style={{ minHeight: 570 }}
      >
        <iframe
          src={embed}
          className="absolute inset-0 size-full"
          height="570"
          width="100%"
          frameBorder={0}
          allowFullScreen
          title="Post LinkedIn"
        />
      </div>
    );
  }

  const aspect = platform === "youtube" ? "aspect-video" : "aspect-[9/16]";

  return (
    <div className={`relative ${aspect} w-full overflow-hidden rounded-xl border border-border bg-black`}>
      <iframe
        src={embed}
        className="absolute inset-0 size-full"
        allow="autoplay; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const cls = className ?? "size-4";
  if (platform === "instagram") return <Instagram className={cls} />;
  if (platform === "tiktok") return <Music2 className={cls} />;
  if (platform === "youtube") return <Youtube className={cls} />;
  if (platform === "linkedin") return <Linkedin className={cls} />;
  return <Globe className={cls} />;
}
