import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, DollarSign, Calendar, Database } from "lucide-react";

interface BackfillStats {
  totalPosts: number;
  postsByPlatform: Record<string, number>;
  postsByHashtag: Record<string, number>;
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  engagementStats: {
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    avgEngagementPerPost: number;
  };
  analysisStats: {
    postsWithSentiment: number;
    postsWithTopics: number;
    postsWithLocation: number;
    sentimentDistribution: {
      positive: number;
      negative: number;
      neutral: number;
    };
  };
  estimatedApifyCost: number;
}

export function BluserenaBackfillStats() {
  const [stats, setStats] = useState<BackfillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/public/hooks/analyze-bluserena-backfill-stats");
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (data.ok && data.stats) {
          setStats(data.stats);
        } else {
          throw new Error(data.error || "Errore sconosciuto");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore");
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">Caricamento statistiche backfill...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
        <p className="text-sm text-destructive">{error || "Impossibile caricare le statistiche"}</p>
      </div>
    );
  }

  const platformData = Object.entries(stats.postsByPlatform).map(([platform, count]) => ({
    platform,
    count,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="font-display text-lg font-semibold">Statistiche Backfill</h3>
        <p className="text-sm text-muted-foreground">
          Analisi del contenuto sincronizzato in Bluserena-monitoring
        </p>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">Total Posts</span>
          </div>
          <div className="mt-1 text-xl font-bold">{stats.totalPosts}</div>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-blue-500" />
            <span className="text-xs font-medium text-muted-foreground">Periodo</span>
          </div>
          <div className="mt-1 text-xs font-semibold">
            {stats.dateRange.earliest
              ? `${new Date(stats.dateRange.earliest).toLocaleDateString("it-IT")} a ${
                  stats.dateRange.latest ? new Date(stats.dateRange.latest).toLocaleDateString("it-IT") : ""
                }`
              : "—"}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-green-500" />
            <span className="text-xs font-medium text-muted-foreground">Engagement medio</span>
          </div>
          <div className="mt-1 text-xl font-bold">
            {Math.round(stats.engagementStats.avgEngagementPerPost).toLocaleString("it-IT")}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-yellow-500" />
            <span className="text-xs font-medium text-muted-foreground">Costo Apify stimato</span>
          </div>
          <div className="mt-1 text-xl font-bold">${stats.estimatedApifyCost.toFixed(2)}</div>
        </div>
      </div>

      {/* Platform distribution */}
      {platformData.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-3">Post per Piattaforma</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={platformData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Analysis coverage */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-semibold mb-3">Copertura Analisi AI</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Con Sentiment</div>
            <div className="text-sm font-bold text-green-600 dark:text-green-400">
              {stats.analysisStats.postsWithSentiment} ({Math.round((stats.analysisStats.postsWithSentiment / stats.totalPosts) * 100)}%)
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Con Topic</div>
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {stats.analysisStats.postsWithTopics} ({Math.round((stats.analysisStats.postsWithTopics / stats.totalPosts) * 100)}%)
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Con Location</div>
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400">
              {stats.analysisStats.postsWithLocation} ({Math.round((stats.analysisStats.postsWithLocation / stats.totalPosts) * 100)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Detailed engagement */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-semibold mb-3">Engagement Totale</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Views</div>
            <div className="text-lg font-bold">{stats.engagementStats.totalViews.toLocaleString("it-IT")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Likes</div>
            <div className="text-lg font-bold text-red-500">{stats.engagementStats.totalLikes.toLocaleString("it-IT")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Comments</div>
            <div className="text-lg font-bold text-blue-500">{stats.engagementStats.totalComments.toLocaleString("it-IT")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Shares</div>
            <div className="text-lg font-bold text-green-500">{stats.engagementStats.totalShares.toLocaleString("it-IT")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
