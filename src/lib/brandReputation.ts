import { supabase } from "@/integrations/supabase/client";

export const PLATFORMS = ["twitter", "reddit", "instagram", "youtube", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Sentiment = "positive" | "negative" | "neutral";

export interface BrandMention {
  id: string;
  platform: Platform;
  external_id: string;
  url: string;
  author: string | null;
  content: string | null;
  published_at: string | null;
  keyword_matched: string;
  sentiment: Sentiment;
  category: string | null;
  engagement: number;
  reach: number | null;
  is_viral: boolean;
  created_at: string;
}

export interface BrandSentimentAlert {
  id: string;
  level: number;
  platform: Platform | null;
  reason: string;
  metrics: Record<string, number> | null;
  triggered_at: string;
  resolved_at: string | null;
}

export async function listMentions(filters: {
  platform?: Platform;
  sentiment?: Sentiment;
  sinceDays?: number;
} = {}): Promise<BrandMention[]> {
  const since = new Date();
  since.setDate(since.getDate() - (filters.sinceDays ?? 30));

  let query = supabase
    .from("brand_mentions")
    .select("*")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.sentiment) query = query.eq("sentiment", filters.sentiment);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as BrandMention[];
}

export async function listUnresolvedAlerts(): Promise<BrandSentimentAlert[]> {
  const { data, error } = await supabase
    .from("brand_sentiment_alerts")
    .select("*")
    .is("resolved_at", null)
    .order("triggered_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BrandSentimentAlert[];
}

export async function resolveAlert(id: string): Promise<void> {
  const { error } = await supabase
    .from("brand_sentiment_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export interface DailySentimentPoint {
  date: string; // YYYY-MM-DD
  positive: number;
  negative: number;
  neutral: number;
}

export function buildDailySentimentSeries(mentions: BrandMention[], days: number): DailySentimentPoint[] {
  const buckets = new Map<string, DailySentimentPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, positive: 0, negative: 0, neutral: 0 });
  }

  for (const mention of mentions) {
    const key = (mention.published_at ?? mention.created_at).slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket[mention.sentiment] += 1;
  }

  return Array.from(buckets.values());
}
