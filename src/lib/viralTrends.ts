import { supabase } from "@/integrations/supabase/client";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";

export const VIRAL_PLATFORMS = ["instagram", "tiktok"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];

export const DISCOVERY_SOURCES = ["tiktok-hashtag", "google-trends", "trending-audio"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export { VIRALITY_WINDOW_DAYS };

export interface ViralTrendContent {
  id: string;
  platform: ViralPlatform;
  external_id: string;
  url: string;
  author: string | null;
  content: string | null;
  published_at: string | null;
  source_hashtag: string;
  keyword_matched: string;
  discovery_source: DiscoverySource;
  topic_id: string | null;
  engagement: number;
  reach: number | null;
  delta_engagement: number;
  delta_reach: number;
  virality_score: number;
  is_viral: boolean;
  created_at: string;
}

export const SORT_OPTIONS = ["virality", "date", "engagement", "views"] as const;
export type SortBy = (typeof SORT_OPTIONS)[number];

export async function listViralTrendContent(
  filters: { platform?: ViralPlatform; sourceHashtag?: string; sortBy?: SortBy } = {},
): Promise<ViralTrendContent[]> {
  const since = new Date();
  since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // published_at manca per alcuni contenuti (fonte non l'ha fornito): in quel
  // caso si ripiega su created_at (quando NOI l'abbiamo sincronizzato per la
  // prima volta) invece di scartarlo o di lasciarlo passare sempre — un post
  // vecchio ma senza data nota non deve bypassare il filtro di recency.
  //
  // Soglia minima di engagement (1000, stessa usata da is_viral in
  // normalizeAnysiteResult) per tagliare il rumore dei match deboli su
  // Instagram — TikTok ha sempre engagement 0 (nessuna fonte gratuita per
  // like/commenti, vedi fetchTikTokContent), quindi con questo filtro sparisce
  // dal feed: non c'è modo di applicare la stessa soglia a una piattaforma
  // che non ha questo dato.
  let query = supabase
    .from("viral_trend_content")
    .select("*")
    .gt("engagement", 1000)
    .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`);

  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.sourceHashtag) query = query.eq("source_hashtag", filters.sourceHashtag);

  switch (filters.sortBy) {
    case "date":
      query = query
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    case "engagement":
      query = query.order("engagement", { ascending: false });
      break;
    case "views":
      query = query.order("reach", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("virality_score", { ascending: false });
  }

  const { data, error } = await query.limit(300);
  if (error) throw error;
  return (data ?? []) as ViralTrendContent[];
}
