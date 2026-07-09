// Formula di viralità e finestra temporale condivise tra sync-viral-trends.ts
// (scoperta via anysite) e recheck-viral-engagement.ts (ricontrollo gratuito
// via browsing pubblico anonimo, scripts/lib/instagram-public-metrics.mjs) —
// estratte qui perché entrambi gli endpoint devono calcolare lo stesso
// punteggio nello stesso modo, altrimenti un contenuto cambierebbe logica di
// scoring a seconda di quale dei due lo ha aggiornato per ultimo.

// Finestra fissa: sempre 7 giorni, sia per l'eleggibilità del contenuto nel
// feed (vedi listViralTrendContent in viralTrends.ts) sia per il calcolo
// della variazione qui sotto — cambiarli in modo scollegato renderebbe il
// punteggio di viralità incoerente con quello che l'utente vede filtrato.
export const VIRALITY_WINDOW_DAYS = 7;

const RECENCY_HALF_LIFE_HOURS = 48;

export type MetricsSnapshot = { engagement: number; reach: number | null; captured_at: string };

// Punteggio di viralità: premia la crescita di views/engagement nella finestra
// nota (non il valore assoluto — un post vecchio con molte view non è
// "virale ora") più un bonus di recency rispetto alla pubblicazione. log1p
// smorza gli outlier (un salto da 500k a 5M non deve pesare 10000x più di un
// salto da 5 a 50) mantenendo comunque l'ordine di grandezza. engagementRate
// è 0 (non "engagement grezzo") quando reach non è disponibile — vedi
// PR #105: senza questo controllo un post senza views note dominava il
// punteggio indipendentemente dalla crescita reale.
export function computeViralityScore({
  engagement,
  reach,
  publishedAt,
  oldest,
}: {
  engagement: number;
  reach: number | null;
  publishedAt: string;
  oldest: MetricsSnapshot | null;
}) {
  const now = Date.now();
  const elapsedHours = oldest
    ? Math.max(1, (now - new Date(oldest.captured_at).getTime()) / 3_600_000)
    : 1;

  const deltaReach = oldest ? Math.max(0, (reach ?? 0) - (oldest.reach ?? 0)) : 0;
  const deltaEngagement = oldest ? Math.max(0, engagement - oldest.engagement) : 0;

  const velocityReach = Math.log1p(deltaReach) / elapsedHours;
  const velocityEngagement = Math.log1p(deltaEngagement) / elapsedHours;
  const engagementRate = reach != null && reach > 0 ? engagement / reach : 0;
  const ageHours = Math.max(0, (now - new Date(publishedAt).getTime()) / 3_600_000);
  const recencyBoost = Math.exp(-ageHours / RECENCY_HALF_LIFE_HOURS);

  const viralityScore =
    3 * velocityReach + 3 * velocityEngagement + 2 * engagementRate + 2 * recencyBoost;

  return { viralityScore, deltaEngagement, deltaReach };
}
