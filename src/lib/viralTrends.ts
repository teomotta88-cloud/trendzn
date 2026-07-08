import { supabase } from "@/integrations/supabase/client";

export const VIRAL_PLATFORMS = ["instagram", "tiktok"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];

export const DISCOVERY_SOURCES = ["tiktok-hashtag", "google-trends"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

// Finestra sempre fissa a 7 giorni, non configurabile: sia per l'eleggibilità
// del contenuto nel feed (published_at qui sotto) sia per il calcolo della
// variazione a monte (delta_reach/delta_engagement, vedi
// sync-viral-trends.ts) — cambiare l'uno senza l'altro renderebbe il
// punteggio di viralità incoerente con quello che l'utente vede filtrato.
export const VIRALITY_WINDOW_DAYS = 7;

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
  engagement: number;
  reach: number | null;
  delta_engagement: number;
  delta_reach: number;
  virality_score: number;
  is_viral: boolean;
  created_at: string;
}

export async function listViralTrendContent(
  filters: { platform?: ViralPlatform; sourceHashtag?: string } = {},
): Promise<ViralTrendContent[]> {
  const since = new Date();
  since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // published_at manca per alcuni contenuti (fonte non l'ha fornito): in quel
  // caso si ripiega su created_at (quando NOI l'abbiamo sincronizzato per la
  // prima volta) invece di scartarlo o di lasciarlo passare sempre — un post
  // vecchio ma senza data nota non deve bypassare il filtro di recency.
  let query = supabase
    .from("viral_trend_content")
    .select("*")
    .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`)
    .order("virality_score", { ascending: false })
    .limit(300);

  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.sourceHashtag) query = query.eq("source_hashtag", filters.sourceHashtag);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ViralTrendContent[];
}
