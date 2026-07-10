// Tasso di crescita per hashtag TikTok / keyword Google Trends monitorati
// (monitored_topics): percentuale su una finestra fissa di 24h, valida solo
// se il delta assoluto supera una soglia minima — altrimenti il campione è
// troppo piccolo per dire qualcosa (2 contenuti -> 4 è "+100%" ma è rumore,
// non viralità). Applicata separatamente a volume contenuti ed engagement
// totale, per topic+piattaforma (un topic TikTok-hashtag può avere dati sia
// da TikTok, esatti, sia da Instagram, campionati — vedi is_volume_exact in
// topic_metrics_history).
//
// La stessa % gestisce correttamente anche l'altro estremo: un hashtag da
// 10 milioni di contenuti che ne guadagna 1000 in 24h fa 0.01%, sotto la
// soglia dell'1% che l'utente ha definito come "non in aumento" — corretto,
// non è viralità nemmeno se l'assoluto sembra grande.

export const TOPIC_GROWTH_WINDOW_HOURS = 24;

// Sotto questo delta assoluto (in entrambe le direzioni) il campione è
// troppo piccolo per fidarsi di una percentuale — vale sia per il volume
// contenuti sia per l'engagement, stessa soglia per semplicità.
const MIN_ABSOLUTE_DELTA = 20;

// Sotto questa percentuale un topic è "non in aumento" (richiesta esplicita
// dell'utente: "tasso di crescita inferiore all'1%").
export const GROWTH_THRESHOLD_PCT = 1;

export type TopicMetricsPoint = {
  content_volume: number | null;
  total_engagement: number | null;
  captured_at: string;
};

export type TopicGrowth = {
  volumeGrowthPct: number | null;
  volumeSignificant: boolean;
  engagementGrowthPct: number | null;
  engagementSignificant: boolean;
};

// null = non ancora misurabile: nessun riferimento (prima rilevazione per
// questo topic+piattaforma) o delta assoluto sotto la soglia di rumore.
function growthFor(
  current: number | null,
  reference: number | null,
): { pct: number | null; significant: boolean } {
  if (current == null || reference == null) return { pct: null, significant: false };

  const delta = current - reference;
  if (Math.abs(delta) < MIN_ABSOLUTE_DELTA) return { pct: null, significant: false };
  if (reference <= 0) return { pct: null, significant: false };

  return { pct: (delta / reference) * 100, significant: true };
}

export function computeTopicGrowth({
  currentVolume,
  currentEngagement,
  oldest,
}: {
  currentVolume: number | null;
  currentEngagement: number | null;
  oldest: TopicMetricsPoint | null;
}): TopicGrowth {
  const volume = growthFor(currentVolume, oldest?.content_volume ?? null);
  const engagement = growthFor(currentEngagement, oldest?.total_engagement ?? null);

  return {
    volumeGrowthPct: volume.pct,
    volumeSignificant: volume.significant,
    engagementGrowthPct: engagement.pct,
    engagementSignificant: engagement.significant,
  };
}

// Segnale di viralità marcata: non basta che uno dei due cresca, devono
// crescere ENTRAMBI — più contenuti pubblicati E più interazioni totali su
// quei contenuti, nella stessa finestra. Un hashtag con solo più contenuti
// (tanti post mediocri) o solo più engagement (pochi post che esplodono, ma
// il volume complessivo resta piatto) non basta: è la combinazione a essere
// un segnale forte. Pura funzione di due numeri già calcolati da
// computeTopicGrowth — nessun dato nuovo da salvare, va richiamata dove
// servono entrambi i valori (vedi TopicCard in src/routes/trend-virali.tsx).
export function isStrongGrowthSignal(
  volumeGrowthPct: number | null,
  engagementGrowthPct: number | null,
): boolean {
  return (
    volumeGrowthPct != null &&
    volumeGrowthPct >= GROWTH_THRESHOLD_PCT &&
    engagementGrowthPct != null &&
    engagementGrowthPct >= GROWTH_THRESHOLD_PCT
  );
}
