// Elenco degli hashtag TikTok / keyword Google Trends monitorati, con
// volume attuale e tasso di crescita — per il toggle in cima a
// /trend-virali (Fase 8). Letto da un endpoint pubblico invece che
// direttamente da Supabase (come viralTrends.ts) perché monitored_topics
// contiene anche il valore grezzo usato internamente dalla pipeline
// (derived_hashtag/derived_keyword): tenerlo dietro un endpoint dedicato
// lascia libertà di cambiare forma senza toccare il client.

export const MONITORED_TOPIC_TYPES = ["tiktok-hashtag", "google-trends", "trending-audio"] as const;
export type MonitoredTopicType = (typeof MONITORED_TOPIC_TYPES)[number];

export interface MonitoredTopic {
  id: string;
  topic_type: MonitoredTopicType;
  value: string;
  derived_hashtag: string | null;
  derived_keyword: string | null;
  volume_growth_pct: number | null;
  engagement_growth_pct: number | null;
  growth_platform: "tiktok" | "instagram" | null;
  growth_computed_at: string | null;
  latest_content_volume: number | null;
  latest_total_engagement: number | null;
  latest_is_volume_exact: boolean;
}

export async function listMonitoredTopics(): Promise<MonitoredTopic[]> {
  const res = await fetch("/api/public/hooks/list-monitored-topics");
  if (!res.ok) throw new Error(`list-monitored-topics failed (${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "list-monitored-topics error");
  return data.topics ?? [];
}
