import { supabase } from "@/integrations/supabase/client";

export const VIRAL_PLATFORMS = ["instagram", "tiktok"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];

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
  engagement: number;
  reach: number | null;
  is_viral: boolean;
  created_at: string;
}

export async function listViralTrendContent(
  filters: { platform?: ViralPlatform; sourceHashtag?: string; sinceDays?: number } = {},
): Promise<ViralTrendContent[]> {
  const since = new Date();
  since.setDate(since.getDate() - (filters.sinceDays ?? 14));

  let query = supabase
    .from("viral_trend_content")
    .select("*")
    .gte("created_at", since.toISOString())
    .order("reach", { ascending: false, nullsFirst: false })
    .order("engagement", { ascending: false })
    .limit(300);

  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.sourceHashtag) query = query.eq("source_hashtag", filters.sourceHashtag);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ViralTrendContent[];
}
