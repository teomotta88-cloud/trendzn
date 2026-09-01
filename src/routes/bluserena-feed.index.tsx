import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PlatformIcon, SocialEmbed } from "@/components/SocialEmbed";
import { verifyBluserenaPost, type VerificationStatus, type Sentiment } from "@/lib/trends";
import {
  Search,
  Filter,
  Check,
  AlertCircle,
  Smile,
  Tag as TagIcon,
  MapPin,
  X,
} from "lucide-react";
import type { CanaleInspo, AccountRef } from "@/lib/trends";

export const Route = createFileRoute("/bluserena-feed/")({
  head: () => ({
    meta: [
      { title: "Bluserena Feed — Advanced" },
      { name: "description", content: "Feed con filtri avanzati e tag editabili" },
    ],
  }),
  component: BluserenaFeedPage,
});

const BLUSERENA_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/bluserena-monitoring.json";

type SentimentFilter = "all" | "positive" | "negative" | "neutral" | "unanalyzed";
type VerificationFilter = "all" | "confirmed" | "unconfirmed";

interface Post extends AccountRef {
  canaleName: string;
  canaleId: string;
}

function BluserenaFeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [editingPostUrl, setEditingPostUrl] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Carica JSON runtime. Il polling ogni 30s aggiorna i post in background:
  // setLoading(true) va chiamato SOLO al primo giro, altrimenti ogni refresh
  // automatico smonta l'intera pagina (filtri compresi) sostituendola con lo
  // spinner di caricamento, perdendo scroll e dando l'impressione che sia
  // stato il click su un filtro a causare un ricaricamento.
  useEffect(() => {
    let isFirstLoad = true;
    const fetchData = async () => {
      try {
        if (isFirstLoad) setLoading(true);
        // ?t= evita la cache di qualche minuto di raw.githubusercontent.com:
        // senza, un aggiornamento del json (es. dopo un workflow) può non
        // vedersi in pagina per un po' anche ricaricando.
        const res = await fetch(`${BLUSERENA_JSON_URL}?t=${Date.now()}`);
        if (!res.ok) throw new Error(`Errore ${res.status}`);
        const data = (await res.json()) as { canali: CanaleInspo[] };

        const allPosts: Post[] = [];
        for (const canale of data.canali) {
          for (const account of canale.accounts || []) {
            if (/\/(p|reel|reels|video|photo|watch|tv|status)\//i.test(account.url)) {
              allPosts.push({
                ...account,
                canaleName: canale.name,
                canaleId: canale.id,
              });
            }
          }
        }

        // Ordina per data (più recenti prima)
        allPosts.sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });

        setPosts(allPosts);
        setError(null);
      } catch (err) {
        setError(String(err));
      } finally {
        if (isFirstLoad) {
          setLoading(false);
          isFirstLoad = false;
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Ricarica ogni 30s
    return () => clearInterval(interval);
  }, []);

  // Filtra post
  const filteredPosts = useMemo(() => {
    let result = posts;

    // Filtro search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.caption?.toLowerCase().includes(q) ||
          p.handle?.toLowerCase().includes(q) ||
          p.canaleName.toLowerCase().includes(q),
      );
    }

    // Filtro sentiment
    if (sentimentFilter !== "all") {
      result = result.filter((p) => {
        const sentiment = p.sentiment || (verifyBluserenaPost(p.caption) === "confirmed" ? null : null);
        if (sentimentFilter === "unanalyzed") return !p.sentiment;
        return p.sentiment === sentimentFilter;
      });
    }

    // Filtro verification
    if (verificationFilter !== "all") {
      result = result.filter((p) => {
        const status = p.verificationStatus || verifyBluserenaPost(p.caption);
        return status === verificationFilter;
      });
    }

    return result;
  }, [posts, search, sentimentFilter, verificationFilter]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Caricamento feed...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Errore: {error}</div>;
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="space-y-4">
        <h1 className="font-display text-3xl font-bold">Bluserena Feed</h1>
        <p className="text-muted-foreground">
          {filteredPosts.length} / {posts.length} post
        </p>
      </header>

      {/* Filtri */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Filter className="size-4" />
            Filtri {showFilters ? "▼" : "▶"}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-4 border-t border-border pt-4">
            {/* Search */}
            <div>
              <input
                type="text"
                placeholder="Cerca nelle caption, handle, nome canale..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Sentiment */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Sentiment
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "positive", "negative", "neutral", "unanalyzed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSentimentFilter(s)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      sentimentFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {s === "all"
                      ? "Tutti"
                      : s === "positive"
                        ? "😊 Positivi"
                        : s === "negative"
                          ? "😞 Negativi"
                          : s === "neutral"
                            ? "😐 Neutrali"
                            : "❓ Non analizzati"}
                  </button>
                ))}
              </div>
            </div>

            {/* Verification */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                BS Verification
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "confirmed", "unconfirmed"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVerificationFilter(v)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      verificationFilter === v
                        ? v === "confirmed"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : v === "unconfirmed"
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {v === "all" ? (
                      "Tutti"
                    ) : v === "confirmed" ? (
                      <>
                        <Check className="size-3" /> Confermati
                      </>
                    ) : (
                      <>
                        <AlertCircle className="size-3" /> Non confermati
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Posts Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPosts.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">
            Nessun post trovato
          </div>
        ) : (
          filteredPosts.map((post) => (
            <PostCard
              key={post.url}
              post={post}
              isEditing={editingPostUrl === post.url}
              onEditToggle={() =>
                setEditingPostUrl(editingPostUrl === post.url ? null : post.url)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function PostCard({
  post,
  isEditing,
  onEditToggle,
}: {
  post: Post;
  isEditing: boolean;
  onEditToggle: () => void;
}) {
  const status = post.verificationStatus || verifyBluserenaPost(post.caption);
  const sentiment = post.sentiment;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Embed */}
      <div className="aspect-square bg-muted overflow-hidden">
        <SocialEmbed url={post.url} />
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <PlatformIcon platform={post.platform} className="size-3" />
            {post.platform}
          </span>
          <a href={post.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Apri ↗
          </a>
        </div>

        {/* Canale + Date */}
        <div className="text-[11px] text-muted-foreground">
          <div>@{post.canaleName}</div>
          {post.date && <div>{new Date(post.date).toLocaleDateString("it-IT")}</div>}
        </div>

        {/* Caption */}
        {post.caption && <p className="text-[11px] line-clamp-2 text-muted-foreground">{post.caption}</p>}

        {/* Tags Section */}
        <div className="space-y-1.5 border-t border-border pt-2">
          {/* Sentiment Badge */}
          <div className="flex items-center gap-1.5">
            <Smile className="size-3 text-muted-foreground" />
            {isEditing ? (
              <select
                value={sentiment || ""}
                onChange={(e) => {}}
                className="text-[10px] rounded px-1 py-0.5 bg-muted"
              >
                <option value="">Non analizzato</option>
                <option value="positive">😊 Positivo</option>
                <option value="negative">😞 Negativo</option>
                <option value="neutral">😐 Neutrale</option>
              </select>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {sentiment
                  ? sentiment === "positive"
                    ? "😊 Positivo"
                    : sentiment === "negative"
                      ? "😞 Negativo"
                      : "😐 Neutrale"
                  : "❓ Non analizzato"}
              </span>
            )}
          </div>

          {/* Verification Badge */}
          <div className="flex items-center gap-1.5">
            {status === "confirmed" ? (
              <Check className="size-3 text-green-600" />
            ) : (
              <AlertCircle className="size-3 text-yellow-600" />
            )}
            <button
              onClick={onEditToggle}
              className={`text-[10px] px-1.5 py-0.5 rounded-full cursor-pointer ${
                status === "confirmed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              }`}
            >
              BS {status === "confirmed" ? "Confirmed" : "Unconfirmed"}
            </button>
          </div>

          {/* Topics */}
          {post.topics && post.topics.length > 0 && (
            <div className="flex items-start gap-1.5">
              <TagIcon className="size-3 text-muted-foreground mt-0.5" />
              <div className="flex flex-wrap gap-1">
                {post.topics.slice(0, 3).map((topic, i) => (
                  <span
                    key={i}
                    className="inline-block text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full"
                  >
                    {topic}
                  </span>
                ))}
                {post.topics.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">+{post.topics.length - 3}</span>
                )}
              </div>
            </div>
          )}

          {/* Location */}
          {post.location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="size-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{post.location}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
