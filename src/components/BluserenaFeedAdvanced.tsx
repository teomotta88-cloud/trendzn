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
  Zap,
  Headphones,
} from "lucide-react";
import type { CanaleInspo, AccountRef } from "@/lib/trends";

type SentimentFilter = "all" | "positive" | "negative" | "neutral" | "unanalyzed";
type VerificationFilter = "all" | "confirmed" | "unconfirmed";

interface Post extends AccountRef {
  canaleName: string;
  canaleId: string;
}

interface BluserenaFeedAdvancedProps {
  jsonUrl: string;
  tab: string;
  setTab: (tab: string) => void;
}

export function BluserenaFeedAdvanced({
  jsonUrl,
  tab,
  setTab,
}: BluserenaFeedAdvancedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Carica JSON runtime
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(jsonUrl);
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
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [jsonUrl]);

  const filteredPosts = useMemo(() => {
    let result = posts;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.caption?.toLowerCase().includes(q) ||
          p.handle?.toLowerCase().includes(q) ||
          p.canaleName.toLowerCase().includes(q),
      );
    }

    if (sentimentFilter !== "all") {
      result = result.filter((p) => {
        if (sentimentFilter === "unanalyzed") return !p.sentiment;
        return p.sentiment === sentimentFilter;
      });
    }

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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Feed Avanzato</h2>
        <button
          onClick={() => setTab("canali")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Canali
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Filter className="size-4" />
            Filtri {showFilters ? "▼" : "▶"}
          </button>
          <span className="text-xs text-muted-foreground">
            {filteredPosts.length} / {posts.length} post
          </span>
        </div>

        {showFilters && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <input
                type="text"
                placeholder="Cerca nelle caption, handle, nome canale..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPosts.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">
            Nessun post trovato
          </div>
        ) : (
          filteredPosts.map((post) => (
            <PostCard key={post.url} post={post} />
          ))
        )}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  const status = post.verificationStatus || verifyBluserenaPost(post.caption);
  const sentiment = post.sentiment;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="aspect-square bg-muted overflow-hidden">
        <SocialEmbed url={post.url} />
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <PlatformIcon platform={post.platform} className="size-3" />
            {post.platform}
          </span>
          <a href={post.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Apri ↗
          </a>
        </div>

        <div className="text-[11px] text-muted-foreground">
          <div>@{post.canaleName}</div>
          {post.date && <div>{new Date(post.date).toLocaleDateString("it-IT")}</div>}
        </div>

        {post.caption && <p className="text-[11px] line-clamp-2 text-muted-foreground">{post.caption}</p>}

        <div className="space-y-1.5 border-t border-border pt-2">
          <div className="flex items-center gap-1.5">
            <Smile className="size-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              {sentiment
                ? sentiment === "positive"
                  ? "😊 Positivo"
                  : sentiment === "negative"
                    ? "😞 Negativo"
                    : "😐 Neutrale"
                : "❓ Non analizzato"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {status === "confirmed" ? (
              <Check className="size-3 text-green-600" />
            ) : (
              <AlertCircle className="size-3 text-yellow-600" />
            )}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                status === "confirmed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              }`}
            >
              BS {status === "confirmed" ? "Confermato" : "Non confermato"}
            </span>
          </div>

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

          {post.location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="size-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{post.location}</span>
            </div>
          )}

          {post.ocrData && (
            <div className="flex items-center gap-1.5">
              <Zap className="size-3 text-amber-600 dark:text-amber-500" />
              <span className="text-[9px] text-amber-700 dark:text-amber-400">OCR</span>
            </div>
          )}

          {post.audioAnalysis && (
            <div className="flex items-center gap-1.5">
              <Headphones className="size-3 text-purple-600 dark:text-purple-500" />
              <span className="text-[9px] text-purple-700 dark:text-purple-400">Audio</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
