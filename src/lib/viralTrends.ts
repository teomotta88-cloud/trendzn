import { supabase } from "@/integrations/supabase/client";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";
import { looksItalian } from "@/lib/language";

export const VIRAL_PLATFORMS = ["instagram", "tiktok"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];

export const DISCOVERY_SOURCES = [
  "tiktok-hashtag",
  "google-trends",
  "trending-audio",
  "x-trending",
  "canali-inspo",
] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export { VIRALITY_WINDOW_DAYS };

export interface ViralTrendContent {
  id: string;
  platform: ViralPlatform;
  external_id: string;
  url: string;
  author: string | null;
  content: string | null;
  published_at: string | null;
  source_hashtag: string;
  keyword_matched: string;
  discovery_source: DiscoverySource;
  topic_id: string | null;
  engagement: number;
  reach: number | null;
  delta_engagement: number;
  delta_reach: number;
  delta_since: string | null;
  delta_engagement_6h: number;
  is_viral: boolean;
  created_at: string;
  // Valorizzati solo per i post Canali Inspo che fanno parte di un cluster
  // cross-profilo promosso a trend (3+ canali diversi sullo stesso
  // argomento) — null per tutti gli altri contenuti.
  cross_profile_topic: string | null;
  cross_profile_channel_count: number | null;
}

export const SORT_OPTIONS = ["virality", "date", "engagement", "views"] as const;
export type SortBy = (typeof SORT_OPTIONS)[number];

// Soglia di rumore sulle views per ammettere un contenuto TikTok nel feed —
// l'equivalente di "engagement > 1000" per le piattaforme con like/commenti.
// Da calibrare su dati reali (i video in trend hanno facilmente decine di
// migliaia di views).
export const TIKTOK_MIN_VIEWS = 10000;

// Verdetto di viralità del topic: "questo trend sta producendo contenuti
// virali?". Derivato dai contenuti del topic (Fase 1: calcolo client-side sui
// contenuti già caricati, nessuna tabella dedicata — la Fase 2 lo sposterà
// server-side in topic_signals, con un livello di confidenza per distinguere
// "piatto" da "copertura parziale").
//
// È volutamente basato sulla CODA ALTA della distribuzione, non sulla somma:
// basta UN contenuto che sta accelerando ora perché il trend stia "producendo
// virale" — che è esattamente la domanda. La vecchia regola (volume ED
// engagement totali in crescita) premiava invece il volume di pubblicazione e
// mancava il singolo post che esplode senza nuovi post.
//
// "unknown" (Fase 3) distingue "non ancora misurabile" da "piatto": un topic
// senza contenuti in vista E senza alcun segnale registrato è un primo
// avvistamento o una copertura assente — non l'abbiamo guardato e trovato
// quieto, semplicemente non abbiamo dati. Dirlo "piatto" sarebbe una falsa
// certezza.
export const TOPIC_VERDICTS = ["producing", "warming", "flat", "unknown"] as const;
export type TopicVerdict = (typeof TOPIC_VERDICTS)[number];

export function computeTopicVerdict(
  content: ViralTrendContent[],
  opts: { hasSignals?: boolean } = {},
): TopicVerdict {
  // Almeno un contenuto sta correndo davvero adesso.
  if (content.some((c) => c.is_viral)) return "producing";
  // Nessun contenuto ancora virale, ma c'è crescita in corso (views o
  // engagement) su qualche post: si sta scaldando.
  if (content.some((c) => c.delta_reach > 0 || c.delta_engagement > 0)) return "warming";
  // Nessun contenuto in vista e nessun segnale: non "piatto", ma "non ancora
  // misurabile" (primo avvistamento / copertura assente).
  if (content.length === 0 && !opts.hasSignals) return "unknown";
  return "flat";
}

export async function listViralTrendContent(
  filters: { platform?: ViralPlatform; sourceHashtag?: string; sortBy?: SortBy } = {},
): Promise<ViralTrendContent[]> {
  const since = new Date();
  since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // published_at manca per alcuni contenuti (fonte non l'ha fornito): in quel
  // caso si ripiega su created_at (quando NOI l'abbiamo sincronizzato per la
  // prima volta) invece di scartarlo o di lasciarlo passare sempre — un post
  // vecchio ma senza data nota non deve bypassare il filtro di recency.
  //
  // Soglia minima di rumore PER PIATTAFORMA (le due .or() si combinano in AND):
  // engagement > 1000 dove abbiamo like/commenti, VIEWS > TIKTOK_MIN_VIEWS su
  // TikTok — che ha sempre engagement 0 (nessuna fonte gratuita per
  // like/commenti, vedi fetchTikTokContent) e prima veniva escluso in toto dal
  // feed. Ora TikTok entra col suo segnale nativo. Un post TikTok senza views
  // estratte (reach null) resta fuori: senza segnale non possiamo dire nulla
  // sulla sua viralità.
  let query = supabase
    .from("viral_trend_content")
    .select("*")
    .or(
      `and(platform.neq.tiktok,engagement.gt.1000),and(platform.eq.tiktok,reach.gt.${TIKTOK_MIN_VIEWS})`,
    )
    .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`);

  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.sourceHashtag) query = query.eq("source_hashtag", filters.sourceHashtag);

  switch (filters.sortBy) {
    case "date":
      query = query
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    case "engagement":
      query = query.order("engagement", { ascending: false });
      break;
    case "views":
      query = query.order("reach", { ascending: false, nullsFirst: false });
      break;
    default:
      // Prima chi sta accelerando ORA (is_viral, che ora decade — vedi
      // computePostVirality in src/lib/virality.ts), poi per velocità del
      // segnale nelle ultime 6h (delta_engagement_6h: per TikTok è la crescita
      // delle views), infine per grandezza assoluta come spareggio —
      // engagement dove esiste, altrimenti reach (TikTok). Un post grande ma
      // ormai piatto non è più "virale": scende sotto quelli che corrono, ma
      // resta raggiungibile con l'ordinamento per engagement/views.
      query = query
        .order("is_viral", { ascending: false })
        .order("delta_engagement_6h", { ascending: false })
        .order("engagement", { ascending: false })
        .order("reach", { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query.limit(300);
  if (error) throw error;

  // Filtro lingua in lettura: scarta i contenuti la cui didascalia non risulta
  // italiana (vedi looksItalian). Serve a nascondere SUBITO i post spagnoli
  // già in DB — sincronizzati prima del fix del filtro di ingestione o non
  // ancora rimossi dal ricontrollo — senza aspettare che il workflow di
  // pulizia li cancelli. I contenuti senza didascalia (content null) restano
  // visibili: non abbiamo su cosa decidere e non vogliamo nascondere post
  // potenzialmente legittimi.
  return (data ?? []).filter(
    (item) => !item.content || looksItalian(item.content),
  ) as ViralTrendContent[];
}
