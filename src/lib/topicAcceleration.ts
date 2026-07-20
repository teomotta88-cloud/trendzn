// Trend Virali — Fase E: "sta accelerando" (derivata del tasso di crescita),
// sopra i tassi di crescita già calcolati da topicGrowth.ts.
//
// Principio: topicGrowth.ts risponde "sta crescendo?" confrontando UN
// valore attuale con UN riferimento passato. Qui si risponde a una domanda
// diversa — "il tasso di crescita STESSO sta aumentando?" — confrontando
// DUE tassi già calcolati in momenti diversi (vedi topic_growth_history,
// popolata negli stessi punti in cui topic_signals viene sovrascritto).
// Un topic con crescita costante al 5%/24h non sta accelerando anche se
// cresce; un topic passato dal 2% al 15% sta esplodendo anche se il 15% in
// assoluto sembra piccolo — è la differenza tra le due letture che conta.
//
// Nota storica: questo file conteneva anche un secondo meccanismo,
// canonicalKeyFor/buildCorroboration — un tentativo di riconoscere lo stesso
// trend raccontato da fonti diverse via chiave canonica testuale (hashtag
// normalizzato). Rimosso: nel frattempo un altro lavoro su questo stesso
// progetto ha costruito scripts/match-cross-source-trends.mjs, che fa la
// stessa cosa via matching semantico LLM — strettamente migliore (regge
// parafrasi, lingue diverse, e copre anche Canali Inspo, che qui non era
// nemmeno raggiungibile). computeAcceleration sotto è ora usata da quel
// sistema per aggiungere la dimensione "sta accelerando" ai gruppi già
// trovati dall'LLM (vedi cross_source_trends.is_accelerating), invece di
// duplicare la corroborazione.

// Sotto questa soglia (punti percentuali di differenza tra le due letture)
// la variazione è rumore statistico, non vera accelerazione — stessa logica
// di soglia-minima-per-fidarsi già usata in topicGrowth.ts/virality.ts, da
// calibrare su dati reali una volta che ci sarà abbastanza storico.
export const ACCELERATION_MIN_DELTA_PCT_POINTS = 2;

export type AccelerationTrend = "accelerating" | "stable" | "decelerating";

export type GrowthReading = {
  volume_growth_pct: number | null;
  engagement_growth_pct: number | null;
  computed_at: string;
};

export type Acceleration = {
  platform: string;
  volumeAccelerationPct: number | null;
  engagementAccelerationPct: number | null;
  trend: AccelerationTrend | null;
};

function accelerationFor(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

function trendFor(volumeAcceleration: number | null, engagementAcceleration: number | null): AccelerationTrend | null {
  // Basta che UNO dei due segnali acceleri per considerare il topic in
  // accelerazione — stessa asimmetria già accettata in topicGrowth.ts, dove
  // TikTok valorizza solo il volume e YouTube/Google Trends solo
  // l'engagement (vedi commenti in discover-youtube-trending.mjs): pretendere
  // sempre entrambi escluderebbe queste fonti a priori.
  const readings = [volumeAcceleration, engagementAcceleration].filter(
    (v): v is number => v != null,
  );
  if (readings.length === 0) return null;

  const maxAbs = readings.reduce((max, v) => (Math.abs(v) > Math.abs(max) ? v : max), 0);
  if (Math.abs(maxAbs) < ACCELERATION_MIN_DELTA_PCT_POINTS) return "stable";
  return maxAbs > 0 ? "accelerating" : "decelerating";
}

// latest/previous: le ultime due righe di topic_growth_history per lo stesso
// (topic, piattaforma), ordinate per computed_at crescente — il chiamante
// (list-monitored-topics.ts) fa il raggruppamento, questa funzione lavora su
// una singola coppia già estratta.
export function computeAcceleration(
  platform: string,
  latest: GrowthReading | null,
  previous: GrowthReading | null,
): Acceleration {
  const volumeAccelerationPct = accelerationFor(
    latest?.volume_growth_pct ?? null,
    previous?.volume_growth_pct ?? null,
  );
  const engagementAccelerationPct = accelerationFor(
    latest?.engagement_growth_pct ?? null,
    previous?.engagement_growth_pct ?? null,
  );

  return {
    platform,
    volumeAccelerationPct,
    engagementAccelerationPct,
    trend: trendFor(volumeAccelerationPct, engagementAccelerationPct),
  };
}
