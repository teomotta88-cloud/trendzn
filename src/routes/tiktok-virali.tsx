import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SocialEmbed } from "@/components/SocialEmbed";
import { formatCompactNumber } from "@/lib/format";
import { Search, Eye } from "lucide-react";

export const Route = createFileRoute("/tiktok-virali")({
  head: () => ({
    meta: [
      { title: "TikTok Virali — TRENDZN" },
      {
        name: "description",
        content: "Contenuti TikTok dei canali monitorati ordinati per numero di view reali.",
      },
    ],
  }),
  component: Page,
});

const TRENDS_JSON_URL =
  "https://raw.githubusercontent.com/teomatta88-cloud/trendzn/main/src/data/trends.json";

const POST_URL_RE = /\/(video)\//i;

type AccountRef = {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
  views?: number | null;
};
type Canale = { id: string; name: string; cliente?: string | null; accounts: AccountRef[] };

type Post = {
  url: string;
  handle: string;
  canale: string;
  cliente: string | null;
  date: string | null;
  caption: string | null;
  views: number | null;
};

function formatDate(dateStr: string | null): string {
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

function flattenTikTokPosts(lists: Canale[][]): Post[] {
  const posts: Post[] = [];
  for (const list of lists) {
    for (const canale of list) {
      for (const a of canale.accounts) {
        if (a.platform !== "tiktok" || !POST_URL_RE.test(a.url)) continue;
        posts.push({
          url: a.url,
          handle: a.handle,
          canale: canale.name,
          cliente: canale.cliente ?? null,
          date: a.date ?? null,
          caption: a.caption ?? null,
          views: a.views ?? null,
        });
      }
    }
  }
  // Dedup per URL (uno stesso canale può comparire in più liste)
  const seen = new Set<string>();
  return posts.filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)));
}

function Page() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyWithViews, setOnlyWithViews] = useState(true);

  useEffect(() => {
    fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((decoded) => {
        const lists: Canale[][] = [
          decoded.canali_inspo ?? [],
          decoded.influencer_profiles ?? [],
          decoded.canali_cliente ?? [],
        ];
        setPosts(flattenTikTokPosts(lists));
      })
      .catch((e) => console.error("Errore caricamento trends.json:", e))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    let result = posts;
    if (onlyWithViews) result = result.filter((p) => p.views != null);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.handle.toLowerCase().includes(q) ||
          p.canale.toLowerCase().includes(q) ||
          p.cliente?.toLowerCase().includes(q) ||
          p.caption?.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  }, [posts, search, onlyWithViews]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">TikTok Virali</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Video TikTok dei canali monitorati (Canali Inspo, Influencer, Canali Cliente), ordinati
          per numero di view reali — non legati a nessun hashtag. Instagram non è incluso: non
          espone metriche di engagement tramite la nostra fonte gratuita.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per canale, cliente, handle o caption…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyWithViews}
            onChange={(e) => setOnlyWithViews(e.target.checked)}
            className="size-3.5 rounded border-border"
          />
          Solo con view disponibili
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{sorted.length} video</span>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun video TikTok con dati di view ancora. Il sync automatico dei canali monitorati
          popolerà questa pagina appena disponibile.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((p) => (
            <article key={p.url} className="space-y-2 rounded-2xl border border-border bg-card p-3">
              <div className="relative">
                <SocialEmbed url={p.url} />
                {p.views != null && (
                  <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow">
                    <Eye className="size-3" />
                    {formatCompactNumber(p.views)}
                  </span>
                )}
              </div>
              <div className="space-y-1 px-1 pb-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">@{p.handle}</span>
                  {formatDate(p.date) && (
                    <span className="text-muted-foreground">{formatDate(p.date)}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {p.canale}
                  </span>
                  {p.cliente && (
                    <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {p.cliente}
                    </span>
                  )}
                </div>
                {p.caption && (
                  <p className="line-clamp-2 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {p.caption}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
