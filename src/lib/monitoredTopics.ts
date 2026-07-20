// Elenco degli hashtag TikTok / keyword Google Trends monitorati, con
// volume attuale e tasso di crescita — per il toggle in cima a
// /trend-virali (Fase 8). Letto da un endpoint pubblico invece che
// direttamente da Supabase (come viralTrends.ts) perché monitored_topics
// contiene anche il valore grezzo usato internamente dalla pipeline
// (derived_hashtag/derived_keyword): tenerlo dietro un endpoint dedicato
// lascia libertà di cambiare forma senza toccare il client.

import type { Acceleration } from "@/lib/topicAcceleration";

export const MONITORED_TOPIC_TYPES = [
  "tiktok-hashtag",
  "google-trends",
  "trending-audio",
  "x-trending",
  "reddit-trending",
  "youtube-trending",
] as const;
export type MonitoredTopicType = (typeof MONITORED_TOPIC_TYPES)[number];

export const SIGNAL_PLATFORMS = ["tiktok", "instagram", "reddit", "youtube", "google-trends"] as const;
export type SignalPlatform = (typeof SIGNAL_PLATFORMS)[number];

export const SIGNAL_PLATFORM_LABEL: Record<SignalPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  reddit: "Reddit",
  youtube: "YouTube",
  "google-trends": "Google Trends",
};

// Un segnale di crescita per (topic, piattaforma) — Fase 2. TikTok riporta un
// conteggio reale sull'intero hashtag (is_volume_exact=true, "esatto");
// Instagram solo un campione della pagina hashtag (false, "campione").
export interface TopicPlatformSignal {
  platform: SignalPlatform;
  volume_growth_pct: number | null;
  engagement_growth_pct: number | null;
  latest_content_volume: number | null;
  latest_total_engagement: number | null;
  is_volume_exact: boolean;
  computed_at: string;
}

// Confidenza del segnale, derivata da is_volume_exact alla fonte (vedi
// topic_signals / topic_metrics_history): un volume esatto e uno campionato
// non vanno letti con lo stesso peso.
export function signalConfidence(signal: TopicPlatformSignal): "exact" | "sampled" {
  return signal.is_volume_exact ? "exact" : "sampled";
}

export interface MonitoredTopic {
  id: string;
  topic_type: MonitoredTopicType;
  value: string;
  derived_hashtag: string | null;
  derived_keyword: string | null;
  // Categoria mostrata da X accanto al trend (es. "Politics") — solo per
  // topic_type='x-trending', sempre null per le altre fonti.
  category: string | null;
  last_seen_in_top5_at: string;
  // Fase 2: 0-2 righe (TikTok e/o Instagram), niente più valore singolo che
  // le due piattaforme si sovrascrivevano a vicenda.
  signals: TopicPlatformSignal[];
  // Fase E: una riga per piattaforma con almeno due letture di crescita
  // successive (vedi src/lib/topicAcceleration.ts) — vuoto finché non c'è
  // ancora abbastanza storico. La corroborazione cross-fonte (stesso
  // fenomeno raccontato da più fonti) vive in cross_source_trends
  // (src/lib/crossSourceTrends.ts), calcolata via matching semantico LLM,
  // non qui.
  acceleration: Acceleration[];
}

export async function listMonitoredTopics(): Promise<MonitoredTopic[]> {
  const res = await fetch("/api/public/hooks/list-monitored-topics");
  if (!res.ok) throw new Error(`list-monitored-topics failed (${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "list-monitored-topics error");
  return data.topics ?? [];
}

// sync-viral-trends.yml gira ogni 6h: un topic davvero ancora in classifica
// ha last_seen_in_top5_at aggiornato all'ultimo giro (vedi monitor-topics.ts).
// Oltre questa soglia (6h + margine per ritardi/durata del run) vuol dire che
// è uscito dai top-N e sta solo scontando il periodo di grazia di 24h
// (monitored_topics.monitoring_stops_at) — resta 'active' e continua a
// essere monitorato in background (volumi/engagement), ma non va più
// mostrato come "in classifica" in /trend-virali (richiesta esplicita).
const TOP5_FRESHNESS_HOURS = 7;

export function isCurrentlyRanked(topic: Pick<MonitoredTopic, "last_seen_in_top5_at">): boolean {
  const ageMs = Date.now() - new Date(topic.last_seen_in_top5_at).getTime();
  return ageMs <= TOP5_FRESHNESS_HOURS * 60 * 60 * 1000;
}
