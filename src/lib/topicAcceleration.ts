// Trend Virali — Fase E: "sta accelerando" (derivata del tasso di crescita)
// e "è credibile" (corroborato da più fonti indipendenti in accelerazione
// coerente), sopra i tassi di crescita già calcolati da topicGrowth.ts.
//
// Principio: topicGrowth.ts risponde "sta crescendo?" confrontando UN
// valore attuale con UN riferimento passato. Qui si risponde a una domanda
// diversa — "il tasso di crescita STESSO sta aumentando?" — confrontando
// DUE tassi già calcolati in momenti diversi (vedi topic_growth_history,
// popolata negli stessi punti in cui topic_signals viene sovrascritto).
// Un topic con crescita costante al 5%/24h non sta accelerando anche se
// cresce; un topic passato dal 2% al 15% sta esplodendo anche se il 15% in
// assoluto sembra piccolo — è la differenza tra le due letture che conta.

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

// Quante fonti indipendenti in accelerazione servono per considerare un
// topic "credibile/in crescita" invece di rumore su una fonte sola — vedi
// buildCorroboration sotto.
export const MIN_SOURCES_FOR_CREDIBLE = 2;

// Chiave canonica per riconoscere lo STESSO fenomeno raccontato da fonti
// diverse (es. "labubu" su TikTok, "Labubu Milano" su Google Trends): usa
// derived_hashtag quando c'è (già normalizzato — minuscolo, senza spazi né
// accenti, vedi keywordToHashtag in scripts/lib/word-segment.mjs), altrimenti
// normalizza value allo stesso modo SOLO se abbastanza corto da essere
// paragonabile a un hashtag (stessa soglia di parole già usata altrove per
// derivare un hashtag) — per un titolo Reddit/YouTube lungo (la maggioranza)
// non esiste chiave canonica: quel topic resta fuori dalla corroborazione
// automatica in questa prima iterazione (limite noto, non un bug — vedi
// commento nel piano di lavoro: serve calibrare su falsi negativi reali,
// eventualmente con un match più sofisticato via LLM in una fase successiva).
const MAX_CANONICAL_WORDS = 2;

function normalizeToCanonical(value: string): string | null {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > MAX_CANONICAL_WORDS) return null;
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function canonicalKeyFor(topic: {
  topic_type: string;
  value: string;
  derived_hashtag: string | null;
}): string | null {
  if (topic.topic_type === "tiktok-hashtag") {
    return normalizeToCanonical(topic.value);
  }
  if (topic.derived_hashtag) {
    return normalizeToCanonical(topic.derived_hashtag) ?? topic.derived_hashtag.toLowerCase();
  }
  return normalizeToCanonical(topic.value);
}

export type CorroborationInput = {
  id: string;
  topic_type: string;
  canonicalKey: string | null;
  isAccelerating: boolean;
};

export type Corroboration = {
  sourceCount: number;
  sourceTypes: string[];
  isCredible: boolean;
};

// Raggruppa i topic per canonicalKey e conta quanti topic_type DISTINTI
// mostrano accelerazione nello stesso gruppo — un topic da solo (nessun
// altro con la stessa chiave) non è mai "credibile" per definizione, anche
// se sta accelerando: la corroborazione richiede ALMENO un'altra fonte
// indipendente, non solo la propria accelerazione (quella la vede già il
// badge di trend esistente, isStrongGrowthSignal).
export function buildCorroboration(topics: CorroborationInput[]): Map<string, Corroboration> {
  const byKey = new Map<string, CorroborationInput[]>();
  for (const t of topics) {
    if (!t.canonicalKey) continue;
    const group = byKey.get(t.canonicalKey) ?? [];
    group.push(t);
    byKey.set(t.canonicalKey, group);
  }

  const result = new Map<string, Corroboration>();
  for (const [key, group] of byKey) {
    const acceleratingTypes = new Set(
      group.filter((t) => t.isAccelerating).map((t) => t.topic_type),
    );
    const allTypes = new Set(group.map((t) => t.topic_type));
    result.set(key, {
      sourceCount: allTypes.size,
      sourceTypes: [...allTypes],
      isCredible: acceleratingTypes.size >= MIN_SOURCES_FOR_CREDIBLE,
    });
  }
  return result;
}
