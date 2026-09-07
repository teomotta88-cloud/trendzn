import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformIcon, SocialEmbed } from "@/components/SocialEmbed";
import { verifyBluserenaPost, type VerificationStatus, type Sentiment } from "@/lib/trends";
import { GENERIC_RESORT, RESORT_NAMES, resolveResort } from "@/lib/bluserenaResorts";
import {
  Search,
  Filter,
  Check,
  AlertCircle,
  Smile,
  Tag as TagIcon,
  MapPin,
  Zap,
  Headphones,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import type { CanaleInspo, AccountRef } from "@/lib/trends";

// Identità di un post ai fini della lista: la sua url, senza query string
// (i share_url di TikTok portano parametri di tracciamento generati a caso a
// ogni scrape, stesso video). Serve perché lo store tiene una riga per
// canale: un post indicizzato sotto più hashtag esiste in più copie e nel
// feed si vedeva ripetuto — 168 righe su 1478 nei dati del 04/09.
//
// È lo stesso identico criterio di scripts/dedupe-bluserena-posts.mjs, che
// ripulisce lo store: se qui la regola fosse più larga, il feed nasconderebbe
// post che nei dati (e quindi nelle statistiche) restano.
function contentKey(post: Post): string {
  try {
    const parsed = new URL(post.url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    // url non parsabile: resta com'è, al massimo non deduplica
    return post.url;
  }
}

function dedupeByContent(list: Post[]): Post[] {
  const seen = new Set<string>();
  return list.filter((post) => {
    const key = contentKey(post);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type SentimentFilter = "all" | "positive" | "negative" | "neutral" | "unanalyzed";
type VerificationFilter = "all" | "confirmed" | "unconfirmed";
type DateFilter = "all" | "2025" | "2026" | "2025-2026";
// "2025-07", "2026-08"... più "all": i mesi disponibili si ricavano dai dati,
// non da una lista fissa, così restano allineati alla finestra monitorata.
type MonthFilter = string;
type ResortFilter = string;

const MESI_IT = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

const monthKey = (date: string | null | undefined) => (date || "").slice(0, 7);

const monthLabel = (key: string) => {
  const [year, month] = key.split("-");
  const nome = MESI_IT[Number(month) - 1];
  return nome ? `${nome} ${year}` : key;
};

interface Post extends AccountRef {
  canaleName: string;
  canaleId: string;
}

interface BluserenaFeedAdvancedProps {
  jsonUrl: string;
  tab: string;
  setTab: (tab: string) => void;
}

export function BluserenaFeedAdvanced({
  jsonUrl,
  tab,
  setTab,
}: BluserenaFeedAdvancedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  // Il lavoro su questa pagina si fa sui post confermati: gli altri sono
  // omonimie da hashtag. Il filtro resta comunque a portata di click.
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("confirmed");
  const [monthFilter, setMonthFilter] = useState<MonthFilter>("all");
  const [resortFilter, setResortFilter] = useState<ResortFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [updatingUrl, setUpdatingUrl] = useState<string | null>(null);
  const [updatingResortUrl, setUpdatingResortUrl] = useState<string | null>(null);
  const [updatingSentimentUrl, setUpdatingSentimentUrl] = useState<string | null>(null);

  // Carica JSON runtime. Il polling ogni 30s aggiorna i post in background:
  // setLoading(true) va chiamato SOLO al primo giro, altrimenti ogni refresh
  // automatico smonta l'intera pagina (filtri compresi) sostituendola con lo
  // spinner "Caricamento feed...", perdendo scroll e dando l'impressione che
  // sia stato il click su un filtro a causare un ricaricamento.
  useEffect(() => {
    let isFirstLoad = true;
    const fetchData = async () => {
      try {
        if (isFirstLoad) setLoading(true);
        // ?t= evita la cache di qualche minuto di raw.githubusercontent.com:
        // senza, un aggiornamento del json (es. dopo un workflow) può non
        // vedersi in pagina per un po' anche ricaricando.
        const res = await fetch(`${jsonUrl}?t=${Date.now()}`);
        if (!res.ok) throw new Error(`Errore ${res.status}`);
        const data = (await res.json()) as { canali: CanaleInspo[] };

        const allPosts: Post[] = [];
        for (const canale of data.canali) {
          for (const account of canale.accounts || []) {
            if (/\/(p|reel|reels|video|photo|watch|tv|status)\//i.test(account.url)) {
              allPosts.push({
                ...account,
                canaleName: canale.name,
                canaleId: canale.id,
              });
            }
          }
        }

        allPosts.sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });

        setPosts(allPosts);
        setError(null);
      } catch (err) {
        setError(String(err));
      } finally {
        if (isFirstLoad) {
          setLoading(false);
          isFirstLoad = false;
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [jsonUrl]);

  // Aggiorna BSConfirmed/BSUnconfirmed di un post via API e riflette il
  // cambio subito in locale, senza aspettare il prossimo polling.
  //
  // L'endpoint aggiorna UNA riga sola (quella del canale passato in
  // channelId), ma la card ne rappresenta anche altre: da quando il feed
  // deduplica per contenuto, le copie dello stesso post negli altri canali
  // non hanno più una card propria da cui sistemarle. Le aggiorniamo tutte
  // qui, una alla volta — sono quasi sempre due e ogni chiamata riscrive lo
  // stesso file, quindi in parallelo si pesterebbero i piedi a vicenda.
  const toggleVerificationStatus = async (post: Post) => {
    const currentStatus = post.verificationStatus || verifyBluserenaPost(post.caption);
    const newStatus: VerificationStatus = currentStatus === "confirmed" ? "unconfirmed" : "confirmed";
    setUpdatingUrl(post.url);

    const key = contentKey(post);
    const copies = posts.filter((p) => contentKey(p) === key);

    try {
      const updated: Post[] = [];
      let failure: { status: number; text: string } | null = null;

      for (const copy of copies) {
        const res = await fetch("/api/public/hooks/update-bluserena-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId: copy.canaleId,
            postUrl: copy.url,
            verificationStatus: newStatus,
          }),
        });

        if (res.ok) {
          updated.push(copy);
        } else {
          failure = { status: res.status, text: await res.text() };
          break;
        }
      }

      // Le copie andate a buon fine si riflettono comunque in locale, anche
      // se una successiva è fallita: nasconderle darebbe l'idea che non sia
      // cambiato niente mentre su GitHub il cambio c'è.
      if (updated.length > 0) {
        setPosts((prev) =>
          prev.map((p) =>
            updated.some((u) => u.url === p.url && u.canaleId === p.canaleId)
              ? { ...p, verificationStatus: newStatus }
              : p,
          ),
        );
      }

      if (failure) {
        const { status: resStatus, text: errText } = failure;
        console.error("Errore aggiornamento verifica:", resStatus, errText);
        // L'endpoint risponde sempre {ok:false, error:"..."}: mostriamo quel
        // messaggio invece di un generico "errore", per capire subito se il
        // problema è un token mancante, un conflitto di scrittura o altro,
        // senza dover aprire la console.
        let detail = errText;
        try {
          detail = JSON.parse(errText).error || errText;
        } catch {
          // risposta non JSON, teniamo il testo grezzo
        }
        alert(`Errore durante l'aggiornamento della verifica (${resStatus}): ${detail}`);
      }
    } catch (err) {
      console.error("Errore aggiornamento verifica:", err);
      alert("Errore di connessione durante l'aggiornamento");
    } finally {
      setUpdatingUrl(null);
    }
  };

  // Assegna a mano il resort di un post: scrive `location`, che è la fonte
  // più affidabile per resolveResort e quindi vince su canale e testo. Stessa
  // logica del toggle di verifica, copie comprese: l'endpoint aggiorna una
  // riga per volta e le copie non hanno una card propria da cui sistemarle.
  const updatePostResort = async (post: Post, resort: string) => {
    setUpdatingResortUrl(post.url);
    const key = contentKey(post);
    const copies = posts.filter((p) => contentKey(p) === key);
    // Stringa vuota = "non specificato": azzera il campo e l'attribuzione
    // torna a essere dedotta dal canale o dal testo.
    const location = resort || null;

    try {
      const updated: Post[] = [];
      let failure: { status: number; text: string } | null = null;

      for (const copy of copies) {
        const res = await fetch("/api/public/hooks/update-bluserena-post-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: copy.canaleId, postUrl: copy.url, location }),
        });

        if (res.ok) {
          updated.push(copy);
        } else {
          failure = { status: res.status, text: await res.text() };
          break;
        }
      }

      if (updated.length > 0) {
        setPosts((prev) =>
          prev.map((p) =>
            updated.some((u) => u.url === p.url && u.canaleId === p.canaleId)
              ? { ...p, location }
              : p,
          ),
        );
      }

      if (failure) {
        console.error("Errore aggiornamento resort:", failure.status, failure.text);
        let detail = failure.text;
        try {
          detail = JSON.parse(failure.text).error || failure.text;
        } catch {
          // risposta non JSON, teniamo il testo grezzo
        }
        alert(`Errore durante l'assegnazione del resort (${failure.status}): ${detail}`);
      }
    } catch (err) {
      console.error("Errore aggiornamento resort:", err);
      alert("Errore di connessione durante l'assegnazione del resort");
    } finally {
      setUpdatingResortUrl(null);
    }
  };

  // Corregge a mano il sentiment di un post. L'endpoint marca il record come
  // deciso a mano, e l'analisi notturna salta i post così marcati: senza,
  // ogni correzione sarebbe cancellata entro il giorno dopo. Riportare a
  // "non analizzato" cancella la marcatura e rimette il post in coda.
  const updatePostSentiment = async (post: Post, sentiment: Sentiment | null) => {
    setUpdatingSentimentUrl(post.url);
    const key = contentKey(post);
    const copies = posts.filter((p) => contentKey(p) === key);

    try {
      const updated: Post[] = [];
      let failure: { status: number; text: string } | null = null;

      for (const copy of copies) {
        const res = await fetch("/api/public/hooks/update-bluserena-post-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: copy.canaleId, postUrl: copy.url, sentiment }),
        });

        if (res.ok) {
          updated.push(copy);
        } else {
          failure = { status: res.status, text: await res.text() };
          break;
        }
      }

      if (updated.length > 0) {
        setPosts((prev) =>
          prev.map((p) =>
            updated.some((u) => u.url === p.url && u.canaleId === p.canaleId)
              ? { ...p, sentiment }
              : p,
          ),
        );
      }

      if (failure) {
        console.error("Errore aggiornamento sentiment:", failure.status, failure.text);
        let detail = failure.text;
        try {
          detail = JSON.parse(failure.text).error || failure.text;
        } catch {
          // risposta non JSON, teniamo il testo grezzo
        }
        alert(`Errore durante l'aggiornamento del sentiment (${failure.status}): ${detail}`);
      }
    } catch (err) {
      console.error("Errore aggiornamento sentiment:", err);
      alert("Errore di connessione durante l'aggiornamento del sentiment");
    } finally {
      setUpdatingSentimentUrl(null);
    }
  };

  const isInJulyAugust = (date: string | null | undefined, year: number): boolean => {
    if (!date) return false;
    const d = new Date(date);
    const month = d.getMonth() + 1;
    return d.getFullYear() === year && (month === 7 || month === 8);
  };

  // Testo su cui cerca il campo di ricerca: oltre a caption/handle/canale,
  // anche la trascrizione audio (scripts/analyze-bluserena-audio.mjs) e il
  // testo sovraimpresso letto dai frame (scripts/analyze-bluserena-ocr.mjs).
  // Nei reel il messaggio sta quasi sempre lì e non nella caption, quindi
  // senza questi cercare una frase detta o scritta a video non trovava nulla.
  //
  // L'indice si costruisce una volta per ogni ricarica dei post (il polling
  // ogni 30s), non ad ogni tasto premuto: le trascrizioni sono lunghe e
  // rifare le concatenazioni ad ogni keystroke si sentirebbe sulla
  // digitazione.
  const searchIndex = useMemo(() => {
    const index = new Map<Post, string>();
    for (const p of posts) {
      index.set(
        p,
        [p.caption, p.handle, p.canaleName, p.audioAnalysis?.transcript, p.ocrData?.textOnScreen]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      );
    }
    return index;
  }, [posts]);

  // Un filtro solo, usato sia per la griglia sia per i conteggi delle
  // tendine. `salta` serve a quelli: il numero accanto a "Agosto 2026" deve
  // dire quanti post resterebbero SCEGLIENDO quel mese, quindi si applicano
  // tutti gli altri filtri tranne quello della tendina che si sta popolando.
  // Senza, con il filtro su "confermati" si leggeva "Agosto 2026 (860)" e poi
  // se ne vedevano 230.
  const applicaFiltri = useCallback(
    (lista: Post[], salta?: "month" | "resort") => {
      let result = lista;

      if (search) {
        const q = search.toLowerCase();
        result = result.filter((p) => (searchIndex.get(p) ?? "").includes(q));
      }

      if (dateFilter !== "all") {
        result = result.filter((p) => {
          if (dateFilter === "2025") return isInJulyAugust(p.date, 2025);
          if (dateFilter === "2026") return isInJulyAugust(p.date, 2026);
          if (dateFilter === "2025-2026") {
            return isInJulyAugust(p.date, 2025) || isInJulyAugust(p.date, 2026);
          }
          return true;
        });
      }

      if (sentimentFilter !== "all") {
        result = result.filter((p) => {
          if (sentimentFilter === "unanalyzed") return !p.sentiment;
          return p.sentiment === sentimentFilter;
        });
      }

      if (verificationFilter !== "all") {
        result = result.filter((p) => {
          const status = p.verificationStatus || verifyBluserenaPost(p.caption);
          return status === verificationFilter;
        });
      }

      if (salta !== "month" && monthFilter !== "all") {
        result = result.filter((p) => monthKey(p.date) === monthFilter);
      }

      if (salta !== "resort" && resortFilter !== "all") {
        result = result.filter((p) => resolveResort(p) === resortFilter);
      }

      // Deduplica per ultima, sul risultato già filtrato: le copie di uno stesso
      // post condividono caption, data e stato, quindi passano o cadono insieme
      // nei filtri e quale copia sopravvive non cambia cosa si vede.
      return dedupeByContent(result);
    },
    [
      searchIndex,
      search,
      sentimentFilter,
      verificationFilter,
      dateFilter,
      monthFilter,
      resortFilter,
    ],
  );

  const filteredPosts = useMemo(() => applicaFiltri(posts), [posts, applicaFiltri]);

  // Mesi effettivamente presenti nei dati, dal più recente: una tendina con
  // dodici mesi di cui dieci vuoti sarebbe solo rumore.
  const availableMonths = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of applicaFiltri(posts, "month")) {
      const key = monthKey(p.date);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [posts, applicaFiltri]);

  // Tutti i resort della lista canonica, anche quelli a zero post: vedere che
  // una struttura non ha contenuti nel periodo è a sua volta un'informazione.
  const resortCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of applicaFiltri(posts, "resort")) {
      const resort = resolveResort(p);
      counts.set(resort, (counts.get(resort) ?? 0) + 1);
    }
    return counts;
  }, [posts, applicaFiltri]);

  // Denominatore del contatore: anche il totale va contato per contenuto,
  // altrimenti si leggerebbe "1267 / 1478" con 211 post irraggiungibili.
  const uniqueTotal = useMemo(() => new Set(posts.map(contentKey)).size, [posts]);

  const stats = useMemo(() => {
    // Deduplicati anche qui: se una sync ripopola i canali prima della
    // pulizia dello store, le copie conterebbero due volte in ogni numero
    // di questa sezione — volumi, medie view, classifiche per resort.
    const unici = dedupeByContent(posts);
    const posts2025 = unici.filter((p) => isInJulyAugust(p.date, 2025));
    const posts2026 = unici.filter((p) => isInJulyAugust(p.date, 2026));
    const isConfirmed = (p: Post) =>
      (p.verificationStatus || verifyBluserenaPost(p.caption)) === "confirmed";

    return {
      total2025: posts2025.length,
      total2026: posts2026.length,
      sentiment2025: posts2025.filter((p) => p.sentiment).length,
      sentiment2026: posts2026.filter((p) => p.sentiment).length,
      confirmed2025: posts2025.filter(isConfirmed).length,
      confirmed2026: posts2026.filter(isConfirmed).length,
    };
  }, [posts]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Caricamento feed...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Errore: {error}</div>;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Feed Avanzato</h2>
        <button
          onClick={() => setTab("canali")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Canali
        </button>
      </div>

      {/* Statistiche */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Luglio-Agosto 2025 */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Luglio-Agosto 2025</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Post totali</span>
                <span className="text-lg font-semibold">{stats.total2025}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Con sentiment</span>
                <span className="text-lg font-semibold text-blue-600">{stats.sentiment2025}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Confirmed</span>
                <span className="text-lg font-semibold text-green-600">
                  {stats.confirmed2025}/{stats.total2025}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Luglio-Agosto 2026 */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Luglio-Agosto 2026</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Post totali</span>
                <span className="text-lg font-semibold">{stats.total2026}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Con sentiment</span>
                <span className="text-lg font-semibold text-blue-600">{stats.sentiment2026}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Confirmed</span>
                <span className="text-lg font-semibold text-green-600">
                  {stats.confirmed2026}/{stats.total2026}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Confronto */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Confronto YoY</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. totali</span>
                <span className={`text-lg font-semibold ${stats.total2026 > stats.total2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.total2026 - stats.total2025 > 0 ? "+" : ""}{stats.total2026 - stats.total2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. sentiment</span>
                <span className={`text-lg font-semibold ${stats.sentiment2026 > stats.sentiment2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.sentiment2026 - stats.sentiment2025 > 0 ? "+" : ""}{stats.sentiment2026 - stats.sentiment2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. confirmed</span>
                <span className={`text-lg font-semibold ${stats.confirmed2026 > stats.confirmed2025 ? "text-green-600" : "text-red-600"}`}>
                  {stats.confirmed2026 - stats.confirmed2025 > 0 ? "+" : ""}{stats.confirmed2026 - stats.confirmed2025}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Filter className="size-4" />
            Filtri {showFilters ? "▼" : "▶"}
          </button>
          <span className="text-xs text-muted-foreground">
            {filteredPosts.length} / {uniqueTotal} post
          </span>
        </div>

        {showFilters && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <input
                type="text"
                placeholder="Cerca in caption, trascrizioni audio, testo on-screen, handle, canale..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Periodo
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "2025", "2026", "2025-2026"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDateFilter(d)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      dateFilter === d
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {d === "all"
                      ? "Tutti"
                      : d === "2025"
                        ? "Lug-Ago 2025"
                        : d === "2026"
                          ? "Lug-Ago 2026"
                          : "Lug-Ago 25-26"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="filtro-mese"
                  className="text-xs font-medium text-muted-foreground mb-2 block"
                >
                  Mese di pubblicazione
                </label>
                <select
                  id="filtro-mese"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="all">Tutti i mesi</option>
                  {availableMonths.map(([key, count]) => (
                    <option key={key} value={key}>
                      {monthLabel(key)} ({count})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="filtro-resort"
                  className="text-xs font-medium text-muted-foreground mb-2 block"
                >
                  Resort
                </label>
                <select
                  id="filtro-resort"
                  value={resortFilter}
                  onChange={(e) => setResortFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="all">Tutti i resort</option>
                  {[...RESORT_NAMES, GENERIC_RESORT].map((resort) => (
                    <option key={resort} value={resort}>
                      {resort} ({resortCounts.get(resort) ?? 0})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Sentiment
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "positive", "negative", "neutral", "unanalyzed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSentimentFilter(s)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      sentimentFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {s === "all"
                      ? "Tutti"
                      : s === "positive"
                        ? "😊 Positivi"
                        : s === "negative"
                          ? "😞 Negativi"
                          : s === "neutral"
                            ? "😐 Neutrali"
                            : "❓ Non analizzati"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                BS Verification
              </label>
              <div className="flex flex-wrap gap-2">
                {(["all", "confirmed", "unconfirmed"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVerificationFilter(v)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full font-medium transition ${
                      verificationFilter === v
                        ? v === "confirmed"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : v === "unconfirmed"
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {v === "all" ? (
                      "Tutti"
                    ) : v === "confirmed" ? (
                      <>
                        <Check className="size-3" /> Confermati
                      </>
                    ) : (
                      <>
                        <AlertCircle className="size-3" /> Non confermati
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Intelligence Section */}
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          onClick={() => setShowAIInsights(!showAIInsights)}
          className="flex items-center gap-2 text-sm font-medium w-full"
        >
          <TrendingUp className="size-4" />
          AI Intelligence {showAIInsights ? "▼" : "▶"}
        </button>

        {showAIInsights && (
          <div className="border-t border-border pt-4 mt-4 space-y-4">
            <AIInsights posts={filteredPosts} totaleNonFiltrato={uniqueTotal} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPosts.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">
            Nessun post trovato
          </div>
        ) : (
          filteredPosts.map((post) => (
            <PostCard
              // Chiave url + canaleId, non solo url: lo stesso post compare in
              // più canali hashtag (148 url su 1310 sono in due canali), quindi
              // con la sola url React riceveva chiavi duplicate e, al cambio di
              // filtro, riusava il nodo sbagliato — una card già filtrata via
              // restava a schermo, ed è così che tra i confermati comparivano
              // dei "BS Non confermato". È la stessa identità (url + canale)
              // che usa già il toggle di verifica.
              key={`${post.canaleId}|${post.url}`}
              post={post}
              search={search}
              updating={updatingUrl === post.url}
              updatingResort={updatingResortUrl === post.url}
              updatingSentiment={updatingSentimentUrl === post.url}
              onToggleVerification={() => toggleVerificationStatus(post)}
              onChangeResort={(resort) => updatePostResort(post, resort)}
              onChangeSentiment={(sentiment) => updatePostSentiment(post, sentiment)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface AIInsightsProps {
  // Gli stessi post che si vedono nella griglia, filtri compresi: guardare
  // una tabella per resort che ignora il resort selezionato, o KPI che
  // contano post di agosto mentre a schermo c'è luglio, è il modo più veloce
  // per prendere una decisione sui numeri sbagliati.
  //
  // Il perimetro "solo BSConfirmed" non è più cablato qui: lo impone il
  // filtro di verifica, che parte da "confermati" proprio per questo. Chi
  // sceglie di guardare i non confermati vede le statistiche di quelli.
  posts: Post[];
  // Quanti post ci sono in tutto, per dire quanto stretto è il filtro attivo.
  totaleNonFiltrato: number;
}

function AIInsights({ posts, totaleNonFiltrato }: AIInsightsProps) {
  const confirmedPosts2025 = useMemo(
    () => posts.filter((p) => isInJulyAugustStandalone(p.date, 2025)),
    [posts],
  );
  const confirmedPosts2026 = useMemo(
    () => posts.filter((p) => isInJulyAugustStandalone(p.date, 2026)),
    [posts],
  );
  const getTopTopics = (posts: Post[]): { topic: string; count: number }[] => {
    const topicCounts: Record<string, number> = {};
    posts.forEach((p) => {
      p.topics?.forEach((topic) => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });
    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const getSentimentBreakdown = (posts: Post[]) => {
    const positive = posts.filter((p) => p.sentiment === "positive").length;
    const negative = posts.filter((p) => p.sentiment === "negative").length;
    const neutral = posts.filter((p) => p.sentiment === "neutral").length;
    const analyzed = positive + negative + neutral;
    return { positive, negative, neutral, analyzed };
  };

  // Totali locali, calcolati sui soli post confirmed: usarli come
  // denominatore delle percentuali qui sotto tiene coerente il rapporto
  // (altrimenti "% analizzati" userebbe al numeratore i confirmed e al
  // denominatore tutti i post, compresi quelli scartati).
  const total2025 = confirmedPosts2025.length;
  const total2026 = confirmedPosts2026.length;
  // Le sezioni per resort, per utente e i KPI guardano tutto il periodo
  // insieme: separare 2025 e 2026 lì dentro spezzerebbe classifiche già corte
  // (metà dei resort sta sotto i dieci post). È l'insieme filtrato, non tutti
  // i post: fuori dalla finestra luglio-agosto non c'è comunque nulla.
  const confermati = useMemo(
    () => [...confirmedPosts2025, ...confirmedPosts2026],
    [confirmedPosts2025, confirmedPosts2026],
  );
  const topTopics2026 = getTopTopics(confirmedPosts2026);
  const sentiment2026 = getSentimentBreakdown(confirmedPosts2026);
  const sentiment2025 = getSentimentBreakdown(confirmedPosts2025);
  const avgViews2026 = confirmedPosts2026.length > 0
    ? Math.round(confirmedPosts2026.reduce((sum, p) => sum + (p.views || 0), 0) / confirmedPosts2026.length)
    : 0;
  const avgViews2025 = confirmedPosts2025.length > 0
    ? Math.round(confirmedPosts2025.reduce((sum, p) => sum + (p.views || 0), 0) / confirmedPosts2025.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Sentiment Breakdown 2026 */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Sentiment Lug-Ago 2026</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>😊 Positivi</span>
              <span className="font-semibold text-green-600">
                {sentiment2026.positive} ({Math.round((sentiment2026.positive / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😐 Neutrali</span>
              <span className="font-semibold text-slate-600">
                {sentiment2026.neutral} ({Math.round((sentiment2026.neutral / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😞 Negativi</span>
              <span className="font-semibold text-red-600">
                {sentiment2026.negative} ({Math.round((sentiment2026.negative / sentiment2026.analyzed) * 100) || 0}%)
              </span>
            </div>
          </div>
        </div>

        {/* Confronto Sentiment */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Confronto Sentiment</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>% Analyzed 2026</span>
              <span className="font-semibold">
                {Math.round((sentiment2026.analyzed / total2026) * 100) || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>% Analyzed 2025</span>
              <span className="font-semibold">
                {Math.round((sentiment2025.analyzed / total2025) * 100) || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Positivi Delta</span>
              <span className={`font-semibold ${
                (sentiment2026.positive / sentiment2026.analyzed || 0) > (sentiment2025.positive / sentiment2025.analyzed || 0)
                  ? "text-green-600"
                  : "text-red-600"
              }`}>
                {Math.round(((sentiment2026.positive / sentiment2026.analyzed || 0) - (sentiment2025.positive / sentiment2025.analyzed || 0)) * 100)}pp
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Topics */}
      {topTopics2026.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Topic Top 5 (Lug-Ago 2026)</div>
          <div className="space-y-1.5">
            {topTopics2026.map((item, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">#{i + 1}</span>
                <span className="flex-1 mx-2">{item.topic}</span>
                <span className="font-semibold text-primary">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Engagement Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Avg Views 2026</div>
          <div className="text-lg font-semibold">{avgViews2026.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Avg Views 2025</div>
          <div className="text-lg font-semibold">{avgViews2025.toLocaleString()}</div>
        </div>
      </div>

      {/* Prima di ogni numero, su cosa sono calcolati: con un filtro attivo
          il pannello mostra un sottoinsieme, e chi legge deve saperlo. */}
      <p className="text-[11px] text-muted-foreground">
        {posts.length === totaleNonFiltrato ? (
          <>Calcolato su tutti i {totaleNonFiltrato} post monitorati.</>
        ) : (
          <>
            Calcolato sui <strong>{posts.length}</strong> post che passano i filtri attivi, su{" "}
            {totaleNonFiltrato} monitorati.
          </>
        )}
      </p>

      <KpiTotali posts={confermati} />

      <ResortBreakdown posts={confermati} />

      <UtentiBreakdown posts={confermati} />

      {/* Key Insights */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
        <p>
          <strong>Insight:</strong> Lug-Ago 2026 ha {total2026 > total2025 ? "+" : ""}{total2026 - total2025} post
          BSConfirmed rispetto a Lug-Ago 2025 ({total2025}).
          {sentiment2026.analyzed > sentiment2025.analyzed && (
            <span> L'analisi sentiment è cresciuta di +{sentiment2026.analyzed - sentiment2025.analyzed} post.</span>
          )}
        </p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- AI: helper

// Stessa regola della finestra monitorata usata nel feed, qui in forma
// riusabile: AIInsights è un componente a sé e non vede l'helper interno.
function isInJulyAugustStandalone(date: string | null | undefined, year: number): boolean {
  if (!date) return false;
  const d = new Date(date);
  const month = d.getMonth() + 1;
  return d.getFullYear() === year && (month === 7 || month === 8);
}

const nf = new Intl.NumberFormat("it-IT");

const somma = (posts: Post[], campo: "views" | "likes" | "comments" | "shares") =>
  posts.reduce((tot, p) => tot + (p[campo] ?? 0), 0);

// I post con metriche sono meno di quelli totali: TikTok le espone solo per i
// video passati dal backfill Apify, gli altri hanno i campi a null. Contarli
// serve a dire su quanti post poggia un totale, invece di far credere che sia
// calcolato su tutti.
const conMetriche = (posts: Post[]) => posts.filter((p) => p.views != null).length;

const contaSentiment = (posts: Post[]) => ({
  positive: posts.filter((p) => p.sentiment === "positive").length,
  neutral: posts.filter((p) => p.sentiment === "neutral").length,
  negative: posts.filter((p) => p.sentiment === "negative").length,
});

// Barra del sentiment: tre segmenti proporzionali con 2px di stacco fra loro,
// accompagnati SEMPRE dai numeri — il colore da solo non è un'informazione
// accessibile, e con pochi post i segmenti diventano invisibili.
function SentimentBar({ posts }: { posts: Post[] }) {
  const { positive, neutral, negative } = contaSentiment(posts);
  const analizzati = positive + neutral + negative;

  if (analizzati === 0) {
    return <span className="text-[10px] text-muted-foreground">non analizzati</span>;
  }

  const pct = (n: number) => `${(n / analizzati) * 100}%`;

  return (
    <div className="space-y-1">
      <div
        className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
        title={`${positive} positivi, ${neutral} neutrali, ${negative} negativi`}
      >
        {positive > 0 && (
          <div
            className="rounded-full bg-green-600 dark:bg-green-500"
            style={{ width: pct(positive) }}
          />
        )}
        {neutral > 0 && (
          <div
            className="rounded-full bg-slate-400 dark:bg-slate-500"
            style={{ width: pct(neutral) }}
          />
        )}
        {negative > 0 && (
          <div
            className="rounded-full bg-red-600 dark:bg-red-500"
            style={{ width: pct(negative) }}
          />
        )}
      </div>
      <div className="flex gap-2 text-[9px] text-muted-foreground">
        <span className="text-green-700 dark:text-green-400">{positive} pos</span>
        <span>{neutral} neu</span>
        <span className="text-red-700 dark:text-red-400">{negative} neg</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ AI: KPI totali

function KpiTotali({ posts }: { posts: Post[] }) {
  const conDati = conMetriche(posts);
  const views = somma(posts, "views");
  const likes = somma(posts, "likes");
  const comments = somma(posts, "comments");
  const shares = somma(posts, "shares");
  // Engagement rate nel senso corrente del termine: interazioni sulle
  // visualizzazioni. Senza views non è calcolabile e non va inventato.
  const engagementRate = views > 0 ? ((likes + comments + shares) / views) * 100 : null;

  const tiles = [
    { label: "Visualizzazioni", value: views },
    { label: "Like", value: likes },
    { label: "Commenti", value: comments },
    { label: "Condivisioni", value: shares },
  ];

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        {/* Non più "post BSConfirmed": il perimetro lo decidono i filtri, e
            dirlo qui a prescindere sarebbe falso appena si guardano i non
            confermati. Quale sia l'insieme lo spiega la riga in cima. */}
        KPI complessivi — {posts.length} post
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="text-xl font-semibold">{nf.format(t.value)}</div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground space-y-0.5">
        <p>
          Totali calcolati sui {conDati} post che hanno metriche ({posts.length - conDati} non le
          espongono: il backfill delle metriche non li ha ancora coperti).
          {engagementRate !== null && (
            <span> Engagement rate: {engagementRate.toFixed(2)}% delle visualizzazioni.</span>
          )}
        </p>
        <p>
          La <strong>reach</strong> non compare: TikTok non la espone pubblicamente, la danno solo
          gli analytics del proprietario dell&apos;account. Le visualizzazioni sono l&apos;unico
          dato di diffusione disponibile per contenuti di terzi.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- AI: per resort

function ResortBreakdown({ posts }: { posts: Post[] }) {
  const righe = useMemo(() => {
    const gruppi = new Map<string, Post[]>();
    for (const p of posts) {
      const resort = resolveResort(p);
      const lista = gruppi.get(resort);
      if (lista) lista.push(p);
      else gruppi.set(resort, [p]);
    }
    return [...gruppi.entries()]
      .map(([resort, lista]) => ({
        resort,
        posts: lista,
        views: somma(lista, "views"),
        likes: somma(lista, "likes"),
        comments: somma(lista, "comments"),
        shares: somma(lista, "shares"),
      }))
      .sort((a, b) => b.posts.length - a.posts.length);
  }, [posts]);

  const maxVolume = Math.max(1, ...righe.map((r) => r.posts.length));

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Per resort</div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-left font-medium">Resort</th>
              <th className="py-1 text-left font-medium">Volume</th>
              <th className="py-1 text-left font-medium">Sentiment</th>
              <th className="py-1 text-right font-medium">Visual.</th>
              <th className="py-1 text-right font-medium">Like</th>
              <th className="py-1 text-right font-medium">Comm.</th>
              <th className="py-1 text-right font-medium">Cond.</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => (
              <tr key={r.resort} className="border-t border-border/60">
                <td className="py-2 pr-3">
                  <span className={r.resort === GENERIC_RESORT ? "text-muted-foreground" : ""}>
                    {r.resort}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(r.posts.length / maxVolume) * 100}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{r.posts.length}</span>
                  </div>
                </td>
                <td className="w-32 py-2 pr-3">
                  <SentimentBar posts={r.posts} />
                </td>
                <td className="py-2 text-right tabular-nums">{nf.format(r.views)}</td>
                <td className="py-2 text-right tabular-nums">{nf.format(r.likes)}</td>
                <td className="py-2 text-right tabular-nums">{nf.format(r.comments)}</td>
                <td className="py-2 text-right tabular-nums">{nf.format(r.shares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Il resort viene dal geotag o dalla scelta manuale, altrimenti dal canale hashtag di
        provenienza, altrimenti dal testo del post. Quello che non nomina nessuna struttura resta in
        &laquo;{GENERIC_RESORT}&raquo;: è contenuto di brand, non un errore.
      </p>
    </div>
  );
}

// ------------------------------------------------------------- AI: per utente

type OrdineUtenti = "volume" | "views";

function UtentiBreakdown({ posts }: { posts: Post[] }) {
  const [ordine, setOrdine] = useState<OrdineUtenti>("volume");
  const [limite, setLimite] = useState(10);
  const [soloProlifici, setSoloProlifici] = useState(false);

  const righe = useMemo(() => {
    const gruppi = new Map<string, Post[]>();
    for (const p of posts) {
      const autore = p.handle || "(senza autore)";
      const lista = gruppi.get(autore);
      if (lista) lista.push(p);
      else gruppi.set(autore, [p]);
    }
    return [...gruppi.entries()]
      .map(([autore, lista]) => ({ autore, posts: lista, views: somma(lista, "views") }))
      .sort((a, b) => (ordine === "volume" ? b.posts.length - a.posts.length : b.views - a.views));
  }, [posts, ordine]);

  // "Utenti con più contenuti" è una soglia, non un ordinamento: chi ha
  // pubblicato una volta sola è la coda lunga (la maggioranza degli autori) e
  // di solito non è quello che si sta cercando.
  const filtrate = soloProlifici ? righe.filter((r) => r.posts.length > 1) : righe;
  const visibili = filtrate.slice(0, limite);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          Per utente — {righe.length} autori
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Ordina per</span>
            <select
              value={ordine}
              onChange={(e) => setOrdine(e.target.value as OrdineUtenti)}
              className="rounded border border-border bg-background px-1 py-0.5 outline-none focus:border-primary"
            >
              <option value="volume">contenuti</option>
              <option value="views">visualizzazioni</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={soloProlifici}
              onChange={(e) => setSoloProlifici(e.target.checked)}
            />
            solo con più di un contenuto
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Mostra</span>
            <select
              value={limite}
              onChange={(e) => setLimite(Number(e.target.value))}
              className="rounded border border-border bg-background px-1 py-0.5 outline-none focus:border-primary"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={9999}>tutti</option>
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-left font-medium">Autore</th>
              <th className="py-1 text-left font-medium">Contenuti</th>
              <th className="py-1 text-left font-medium">Sentiment</th>
              <th className="py-1 text-right font-medium">Visual.</th>
            </tr>
          </thead>
          <tbody>
            {visibili.map((r) => (
              <tr key={r.autore} className="border-t border-border/60">
                <td className="py-2 pr-3">@{r.autore}</td>
                <td className="py-2 pr-3 tabular-nums">{r.posts.length}</td>
                <td className="w-32 py-2 pr-3">
                  <SentimentBar posts={r.posts} />
                </td>
                <td className="py-2 text-right tabular-nums">{nf.format(r.views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtrate.length > visibili.length && (
        <p className="text-[10px] text-muted-foreground">
          Mostrati {visibili.length} autori su {filtrate.length}.
        </p>
      )}
    </div>
  );
}
// Ritaglio di testo attorno alla prima occorrenza cercata: le trascrizioni
// arrivano anche a diverse migliaia di caratteri, mostrarle intere nella card
// non direbbe comunque dov'è il match.
function excerptAround(text: string, query: string, radius = 45): string {
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function PostCard({
  post,
  search,
  updating,
  updatingResort,
  updatingSentiment,
  onToggleVerification,
  onChangeResort,
  onChangeSentiment,
}: {
  post: Post;
  search: string;
  updating: boolean;
  updatingResort: boolean;
  updatingSentiment: boolean;
  onToggleVerification: () => void;
  onChangeResort: (resort: string) => void;
  onChangeSentiment: (sentiment: Sentiment | null) => void;
}) {
  const status = post.verificationStatus || verifyBluserenaPost(post.caption);
  const sentiment = post.sentiment;
  const resort = resolveResort(post);
  const [showTranscript, setShowTranscript] = useState(false);

  // Quando un post è in lista per una parola che sta solo nell'audio o nel
  // testo a video, la card non mostrerebbe da nessuna parte il perché e il
  // risultato sembrerebbe sbagliato: qui si vede il punto esatto del match.
  // Nessuno snippet se la parola è già nella caption, che è visibile sopra.
  const hiddenMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    if (post.caption?.toLowerCase().includes(q)) return null;

    const transcript = post.audioAnalysis?.transcript;
    if (transcript?.toLowerCase().includes(q)) {
      return { source: "audio" as const, text: excerptAround(transcript, q) };
    }
    const onScreen = post.ocrData?.textOnScreen;
    if (onScreen?.toLowerCase().includes(q)) {
      return { source: "ocr" as const, text: excerptAround(onScreen, q) };
    }
    return null;
  }, [search, post.caption, post.audioAnalysis?.transcript, post.ocrData?.textOnScreen]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="aspect-square bg-muted overflow-hidden">
        <SocialEmbed url={post.url} />
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <PlatformIcon platform={post.platform} className="size-3" />
            {post.platform}
          </span>
          <a href={post.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Apri ↗
          </a>
        </div>

        <div className="text-[11px] text-muted-foreground">
          {/* L'autore del post, non il canale hashtag da cui è stato pescato:
              quello raccontava il resort una seconda volta (la card ha già la
              location) e nascondeva l'unica informazione che qui manca, cioè
              chi ha pubblicato. Il canale resta nel tooltip, serve solo a
              capire da quale hashtag è arrivato. */}
          <div title={`Trovato nel canale ${post.canaleName}`}>@{post.handle || "sconosciuto"}</div>
          {post.date && <div>{new Date(post.date).toLocaleDateString("it-IT")}</div>}
        </div>

        {post.caption && <p className="text-[11px] line-clamp-2 text-muted-foreground">{post.caption}</p>}

        {hiddenMatch && (
          <p
            className={`flex items-start gap-1.5 text-[10px] italic line-clamp-2 ${
              hiddenMatch.source === "audio"
                ? "text-purple-700 dark:text-purple-400"
                : "text-amber-700 dark:text-amber-400"
            }`}
          >
            {hiddenMatch.source === "audio" ? (
              <Headphones className="size-3 shrink-0 mt-0.5" />
            ) : (
              <Zap className="size-3 shrink-0 mt-0.5" />
            )}
            <span>{hiddenMatch.text}</span>
          </p>
        )}

        <div className="space-y-1.5 border-t border-border pt-2">
          {/* Sentiment modificabile a mano: la scelta viene marcata come
              manuale e l'analisi notturna non la sovrascrive più. "Non
              analizzato" toglie la marcatura e rimette il post in coda. */}
          <div className="flex items-center gap-1.5">
            <Smile className="size-3 text-muted-foreground" />
            <select
              value={sentiment ?? ""}
              disabled={updatingSentiment}
              onChange={(e) => onChangeSentiment((e.target.value || null) as Sentiment | null)}
              aria-label="Sentiment del post"
              title={
                post.sentimentData?.status === "manual"
                  ? "Impostato a mano: l'analisi automatica non lo tocca"
                  : "Sentiment dall'analisi automatica"
              }
              className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] text-muted-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">❓ Non analizzato</option>
              <option value="positive">😊 Positivo</option>
              <option value="negative">😞 Negativo</option>
              <option value="neutral">😐 Neutrale</option>
            </select>
            {post.sentimentData?.status === "manual" && (
              <span className="shrink-0 text-[9px] text-muted-foreground">manuale</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {status === "confirmed" ? (
              <Check className="size-3 text-green-600" />
            ) : (
              <AlertCircle className="size-3 text-yellow-600" />
            )}
            <button
              onClick={onToggleVerification}
              disabled={updating}
              className={`text-[10px] px-1.5 py-0.5 rounded-full transition hover:opacity-80 disabled:opacity-50 ${
                status === "confirmed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              }`}
              title="Click per cambiare lo stato di verifica"
            >
              BS {status === "confirmed" ? "Confermato" : "Non confermato"}
            </button>
          </div>

          {post.topics && post.topics.length > 0 && (
            <div className="flex items-start gap-1.5">
              <TagIcon className="size-3 text-muted-foreground mt-0.5" />
              <div className="flex flex-wrap gap-1">
                {post.topics.slice(0, 3).map((topic, i) => (
                  <span
                    key={i}
                    className="inline-block text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full"
                  >
                    {topic}
                  </span>
                ))}
                {post.topics.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">+{post.topics.length - 3}</span>
                )}
              </div>
            </div>
          )}

          {/* Resort: la tendina mostra l'attribuzione corrente da qualunque
              fonte arrivi (geotag, canale, testo) e permette di correggerla a
              mano. Il valore selezionato è quello risolto, così si vede subito
              in quale gruppo il post finisce nelle statistiche. */}
          <div className="flex items-start gap-1.5">
            <MapPin className="size-3 text-muted-foreground mt-1" />
            <select
              value={resort === GENERIC_RESORT ? "" : resort}
              disabled={updatingResort}
              onChange={(e) => onChangeResort(e.target.value)}
              aria-label="Resort del post"
              className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] text-muted-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">{GENERIC_RESORT}</option>
              {RESORT_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {post.ocrData?.textOnScreen && (
            <div className="flex items-center gap-1.5">
              <Zap className="size-3 text-amber-600 dark:text-amber-500" />
              <span className="text-[9px] text-amber-700 dark:text-amber-400">OCR</span>
            </div>
          )}

          {post.audioAnalysis?.transcript && (
            <div className="space-y-1">
              {/* La trascrizione arriva a qualche migliaio di caratteri: sta
                  chiusa per non allungare la card, e si apre qui invece che
                  in un popup perché va letta accanto al video. */}
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                aria-expanded={showTranscript}
                className="flex items-center gap-1.5 text-purple-700 hover:opacity-80 dark:text-purple-400"
              >
                <Headphones className="size-3 text-purple-600 dark:text-purple-500" />
                <span className="text-[9px]">
                  Audio — {showTranscript ? "nascondi" : "leggi"} trascrizione
                </span>
              </button>

              {showTranscript && (
                <div className="rounded border border-border bg-muted/40 p-2">
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                    {post.audioAnalysis.transcript}
                  </p>
                  {(post.audioAnalysis.language || post.audioAnalysis.durationSec) && (
                    <p className="mt-1 text-[9px] text-muted-foreground/70">
                      {[
                        post.audioAnalysis.language,
                        post.audioAnalysis.durationSec
                          ? `${Math.round(post.audioAnalysis.durationSec)}s`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
