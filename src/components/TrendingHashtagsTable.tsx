import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatCompactNumber } from "@/lib/format";

type TrendingHashtagRow = {
  hashtag: string;
  rank: number | null;
  category: string[] | null;
  post_count: number | null;
  view_count: number | null;
  trend_points: number[] | null;
};

function Sparkline({ points }: { points: number[] | null }) {
  if (!points || points.length < 2) {
    return <div className="h-8 w-20 rounded bg-muted/40" aria-hidden="true" />;
  }
  const width = 80;
  const height = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - ((p - min) / range) * height).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-primary"
      aria-hidden="true"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Classifica hashtag in trend, mostrata prima del feed — stesso layout
// della pagina "Trending Hashtags" di TikTok Creative Center (rank,
// categoria, post/views, sparkline). Cliccare una riga filtra il feed
// sottostante sullo stesso hashtag.
export function TrendingHashtagsTable({
  onSelectHashtag,
}: {
  onSelectHashtag: (hashtag: string) => void;
}) {
  const [rows, setRows] = useState<TrendingHashtagRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("tiktok_trending_hashtags")
      .select("hashtag, rank, category, post_count, view_count, trend_points")
      .eq("region", "IT")
      .eq("period_days", 7)
      .order("rank", { ascending: true, nullsFirst: false })
      .limit(15)
      .then(({ data }: { data: unknown[] | null }) => {
        if (data) setRows(data as unknown as TrendingHashtagRow[]);
        setLoading(false);
      });
  }, []);

  if (loading || rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Hashtag</th>
              <th className="px-4 py-3 font-medium">Post &amp; Views</th>
              <th className="px-4 py-3 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.hashtag}
                onClick={() => onSelectHashtag(row.hashtag)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectHashtag(row.hashtag);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Filtra il feed per #${row.hashtag}`}
                className="cursor-pointer border-b border-border/60 outline-none last:border-0 transition hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <td className="px-4 py-3 font-display text-base font-semibold tabular-nums text-muted-foreground">
                  {row.rank ?? i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-foreground">#{row.hashtag}</div>
                  {row.category && row.category.length > 0 && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.category.slice(0, 2).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                  <div>
                    {formatCompactNumber(row.post_count)}{" "}
                    <span className="text-xs text-muted-foreground">Post</span>
                  </div>
                  <div>
                    {formatCompactNumber(row.view_count)}{" "}
                    <span className="text-xs text-muted-foreground">Views</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Sparkline points={row.trend_points} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
