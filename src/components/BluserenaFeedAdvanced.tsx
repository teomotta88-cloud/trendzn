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
  BarChart3,
  TrendingUp,
} from "lucide-react";
import type { CanaleInspo, AccountRef } from "@/lib/trends";

type SentimentFilter = "all" | "positive" | "negative" | "neutral" | "unanalyzed";
type VerificationFilter = "all" | "confirmed" | "unconfirmed";
type DateFilter = "all" | "2025" | "2026" | "2025-2026";

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
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);

  // Carica JSON runtime. Il polling ogni 30s aggiorna i post in background:
  // setLoading(true) va chiamato SOLO al primo giro, altrimenti ogni refresh
  // automatico smonta l'intera pagina (filtri compresi) sostituendola con lo
  // spinner "Caricamento feed...", perdendo scroll e dando l'impressione che
  // sia stato il click su un filtro a causare un ricaricamento.
  useEffect(() => {
    let isFirstLoad = true;
    const fetchData = async () => {
      try {
        if (isFirstLoad) setLoading(true);
        // ?t= evita la cache di qualche minuto di raw.githubusercontent.com:
        // senza, un aggiornamento del json (es. dopo un workflow) può non
        // vedersi in pagina per un po' anche ricaricando.
        const res = await fetch(`${jsonUrl}?t=${Date.now()}`);
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
        if (isFirstLoad) {
          setLoading(false);
          isFirstLoad = false;
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [jsonUrl]);

  const isInJulyAugust = (date: string | null | undefined, year: number): boolean => {
    if (!date) return false;
    const d = new Date(date);
    const month = d.getMonth() + 1;
    return d.getFullYear() === year && (month === 7 || month === 8);
  };

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

    if (dateFilter !== "all") {
      result = result.filter((p) => {
        if (dateFilter === "2025") return isInJulyAugust(p.date, 2025);
        if (dateFilter === "2026") return isInJulyAugust(p.date, 2026);
        if (dateFilter === "2025-2026") {
          return isInJulyAugust(p.date, 2025) || isInJulyAugust(p.date, 2026);
        }
        return true;
      });
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
  }, [posts, search, sentimentFilter, verificationFilter, dateFilter]);

  const stats = useMemo(() => {
    const posts2025 = posts.filter((p) => isInJulyAugust(p.date, 2025));
    const posts2026 = posts.filter((p) => isInJulyAugust(p.date, 2026));

    return {
      total2025: posts2025.length,
      total2026: posts2026.length,
      sentiment2025: posts2025.filter((p) => p.sentiment).length,
      sentiment2026: posts2026.filter((p) => p.sentiment).length,
      confirmed2025: posts2025.filter(
        (p) => (p.verificationStatus || verifyBluserenaPost(p.caption)) === "confirmed"
      ).length,
      confirmed2026: posts2026.filter(
        (p) => (p.verificationStatus || verifyBluserenaPost(p.caption)) === "confirmed"
      ).length,
      posts2025,
      posts2026,
    };
  }, [posts]);

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

      {/* Statistiche */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Luglio-Agosto 2025 */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Luglio-Agosto 2025</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Post totali</span>
                <span className="text-lg font-semibold">{stats.total2025}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Con sentiment</span>
                <span className="text-lg font-semibold text-blue-600">{stats.sentiment2025}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Confirmed</span>
                <span className="text-lg font-semibold text-green-600">
                  {stats.confirmed2025}/{stats.total2025}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Luglio-Agosto 2026 */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Luglio-Agosto 2026</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Post totali</span>
                <span className="text-lg font-semibold">{stats.total2026}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Con sentiment</span>
                <span className="text-lg font-semibold text-blue-600">{stats.sentiment2026}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Confirmed</span>
                <span className="text-lg font-semibold text-green-600">
                  {stats.confirmed2026}/{stats.total2026}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Confronto */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Confronto YoY</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. totali</span>
                <span className={`text-lg font-semibold ${stats.total2026 > stats.total2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.total2026 - stats.total2025 > 0 ? "+" : ""}{stats.total2026 - stats.total2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. sentiment</span>
                <span className={`text-lg font-semibold ${stats.sentiment2026 > stats.sentiment2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.sentiment2026 - stats.sentiment2025 > 0 ? "+" : ""}{stats.sentiment2026 - stats.sentiment2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. confirmed</span>
                <span className={`text-lg font-semibold ${stats.confirmed2026 > stats.confirmed2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.confirmed2026 - stats.confirmed2025 > 0 ? "+" : ""}{stats.confirmed2026 - stats.confirmed2025}
                </span>
              </div>
            </div>
          </div>
        </div>
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
                Periodo
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "2025", "2026", "2025-2026"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDateFilter(d)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      dateFilter === d
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {d === "all"
                      ? "Tutti"
                      : d === "2025"
                        ? "Lug-Ago 2025"
                        : d === "2026"
                          ? "Lug-Ago 2026"
                          : "Lug-Ago 25-26"}
                  </button>
                ))}
              </div>
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

      {/* AI Intelligence Section */}
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          onClick={() => setShowAIInsights(!showAIInsights)}
          className="flex items-center gap-2 text-sm font-medium w-full"
        >
          <TrendingUp className="size-4" />
          AI Intelligence {showAIInsights ? "▼" : "▶"}
        </button>

        {showAIInsights && (
          <div className="border-t border-border pt-4 mt-4 space-y-4">
            <AIInsights stats={stats} />
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

interface AIInsightsProps {
  stats: {
    posts2025: Post[];
    posts2026: Post[];
    total2025: number;
    total2026: number;
    sentiment2025: number;
    sentiment2026: number;
    confirmed2025: number;
    confirmed2026: number;
  };
}

function AIInsights({ stats }: AIInsightsProps) {
  const getTopTopics = (posts: Post[]): { topic: string; count: number }[] => {
    const topicCounts: Record<string, number> = {};
    posts.forEach((p) => {
      p.topics?.forEach((topic) => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });
    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const getSentimentBreakdown = (posts: Post[]) => {
    const positive = posts.filter((p) => p.sentiment === "positive").length;
    const negative = posts.filter((p) => p.sentiment === "negative").length;
    const neutral = posts.filter((p) => p.sentiment === "neutral").length;
    const analyzed = positive + negative + neutral;
    return { positive, negative, neutral, analyzed };
  };

  const topTopics2026 = getTopTopics(stats.posts2026);
  const sentiment2026 = getSentimentBreakdown(stats.posts2026);
  const sentiment2025 = getSentimentBreakdown(stats.posts2025);
  const avgViews2026 = stats.posts2026.length > 0
    ? Math.round(stats.posts2026.reduce((sum, p) => sum + (p.views || 0), 0) / stats.posts2026.length)
    : 0;
  const avgViews2025 = stats.posts2025.length > 0
    ? Math.round(stats.posts2025.reduce((sum, p) => sum + (p.views || 0), 0) / stats.posts2025.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Sentiment Breakdown 2026 */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Sentiment Lug-Ago 2026</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>😊 Positivi</span>
              <span className="font-semibold text-green-600">
                {sentiment2026.positive} ({Math.round((sentiment2026.positive / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😐 Neutrali</span>
              <span className="font-semibold text-slate-600">
                {sentiment2026.neutral} ({Math.round((sentiment2026.neutral / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😞 Negativi</span>
              <span className="font-semibold text-red-600">
                {sentiment2026.negative} ({Math.round((sentiment2026.negative / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
          </div>
        </div>

        {/* Confronto Sentiment */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Confronto Sentiment</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>% Analyzed 2026</span>
              <span className="font-semibold">
                {Math.round((sentiment2026.analyzed / stats.total2026) * 100) || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>% Analyzed 2025</span>
              <span className="font-semibold">
                {Math.round((sentiment2025.analyzed / stats.total2025) * 100) || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Positivi Delta</span>
              <span className={`font-semibold ${
                (sentiment2026.positive / sentiment2026.analyzed || 0) > (sentiment2025.positive / sentiment2025.analyzed || 0)
                  ? "text-green-600"
                  : "text-red-600"
              }`}>
                {Math.round(((sentiment2026.positive / sentiment2026.analyzed || 0) - (sentiment2025.positive / sentiment2025.analyzed || 0)) * 100)}pp
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Topics */}
      {topTopics2026.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Topic Top 5 (Lug-Ago 2026)</div>
          <div className="space-y-1.5">
            {topTopics2026.map((item, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">#{i + 1}</span>
                <span className="flex-1 mx-2">{item.topic}</span>
                <span className="font-semibold text-primary">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Engagement Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Avg Views 2026</div>
          <div className="text-lg font-semibold">{avgViews2026.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Avg Views 2025</div>
          <div className="text-lg font-semibold">{avgViews2025.toLocaleString()}</div>
        </div>
      </div>

      {/* Key Insights */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
        <p>
          <strong>Insight:</strong> Lug-Ago 2026 ha {stats.total2026 > stats.total2025 ? "+" : ""}{stats.total2026 - stats.total2025} post vs 2025
          {stats.confirmed2026 > stats.confirmed2025 && (
            <span>, con +{stats.confirmed2026 - stats.confirmed2025} post confermati.</span>
          )}
          {stats.sentiment2026 > stats.sentiment2025 && (
            <span> L'analisi sentiment è cresciuta di +{stats.sentiment2026 - stats.sentiment2025} post.</span>
          )}
        </p>
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
