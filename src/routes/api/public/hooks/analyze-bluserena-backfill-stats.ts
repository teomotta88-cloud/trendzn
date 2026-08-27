import { createFileRoute } from "@tanstack/react-router";

const REPO = "teomotta88-cloud/trendzn";
const STORE_PATH = "src/data/bluserena-monitoring.json";

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
  estimatedApifyCost: number; // $0.005 per post
}

export const Route = createFileRoute("/api/public/hooks/analyze-bluserena-backfill-stats")({
  server: {
    handlers: {
      // Analizza bluserena-monitoring.json e ritorna statistiche di backfill
      GET: async () => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return Response.json(
            { ok: false, error: "GITHUB_TOKEN non configurato" },
            { status: 500 },
          );
        }

        try {
          const branch = "main";
          const rawUrl = `https://raw.githubusercontent.com/${REPO}/${branch}/${STORE_PATH}?t=${Date.now()}`;
          const rawRes = await fetch(rawUrl, {
            headers: { "User-Agent": "analyze-backfill-stats" },
          });

          if (!rawRes.ok) {
            return Response.json(
              { ok: false, error: `Lettura fallita: ${rawRes.status}` },
              { status: 500 },
            );
          }

          const raw = await rawRes.text();
          const store = raw.trim() ? JSON.parse(raw) : { canali: [] };

          // Calcola statistiche
          const stats: BackfillStats = {
            totalPosts: 0,
            postsByPlatform: {},
            postsByHashtag: {},
            dateRange: { earliest: null, latest: null },
            engagementStats: {
              totalViews: 0,
              totalLikes: 0,
              totalComments: 0,
              totalShares: 0,
              avgEngagementPerPost: 0,
            },
            analysisStats: {
              postsWithSentiment: 0,
              postsWithTopics: 0,
              postsWithLocation: 0,
              sentimentDistribution: {
                positive: 0,
                negative: 0,
                neutral: 0,
              },
            },
            estimatedApifyCost: 0,
          };

          const dates: string[] = [];

          for (const canale of store.canali || []) {
            // Track hashtag
            stats.postsByHashtag[canale.name] = (stats.postsByHashtag[canale.name] || 0) + 1;

            for (const account of canale.accounts || []) {
              stats.totalPosts++;

              // Platform count
              stats.postsByPlatform[account.platform || "unknown"] =
                (stats.postsByPlatform[account.platform || "unknown"] || 0) + 1;

              // Date range
              if (account.date) {
                dates.push(account.date);
              }

              // Engagement
              if (account.views != null) stats.engagementStats.totalViews += account.views;
              if (account.likes != null) stats.engagementStats.totalLikes += account.likes;
              if (account.comments != null) stats.engagementStats.totalComments += account.comments;
              if (account.shares != null) stats.engagementStats.totalShares += account.shares;

              // Analysis stats
              if (account.sentiment) {
                stats.analysisStats.postsWithSentiment++;
                stats.analysisStats.sentimentDistribution[
                  account.sentiment as keyof typeof stats.analysisStats.sentimentDistribution
                ]++;
              }
              if (account.topics && Array.isArray(account.topics) && account.topics.length > 0) {
                stats.analysisStats.postsWithTopics++;
              }
              if (account.location) {
                stats.analysisStats.postsWithLocation++;
              }
            }
          }

          // Calculate derived stats
          if (dates.length > 0) {
            dates.sort();
            stats.dateRange.earliest = dates[0];
            stats.dateRange.latest = dates[dates.length - 1];
          }

          if (stats.totalPosts > 0) {
            const totalEngagement =
              stats.engagementStats.totalViews +
              stats.engagementStats.totalLikes +
              stats.engagementStats.totalComments +
              stats.engagementStats.totalShares;
            stats.engagementStats.avgEngagementPerPost = totalEngagement / stats.totalPosts;
          }

          // Estimate Apify cost ($0.005 per post, TikTok only)
          const tikTokPostCount = stats.postsByPlatform["tiktok"] || 0;
          stats.estimatedApifyCost = tikTokPostCount * 0.005;

          return Response.json({ ok: true, stats });
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
