// Regole di viralità e finestre temporali condivise tra sync-viral-trends.ts
// (scoperta via anysite e, tramite lo stesso hook, discover-instagram-hashtag-content.mjs)
// e recheck-viral-engagement.ts (ricontrollo gratuito via browsing pubblico
// anonimo) — estratte qui perché entrambi gli endpoint devono valutare la
// viralità di un post nello stesso modo, altrimenti un contenuto
// cambierebbe stato a seconda di quale dei due lo ha aggiornato per ultimo.
//
// Storia: fino a questa versione la viralità era un punteggio continuo
// (velocity log1p-smorzata + engagement-rate + recency boost, vedi
// virality_score). Sostituito su richiesta esplicita con due soglie
// esplicite e leggibili, più facili da spiegare in UI di un punteggio
// composito arbitrario.

// Finestra fissa per l'eleggibilità del contenuto nel feed (vedi
// listViralTrendContent in viralTrends.ts) e per la "Variazione (7gg)"
// mostrata in UI — indipendente dalla finestra di viralità qui sotto.
export const VIRALITY_WINDOW_DAYS = 7;

// La viralità del post è ora definita come "il segnale sta accelerando ORA":
// il segnale è cresciuto di più della soglia nelle ultime ~6h. Prima c'era
// anche un OR "engagement totale > 5000" che rendeva un post virale PER
// SEMPRE dentro la finestra di 7gg — un contenuto esploso giorni fa teneva il
// topic "virale" anche quando ormai piatto. Rimosso: la viralità deve
// decadere quando il post smette di correre (vedi computePostVirality).
//
// Ogni piattaforma usa il miglior segnale gratuito disponibile: engagement
// (like+commenti) dove lo abbiamo, VIEWS su TikTok — dove non esiste una
// fonte gratuita per like/commenti (vedi fetchTikTokContent in
// scripts/sync-viral-trends.mjs). Le soglie sono quindi per-segnale (le views
// vivono su una scala molto più grande dell'engagement) e vanno calibrate su
// dati reali.
export const VIRAL_DELTA_WINDOW_HOURS = 6;
export const VIRAL_ENGAGEMENT_DELTA_THRESHOLD = 1000;
export const VIRAL_VIEWS_DELTA_THRESHOLD = 20000;

// Seconda soglia, in OR con quella assoluta sopra: un post è virale anche se
// il segnale è cresciuto di oltre il 10% rispetto al controllo precedente
// (oldestWithin6h), indipendentemente dalla sua grandezza assoluta — cattura
// un post che sta accelerando forte in proporzione anche quando non ancora
// abbastanza grande da superare la soglia assoluta. Richiede una baseline
// minima (VIRAL_RELATIVE_GROWTH_MIN_BASELINE) per non far scattare il 10% su
// numeri piccolissimi (2 -> 3 è "+50%" ma è rumore, non un segnale reale).
export const VIRAL_RELATIVE_GROWTH_THRESHOLD_PCT = 10;
export const VIRAL_RELATIVE_GROWTH_MIN_BASELINE = 50;

// Soglia assoluta "post notevole": NON decide più is_viral (che ora decade),
// resta come riferimento per far emergere comunque un contenuto già grande
// negli ordinamenti secondari se servirà.
export const VIRAL_TOTAL_THRESHOLD = 5000;

export type MetricsSnapshot = { engagement: number; reach: number | null; captured_at: string };

// Delta su 7 giorni per la "Variazione" mostrata in UI — non decide la
// viralità (vedi computePostVirality sotto), è solo un'indicazione di quanto
// è cresciuto un post da quando l'abbiamo visto la prima volta in finestra.
export function computeDeltaMetrics({
  engagement,
  reach,
  oldest,
}: {
  engagement: number;
  reach: number | null;
  oldest: MetricsSnapshot | null;
}) {
  const deltaReach = oldest ? Math.max(0, (reach ?? 0) - (oldest.reach ?? 0)) : 0;
  const deltaEngagement = oldest ? Math.max(0, engagement - oldest.engagement) : 0;
  return { deltaEngagement, deltaReach };
}

// Viralità del singolo post, in base alla VELOCITÀ del segnale nelle ultime
// ~6h. Il segnale è engagement dove esiste, views su TikTok (platform ===
// "tiktok"). oldestWithin6h è lo snapshot più vecchio noto nella finestra di
// VIRAL_DELTA_WINDOW_HOURS (query separata dai 7 giorni di computeDeltaMetrics).
//
// deltaSignal6h resta 0 in due casi, entrambi corretti: al primo avvistamento
// (nessuno snapshot precedente in finestra) e quando il post non viene più
// ricampionato da oltre 6h — in quel caso non sta accelerando ORA, quindi non
// è virale ora. È così che la viralità decade da sola, senza uno stato
// "sticky" da resettare.
//
// Il valore viene poi scritto nella colonna storica delta_engagement_6h: per
// TikTok contiene la velocità delle views, non dell'engagement. Il nome della
// colonna resta invariato per non richiedere una migration in questa fase
// (verrà rinominato in delta_signal_6h nella Fase 2).
export function computePostVirality({
  platform,
  engagement,
  reach,
  oldestWithin6h,
}: {
  platform: string;
  engagement: number;
  reach: number | null;
  oldestWithin6h: MetricsSnapshot | null;
}) {
  const usesViews = platform === "tiktok";
  const signalNow = usesViews ? (reach ?? 0) : engagement;
  const signalRef = usesViews
    ? (oldestWithin6h?.reach ?? null)
    : (oldestWithin6h?.engagement ?? null);

  const deltaSignal6h = signalRef != null ? Math.max(0, signalNow - signalRef) : 0;

  const threshold = usesViews ? VIRAL_VIEWS_DELTA_THRESHOLD : VIRAL_ENGAGEMENT_DELTA_THRESHOLD;

  // Percentuale solo se la baseline è abbastanza grande da fidarsi (vedi
  // VIRAL_RELATIVE_GROWTH_MIN_BASELINE) — altrimenti null, non un numero
  // gonfiato da un campione minuscolo.
  const deltaSignalPct =
    signalRef != null && signalRef >= VIRAL_RELATIVE_GROWTH_MIN_BASELINE
      ? (deltaSignal6h / signalRef) * 100
      : null;

  const isViral =
    deltaSignal6h > threshold ||
    (deltaSignalPct != null && deltaSignalPct > VIRAL_RELATIVE_GROWTH_THRESHOLD_PCT);

  return { isViral, deltaSignal6h, deltaSignalPct };
}
