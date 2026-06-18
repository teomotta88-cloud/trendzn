import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { detectPlatform } from "@/lib/trends";
import { SocialEmbed, PlatformIcon } from "@/components/SocialEmbed";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";

export const Route = createFileRoute("/influencer/$id")({
  head: () => ({
    meta: [{ title: "Influencer — Trendzn" }, { name: "description", content: "Profilo influencer monitorato." }],
  }),
  component: Page,
});

const TRENDS_JSON_URL = "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

const POST_URL_RE = /\/(p|reel|reels|video|photo|watch|tv)\//i;

type AccountRef = { platform: string; handle: string; url: string; date?: string | null; caption?: string | null };
type InfluencerProfile = {
  id: string;
  name: string;
  cliente: string | null;
  urls: string[];
  descrizione: string | null;
  accounts: AccountRef[];
};

type DatePreset = "tutto" | "7g" | "30g" | "90g" | "custom";

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

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-foreground text-background"
          : "border border-border bg-background/50 text-muted-foreground hover:border-primary"
      }`}
    >
      {label}
    </button>
  );
}

function DateRangeFilter({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
}: {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
}) {
  const presets: { key: DatePreset; label: string }[] = [
    { key: "tutto", label: "Tutto" },
    { key: "7g", label: "Ultima settimana" },
    { key: "30g", label: "Ultimo mese" },
    { key: "90g", label: "Ultimi 3 mesi" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <FilterPill key={p.key} label={p.label} active={preset === p.key} onClick={() => setPreset(p.key)} />
      ))}
      <FilterPill label="Personalizzato" active={preset === "custom"} onClick={() => setPreset("custom")} />
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 9;

function Page() {
  const { id } = Route.useParams();
  const [profile, setProfile] = useState<InfluencerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");

  const [datePreset, setDatePreset] = useState<DatePreset>("tutto");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((res) => {
        const decoded = JSON.parse(atob(res.content.replace(/\n/g, "")));
        const found = (decoded.influencer_profiles as InfluencerProfile[] | undefined)?.find((c) => c.id === id);
        if (!found) {
          setError("Profilo non trovato");
        } else {
          setProfile(found);
        }
      })
      .catch(() => setError("Impossibile caricare il profilo."))
      .finally(() => setLoading(false));
  }, [id]);

  const allPosts = useMemo(() => {
    if (!profile) return [];
    const posts = profile.accounts.filter((a) => POST_URL_RE.test(a.url));
    return [...posts].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }, [profile]);

  const dateRange = useMemo(() => {
    const now = new Date();
    if (datePreset === "tutto") return null;
    if (datePreset === "custom") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo + "T23:59:59") : null;
      if (!from && !to) return null;
      return { from, to };
    }
    const days = datePreset === "7g" ? 7 : datePreset === "30g" ? 30 : 90;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from, to: now };
  }, [datePreset, customFrom, customTo]);

  const filteredPosts = useMemo(() => {
    let result = allPosts;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.caption?.toLowerCase().includes(q) || a.handle?.toLowerCase().includes(q));
    }

    if (dateRange) {
      result = result.filter((a) => {
        if (!a.date) return false;
        const d = new Date(a.date);
        if (dateRange.from && d < dateRange.from) return false;
        if (dateRange.to && d > dateRange.to) return false;
        return true;
      });
    }

    return result;
  }, [allPosts, search, dateRange]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, datePreset, customFrom, customTo]);

  const profileLinks = useMemo(
    () => (profile ? profile.accounts.filter((a) => !POST_URL_RE.test(a.url)) : []),
    [profile],
  );

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Caricamento…</div>;
  }

  if (error || !profile) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Profilo non trovato</h1>
        <Link to="/influencer" className="mt-4 inline-block text-primary">
          Torna agli influencer
        </Link>
      </div>
    );
  }

  const initial =
    profile.name
      .replace(/[^a-zA-Z0-9]/g, "")
      .charAt(0)
      .toUpperCase() || "•";
  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  return (
    <div className="space-y-8">
      <Link
        to="/influencer"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Tutti gli influencer
      </Link>

      <header className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-gradient-to-br from-card to-secondary/40 p-8 sm:flex-row sm:items-start sm:gap-8">
        <div className="relative flex aspect-square w-32 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10">
          <div className="flex size-[88%] items-center justify-center rounded-full bg-card font-display text-5xl font-bold">
            {initial}
          </div>
        </div>
        <div className="flex-1 space-y-3 text-center sm:text-left">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">@{profile.name}</h1>
          {profile.cliente && (
            <span className="inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
              Cliente: {profile.cliente}
            </span>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {profile.accounts.map((a, i) => (
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
                  className="w-56 rounded-lg border border-border bg-background/60 py-1.5 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.min(visibleCount, filteredPosts.length)} / {filteredPosts.length}
              </span>
            </div>
          )}
        </div>

        {allPosts.length > 0 && (
          <DateRangeFilter
            preset={datePreset}
            setPreset={setDatePreset}
            customFrom={customFrom}
            setCustomFrom={setCustomFrom}
            customTo={customTo}
            setCustomTo={setCustomTo}
          />
        )}

        {allPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nessun post embeddabile per questo profilo ancora.
              <br />
              Il sync automatico aggiungerà qui i nuovi post non appena disponibili.
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
            Nessun post corrisponde ai filtri selezionati.
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
