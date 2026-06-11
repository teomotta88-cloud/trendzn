import { detectPlatform, embedUrl } from "@/lib/trends";
import { ExternalLink, Instagram, Music2, Youtube, Globe } from "lucide-react";

export function SocialEmbed({ url }: { url: string }) {
  const platform = detectPlatform(url);
  const embed = embedUrl(url);

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
  return <Globe className={cls} />;
}
