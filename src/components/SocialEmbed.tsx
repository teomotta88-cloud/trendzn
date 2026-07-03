import { useEffect, useRef, useState } from "react";
import { detectPlatform, embedUrl } from "@/lib/trends";
import { ExternalLink, Instagram, Music2, Youtube, Globe, Linkedin, Play } from "lucide-react";

// L'iframe viene montato solo quando la card entra nel viewport e
// smontato quando ne esce: gli embed di Instagram/YouTube/LinkedIn partono
// in autoplay muto a prescindere dalla permission "autoplay" (i browser
// lo consentono comunque), quindi l'unico modo per evitare che tutti i
// video carichino dati e suonino contemporaneamente è richiedere
// l'iframe solo per i contenuti effettivamente visibili. Per TikTok si va
// oltre: vedi TikTokEmbed, che mostra solo un frame di anteprima (caricato
// subito per tutti i post in pagina, non solo quelli in viewport, perché è
// leggero) finché l'utente non clicca play.
function useVisible<T extends HTMLElement>(threshold = 0.5) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, visible] as const;
}

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

// Larghezza/altezza native del player embed v2 di TikTok: l'iframe è
// cross-origin, quindi non possiamo restare la scrollbar interna che TikTok
// mostra quando la caption non ha spazio sufficiente — possiamo però dare al
// canvas nativo più altezza (738 → 860) così la caption ha spazio per intero
// e lo scroll interno non scatta più. Il box esterno usa lo stesso rapporto
// esatto (via aspect-ratio), così lo scale è uguale su entrambi gli assi e
// non c'è letterboxing.
const TIKTOK_NATIVE_WIDTH = 325;
const TIKTOK_NATIVE_HEIGHT = 860;

// Anteprima statica (frame di copertina + caption) recuperata dall'oEmbed
// pubblico di TikTok, così possiamo mostrare da subito un'immagine leggera
// al posto dell'iframe, per ogni post presente in pagina (non solo quelli
// in viewport: è solo una piccola richiesta JSON, non un player).
function useTikTokThumbnail(url: string) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/hooks/tiktok-oembed?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok && data.thumbnail) {
          setThumbnail(data.thumbnail);
          setTitle(data.title ?? null);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { thumbnail, title, failed };
}

// Player TikTok vero e proprio: viene montato solo dopo il click sull'anteprima,
// per evitare l'autoplay muto che TikTok avvia automaticamente non appena
// l'iframe /embed/v2/ viene caricato.
function TikTokPlayerFrame({ embed, scale }: { embed: string; scale: number }) {
  return (
    <iframe
      src={embed}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: TIKTOK_NATIVE_WIDTH,
        height: TIKTOK_NATIVE_HEIGHT,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
      allow="encrypted-media; picture-in-picture; web-share; autoplay"
      allowFullScreen
      title="Video TikTok"
    />
  );
}

function TikTokEmbed({ embed, url }: { embed: string; url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [activated, setActivated] = useState(false);
  const { thumbnail, title, failed } = useTikTokThumbnail(url);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / TIKTOK_NATIVE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-xl border border-border bg-black"
      style={
        activated ? { aspectRatio: `${TIKTOK_NATIVE_WIDTH} / ${TIKTOK_NATIVE_HEIGHT}` } : undefined
      }
    >
      {activated ? (
        <TikTokPlayerFrame embed={embed} scale={scale} />
      ) : (
        <button
          type="button"
          onClick={() => setActivated(true)}
          aria-label="Riproduci video TikTok"
          className="group flex w-full flex-col text-left"
        >
          <div
            className="relative w-full overflow-hidden bg-neutral-900"
            style={{ aspectRatio: "3 / 4" }}
          >
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Music2 className={`size-8 text-neutral-600 ${failed ? "" : "animate-pulse"}`} />
              </div>
            )}
            <span className="absolute inset-0 bg-black/10 transition group-hover:bg-black/25" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg transition group-hover:scale-110 group-hover:bg-black/80">
                <Play className="size-6 translate-x-0.5 fill-white" />
              </span>
            </span>
          </div>
          {title && <p className="line-clamp-3 px-3 py-2 text-xs text-white/90">{title}</p>}
        </button>
      )}
    </div>
  );
}

export function SocialEmbed({ url }: { url: string }) {
  const platform = detectPlatform(url);
  const embed = embedUrl(url);
  const [visibleRef, visible] = useVisible<HTMLDivElement>();

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
      <div ref={visibleRef} className="relative w-full overflow-hidden rounded-xl border border-border bg-white" style={{ minHeight: 570 }}>
        {visible && (
          <iframe
            src={embed}
            className="absolute inset-0 size-full"
            height="570"
            width="100%"
            frameBorder={0}
            allowFullScreen
            title="Post LinkedIn"
          />
        )}
      </div>
    );
  }

  if (platform === "tiktok") {
    return <TikTokEmbed embed={embed} url={url} />;
  }

  const aspect = platform === "youtube" ? "aspect-video" : "aspect-[9/16]";

  return (
    <div ref={visibleRef} className={`relative ${aspect} w-full overflow-hidden rounded-xl border border-border bg-black`}>
      {visible && (
        <iframe
          src={embed}
          className="absolute inset-0 size-full"
          scrolling="no"
          allow="encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      )}
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
