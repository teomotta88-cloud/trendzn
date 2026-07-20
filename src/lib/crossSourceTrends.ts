// Gruppi di trend condivisi da più fonti indipendenti (TikTok/Google
// Trends/X trending + Canali Inspo), calcolati da
// scripts/match-cross-source-trends.mjs — alimentano la tab "Trendzning Now"
// di /trend-virali. Vedi supabase/migrations/20260720100000_cross_source_trends.sql.

export const CROSS_SOURCE_TIERS = ["hot", "spicy", "super_spicy"] as const;
export type CrossSourceTier = (typeof CROSS_SOURCE_TIERS)[number];

export const TIER_LABEL: Record<CrossSourceTier, string> = {
  hot: "Hot",
  spicy: "Spicy",
  super_spicy: "Super Spicy",
};

export const TIER_CHILI_COUNT: Record<CrossSourceTier, number> = {
  hot: 1,
  spicy: 2,
  super_spicy: 3,
};

export interface CrossSourceTrend {
  id: string;
  label: string;
  source_count: number;
  tier: CrossSourceTier | null;
  sources: string[];
  topic_ids: string[];
  canali_inspo_topic: string | null;
  computed_at: string;
}

export async function listCrossSourceTrends(): Promise<CrossSourceTrend[]> {
  const res = await fetch("/api/public/hooks/list-cross-source-trends");
  if (!res.ok) throw new Error(`list-cross-source-trends failed (${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "list-cross-source-trends error");
  return data.trends ?? [];
}
