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

// Un post è virale se il suo engagement è cresciuto di oltre 1000 in al
// massimo 6 ore, OPPURE se ha già superato 5000 di engagement totale
// (indipendentemente dalla crescita recente — un post già molto grande
// resta rilevante anche se nelle ultime 6h è stato piatto).
export const VIRAL_DELTA_WINDOW_HOURS = 6;
export const VIRAL_DELTA_THRESHOLD = 1000;
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

// Viralità del singolo post: oldestWithin6h è lo snapshot più vecchio noto
// nella finestra di VIRAL_DELTA_WINDOW_HOURS (query separata dai 7 giorni
// usati da computeDeltaMetrics — un post sincronizzato ogni 6h avrà quasi
// sempre uno snapshot a cavallo di questa finestra, ma non è garantito, es.
// al primo avvistamento: in quel caso deltaEngagement6h resta 0, corretto,
// non c'è ancora nessuna crescita da misurare).
export function computePostVirality({
  engagement,
  oldestWithin6h,
}: {
  engagement: number;
  oldestWithin6h: MetricsSnapshot | null;
}) {
  const deltaEngagement6h = oldestWithin6h
    ? Math.max(0, engagement - oldestWithin6h.engagement)
    : 0;

  const isViral = deltaEngagement6h > VIRAL_DELTA_THRESHOLD || engagement > VIRAL_TOTAL_THRESHOLD;

  return { isViral, deltaEngagement6h };
}
