import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { detectPlatform, type CanaleInspo } from "@/lib/trends";
import { SocialEmbed, PlatformIcon } from "@/components/SocialEmbed";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";

export const Route = createFileRoute("/canali-inspo/$id")({
  head: () => ({
    meta: [{ title: "Canale — Inspo" }, { name: "description", content: "Canale di ispirazione social." }],
  }),
  component: Page,
});

const TRENDS_JSON_URL = "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

const POST_URL_RE = /\/(p|reel|reels|video|photo|watch|tv)\//i;

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
  const [canale, setCanale] = useState<CanaleInspo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((res) => {
        const decoded = JSON.parse(atob(res.content.replace(/\n/g, "")));
        const found = (decoded.canali_inspo as CanaleInspo[]).find((c) => c.id === id);
        if (!found) {
          setError("Canale non trovato");
        } else {
          setCanale(found);
        }
      })
      .catch(() => setError("Impossibile caricare il canale."))
      .finally(() => setLoading(false));
  }, [id]);

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
    if (!search) return allPosts;
    const q = search.toLowerCase();
    return allPosts.filter((a) => a.caption?.toLowerCase().includes(q) || a.handle?.toLowerCase().includes(q));
  }, [allPosts, search]);

  // Reset paginazione quando cambia la ricerca
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const profileLinks = useMemo(() => (canale ? canale.accounts.filter((a) => !POST_URL_RE.test(a.url)) : []), [canale]);

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Caricamento…</div>;
  }

  if (error || !canale) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Canale non trovato</h1>
        <Link to="/canali-inspo" className="mt-4 inline-block text-primary">
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
        to="/canali-inspo"
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
          <h1 className="font-display text-3xl font-bold sm:text-4xl">@{canale.name}</h1>
          {canale.descrizione && <p className="text-sm text-muted-foreground sm:text-base">{canale.descrizione}</p>}
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

        {allPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nessun post embeddabile per questo canale.
              <br />
              Aggiungi URL di singoli post nel file Excel (colonna LINK) per vederli qui.
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
                  Apri profilo {a.platform}
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
                return (
                  <article key={i} className="space-y-2 rounded-2xl border border-border bg-card p-3">
                    <SocialEmbed url={a.url} />
                    <div className="flex items-center justify-between px-1 text-xs">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <PlatformIcon platform={detectPlatform(a.url)} className="size-3" />
                        {detectPlatform(a.url)}
                      </span>
                      {dateLabel && <span className="text-muted-foreground">{dateLabel}</span>}
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Apri ↗
                      </a>
                    </div>
                    {a.caption && (
                      <p className="line-clamp-3 px-1 pb-1 text-[11px] leading-relaxed text-muted-foreground">
                        {a.caption}
                      </p>
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
