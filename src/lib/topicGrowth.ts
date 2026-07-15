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

// Fase 3 — il tasso è normalizzato nel tempo. Prima si confrontava col
// riferimento "più vecchio ENTRO 24h", ma la distanza reale variava (6h..24h a
// seconda della cadenza e dei run saltati): +1% su 6h e +1% su 24h sono tassi
// diversissimi trattati identici. Ora il delta osservato viene proiettato a un
// tasso su finestra fissa di 24h (delta / ore_trascorse × 24), così due topic
// campionati a distanza diversa sono confrontabili.
//
// Serve una separazione minima tra i due snapshot per fidarsi della
// proiezione: sotto MIN_ELAPSED_HOURS (primo avvistamento, o due run troppo
// ravvicinati) il risultato è null ("non ancora misurabile"), non un tasso
// gonfiato dall'estrapolazione su una finestra minuscola.
const MIN_ELAPSED_HOURS = 3;

// Soglia di rumore PER-METRICA (non più un unico 20 per entrambe): un delta di
// 20 è significativo su un conteggio di post, è rumore su una somma di
// engagement che vive nell'ordine delle migliaia. Da calibrare su dati reali.
const MIN_VOLUME_DELTA = 20;
const MIN_ENGAGEMENT_DELTA = 500;

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

// null = non ancora misurabile: nessun riferimento (prima rilevazione), finestra
// troppo stretta per normalizzare, o delta assoluto sotto la soglia di rumore
// della metrica.
function growthFor(
  current: number | null,
  reference: number | null,
  elapsedHours: number,
  minAbsoluteDelta: number,
): { pct: number | null; significant: boolean } {
  if (current == null || reference == null) return { pct: null, significant: false };
  if (elapsedHours < MIN_ELAPSED_HOURS) return { pct: null, significant: false };

  const delta = current - reference;
  if (Math.abs(delta) < minAbsoluteDelta) return { pct: null, significant: false };
  if (reference <= 0) return { pct: null, significant: false };

  const rawPct = (delta / reference) * 100;
  const normalizedPct = rawPct * (TOPIC_GROWTH_WINDOW_HOURS / elapsedHours);
  return { pct: normalizedPct, significant: true };
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
  const elapsedHours = oldest
    ? (Date.now() - new Date(oldest.captured_at).getTime()) / (1000 * 60 * 60)
    : 0;

  const volume = growthFor(
    currentVolume,
    oldest?.content_volume ?? null,
    elapsedHours,
    MIN_VOLUME_DELTA,
  );
  const engagement = growthFor(
    currentEngagement,
    oldest?.total_engagement ?? null,
    elapsedHours,
    MIN_ENGAGEMENT_DELTA,
  );

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
