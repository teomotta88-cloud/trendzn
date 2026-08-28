import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { detectPlatform, type CanaleInspo } from "@/lib/trends";
import { bluserenaCanali } from "@/lib/bluserenaMonitoring";
import { SocialEmbed, PlatformIcon } from "@/components/SocialEmbed";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Heart,
  MapPin,
  MessageCircle,
  Search,
  Share2,
  Smile,
  Tag,
  Check,
  AlertCircle,
  Zap,
} from "lucide-react";
import { verifyBluserenaPost, type VerificationStatus } from "@/lib/trends";

// Dettaglio canale Bluserena-monitoring — copia di aspi-monitoring.$id.tsx,
// legge dallo store dedicato (bluserenaCanali, bundlato da bluserena-monitoring.json).

export const Route = createFileRoute("/bluserena-monitoring/$id")({
  head: () => ({
    meta: [
      { title: "Canale — Bluserena-monitoring" },
      { name: "description", content: "Canale monitorato." },
    ],
  }),
  component: Page,
});

const POST_URL_RE = /\/(p|reel|reels|video|photo|watch|tv|status)\//i;
type VerificationFilter = "all" | "confirmed" | "unconfirmed";

// Riconosce le pagine hashtag (Instagram /explore/tags/<tag>/, TikTok
// /tag/<tag>, X /hashtag/<tag>) per distinguerle dai profili in fase di
// visualizzazione — stessa tecnica usata in bluserena-monitoring.index.tsx e
// da sync-bluserena-hashtags.mjs lato server.
function isHashtagUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    if (/instagram\.com$/.test(host)) return /^\/explore\/tags\/[^/]+$/.test(path);
    if (/tiktok\.com$/.test(host)) return /^\/tags?\/[^/]+$/.test(path);
    if (/^(x\.com|twitter\.com)$/.test(host)) return /^\/hashtag\/[^/]+$/.test(path);
    return false;
  } catch {
    return false;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Intl.DateTimeFormat("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return "";
  }
}

const PAGE_SIZE = 9;

function Page() {
  const { id } = Route.useParams();
  const canale: CanaleInspo | undefined = bluserenaCanali.find((c) => String(c.id) === String(id));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [updatingUrl, setUpdatingUrl] = useState<string | null>(null);

  const toggleVerificationStatus = async (postUrl: string, currentStatus: VerificationStatus) => {
    if (!canale) return;

    const newStatus: VerificationStatus = currentStatus === "confirmed" ? "unconfirmed" : "confirmed";
    setUpdatingUrl(postUrl);

    try {
      const res = await fetch("/api/public/hooks/update-bluserena-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: canale.id,
          postUrl,
          verificationStatus: newStatus,
        }),
      });

      if (res.ok) {
        // Ricarica la pagina per mostrare il cambiamento
        window.location.reload();
      } else {
        console.error("Errore aggiornamento verifica:", await res.text());
      }
    } catch (err) {
      console.error("Errore aggiornamento verifica:", err);
    } finally {
      setUpdatingUrl(null);
    }
  };

  const allPosts = useMemo(() => {
    if (!canale) return [];
    const posts = canale.accounts.filter((a) => POST_URL_RE.test(a.url));
    return [...posts].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }, [canale]);

  const filteredPosts = useMemo(() => {
    let posts = allPosts;

    // Filtro search
    if (search) {
      const q = search.toLowerCase();
      posts = posts.filter(
        (a) => a.caption?.toLowerCase().includes(q) || a.handle?.toLowerCase().includes(q),
      );
    }

    // Filtro verification
    if (verificationFilter !== "all") {
      posts = posts.filter((a) => {
        const status = a.verificationStatus || verifyBluserenaPost(a.caption);
        return status === verificationFilter;
      });
    }

    return posts;
  }, [allPosts, search, verificationFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const profileLinks = useMemo(
    () => (canale ? canale.accounts.filter((a) => !POST_URL_RE.test(a.url)) : []),
    [canale],
  );

  if (!canale) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Canale non trovato</h1>
        <Link to="/bluserena-monitoring" className="mt-4 inline-block text-primary">
          Torna ai canali
        </Link>
      </div>
    );
  }

  const initial =
    canale.name
      .replace(/[^a-zA-Z0-9]/g, "")
      .charAt(0)
      .toUpperCase() || "•";
  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  return (
    <div className="space-y-8">
      <Link
        to="/bluserena-monitoring"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Tutti i canali
      </Link>

      <header className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-gradient-to-br from-card to-secondary/40 p-8 sm:flex-row sm:items-start sm:gap-8">
        <div className="relative flex aspect-square w-32 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10">
          <div className="flex size-[88%] items-center justify-center rounded-full bg-card font-display text-5xl font-bold">
            {initial}
          </div>
        </div>
        <div className="flex-1 space-y-3 text-center sm:text-left">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            {isHashtagUrl(canale.urls[0] ?? "") ? "#" : "@"}
            {canale.name}
          </h1>
          {canale.descrizione && (
            <p className="text-sm text-muted-foreground sm:text-base">{canale.descrizione}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {canale.accounts.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
              >
                <PlatformIcon platform={a.platform} className="size-3.5" />
                {a.platform} · {a.handle}
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Ultimi contenuti</h2>
            {allPosts.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cerca nelle caption…"
                    className="w-56 rounded-lg border border-border bg-background/60 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {Math.min(visibleCount, filteredPosts.length)} / {filteredPosts.length}
                </span>
              </div>
            )}
          </div>

          {/* Verification filter */}
          {allPosts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Verifica BS:</span>
              <button
                onClick={() => setVerificationFilter("all")}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition ${
                  verificationFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Tutti
              </button>
              <button
                onClick={() => setVerificationFilter("confirmed")}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition flex items-center gap-1 ${
                  verificationFilter === "confirmed"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Check className="size-3" /> Confermati
              </button>
              <button
                onClick={() => setVerificationFilter("unconfirmed")}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition flex items-center gap-1 ${
                  verificationFilter === "unconfirmed"
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <AlertCircle className="size-3" /> Non confermati
              </button>
            </div>
          )}
        </div>

        {allPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nessun post ancora per questo canale.
              <br />
              Il monitoraggio raccoglie i contenuti recenti al prossimo giro (profili: solo
              Instagram e TikTok; pagine hashtag: Instagram, TikTok e X).
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {profileLinks.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <PlatformIcon platform={a.platform} className="size-4" />
                  Apri su {a.platform}
                </a>
              ))}
            </div>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Nessun post corrisponde alla ricerca.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePosts.map((a, i) => {
                const dateLabel = formatDate(a.date);
                const status = a.verificationStatus || verifyBluserenaPost(a.caption);
                return (
                  <article
                    key={i}
                    className="space-y-2 rounded-2xl border border-border bg-card p-3"
                  >
                    <SocialEmbed url={a.url} />
                    <div className="flex flex-col gap-2 px-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <PlatformIcon platform={detectPlatform(a.url)} className="size-3" />
                          {detectPlatform(a.url)}
                        </span>
                        {dateLabel && <span className="text-muted-foreground">{dateLabel}</span>}
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          Apri ↗
                        </a>
                      </div>
                      {/* Verification badge - clickable to toggle */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleVerificationStatus(a.url, status)}
                          disabled={updatingUrl === a.url}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80 disabled:opacity-50 ${
                            status === "confirmed"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                          }`}
                          title="Click to toggle verification status"
                        >
                          {status === "confirmed" ? (
                            <>
                              <Check className="size-3" />
                              BS Confirmed
                            </>
                          ) : (
                            <>
                              <AlertCircle className="size-3" />
                              BS Unconfirmed
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    {(a.handle ||
                      a.location ||
                      a.views != null ||
                      a.likes != null ||
                      a.comments != null ||
                      a.shares != null) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
                        {a.handle && <span>@{a.handle}</span>}
                        {a.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            {a.location}
                          </span>
                        )}
                        {a.views != null && (
                          <span className="inline-flex items-center gap-1">
                            <Eye className="size-3" />
                            {a.views}
                          </span>
                        )}
                        {a.likes != null && (
                          <span className="inline-flex items-center gap-1">
                            <Heart className="size-3" />
                            {a.likes}
                          </span>
                        )}
                        {a.comments != null && (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="size-3" />
                            {a.comments}
                          </span>
                        )}
                        {a.shares != null && (
                          <span className="inline-flex items-center gap-1">
                            <Share2 className="size-3" />
                            {a.shares}
                          </span>
                        )}
                      </div>
                    )}
                    {a.caption && (
                      <p className="line-clamp-3 px-1 pb-1 text-[11px] leading-relaxed text-muted-foreground">
                        {a.caption}
                      </p>
                    )}
                    {(a.sentiment || (a.topics && a.topics.length > 0) || a.ocrData || a.ocrInsights) && (
                      <div className="space-y-2 px-1 pt-2 border-t border-border/50">
                        {a.sentiment && (
                          <div className="flex items-center gap-1.5">
                            <Smile className="size-3 text-muted-foreground" />
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                a.sentiment === "positive"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : a.sentiment === "negative"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                              }`}
                            >
                              {a.sentiment === "positive"
                                ? "😊 Positivo"
                                : a.sentiment === "negative"
                                  ? "😞 Negativo"
                                  : "😐 Neutrale"}
                            </span>
                          </div>
                        )}
                        {a.topics && a.topics.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Tag className="size-3 text-muted-foreground" />
                            <div className="flex flex-wrap gap-1">
                              {a.topics.slice(0, 3).map((topic, tidx) => (
                                <span
                                  key={tidx}
                                  className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  {topic}
                                </span>
                              ))}
                              {a.topics.length > 3 && (
                                <span className="inline-flex items-center rounded-full bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  +{a.topics.length - 3}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {(a.ocrData || a.ocrInsights) && (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Zap className="size-3 text-amber-600 dark:text-amber-500" />
                              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                OCR Analysis
                              </span>
                            </div>
                            {a.ocrData?.textOnScreen && (
                              <p className="text-[9px] text-muted-foreground px-1 py-0.5 bg-muted/50 rounded italic">
                                Text: "{a.ocrData.textOnScreen.slice(0, 60)}{a.ocrData.textOnScreen.length > 60 ? "..." : ""}"
                              </p>
                            )}
                            {a.ocrInsights && (
                              <p className="text-[9px] text-muted-foreground px-1 py-0.5">
                                {a.ocrInsights.slice(0, 80)}{a.ocrInsights.length > 80 ? "..." : ""}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="rounded-full border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition hover:border-primary"
                >
                  Carica altri ({filteredPosts.length - visibleCount} rimanenti)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
