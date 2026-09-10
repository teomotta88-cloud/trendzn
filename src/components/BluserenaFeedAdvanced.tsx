import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { LazyEmbed, PlatformIcon } from "@/components/SocialEmbed";
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
  Calendar,
  X,
  Loader2,
  Wand2,
  Star,
} from "lucide-react";
import type { CanaleInspo, AccountRef } from "@/lib/trends";
// recharts "raw", non il wrapper ChartContainer di shadcn: è lo stesso stile
// del grafico "Timeline Sentiment" di /ai-intelligence (Line/CartesianGrid/
// Tooltip/Legend nativi), che questo pannello riproduce a pixel il più
// fedelmente possibile — vedi SentimentTimeline più sotto.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

// Etichetta dell'autore, condivisa fra il filtro (applicaFiltri) e il
// raggruppamento in UtentiBreakdown: devono restare identiche, o cliccare
// "(senza autore)" nella tabella non filtrerebbe gli stessi post che vi
// appaiono raggruppati.
function authorLabel(post: Pick<Post, "handle">): string {
  return post.handle || "(senza autore)";
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

// Quante card mostrare per volta. La griglia è a 3 colonne su schermo largo,
// quindi 24 sono 8 righe piene: abbastanza da scorrere un po' prima di dover
// cliccare, e poche abbastanza da rendere immediato il cambio di filtro.
// Alzarlo o abbassarlo è una riga sola.
const PAGINA = 24;

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

export function BluserenaFeedAdvanced({ jsonUrl, tab, setTab }: BluserenaFeedAdvancedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  // La casella resta reattiva mentre il filtro vero gira in ritardo: senza,
  // ogni tasto premuto rifiltra 1310 post e ricostruisce la griglia, e il
  // campo di testo sembra incollato.
  const searchDiffuso = useDeferredValue(search);
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  // Il lavoro su questa pagina si fa sui post confermati: gli altri sono
  // omonimie da hashtag. Il filtro resta comunque a portata di click.
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("confirmed");
  const [monthFilter, setMonthFilter] = useState<MonthFilter>("all");
  const [resortFilter, setResortFilter] = useState<ResortFilter>("all");
  // Impostato cliccando un autore nella tabella "Per utente" di AI
  // Intelligence, non da un controllo nel pannello Filtri: gli autori sono
  // 168, una tendina sarebbe inutile quando si può cliccare direttamente il
  // nome che interessa. Stringa vuota = nessun filtro.
  const [authorFilter, setAuthorFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [updatingUrl, setUpdatingUrl] = useState<string | null>(null);
  // Esito dell'ultimo avvio della pipeline di analisi. Resta a schermo finché
  // non si ripreme: il lavoro vero gira su GitHub Actions e dura minuti,
  // quindi l'unica cosa che il feed può dire con onestà è "è partita", con il
  // link a dove guardare com'è finita.
  const [analisiStato, setAnalisiStato] = useState<
    | { fase: "invio" }
    | { fase: "avviata"; url: string }
    | { fase: "errore"; messaggio: string }
    | null
  >(null);
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

  // Lancia la pipeline di analisi sui post confermati che non l'hanno ancora
  // avuta: KPI + caption, trascrizione audio, testo on-screen, sentiment e
  // topic, in quest'ordine (il sentiment legge gli altri tre, quindi va per
  // ultimo).
  //
  // "Solo la prima volta" non è deciso qui: ogni script scrive sul post un
  // record versionato e salta chi ce l'ha già. Premere due volte di fila non
  // rifà quindi il lavoro, e non serve tenere una lista di cosa è già stato
  // analizzato — la verità sta nello store, non in questo componente.
  const avviaAnalisi = async () => {
    setAnalisiStato({ fase: "invio" });
    try {
      const res = await fetch("/api/public/hooks/trigger-analyze-new-bsconfirmed", {
        method: "POST",
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        setAnalisiStato({
          fase: "errore",
          messaggio: body?.error ?? `errore ${res.status}`,
        });
        return;
      }

      setAnalisiStato({ fase: "avviata", url: body.runsUrl });
    } catch (err) {
      setAnalisiStato({ fase: "errore", messaggio: String(err).slice(0, 200) });
    }
  };

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
    const newStatus: VerificationStatus =
      currentStatus === "confirmed" ? "unconfirmed" : "confirmed";
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

      if (searchDiffuso) {
        const q = searchDiffuso.toLowerCase();
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

      if (authorFilter) {
        result = result.filter((p) => authorLabel(p) === authorFilter);
      }

      // Deduplica per ultima, sul risultato già filtrato: le copie di uno stesso
      // post condividono caption, data e stato, quindi passano o cadono insieme
      // nei filtri e quale copia sopravvive non cambia cosa si vede.
      return dedupeByContent(result);
    },
    [
      searchIndex,
      searchDiffuso,
      sentimentFilter,
      verificationFilter,
      dateFilter,
      monthFilter,
      resortFilter,
      authorFilter,
    ],
  );

  const filteredPosts = useMemo(() => applicaFiltri(posts), [posts, applicaFiltri]);

  // Quante card montare. La griglia intera sarebbe fino a 1310 card, e ognuna
  // porta con sé un embed del post: anche con LazyEmbed, che monta l'iframe
  // solo quando la card entra in viewport, restano 1310 sottoalberi di DOM da
  // costruire a ogni cambio di filtro. Mostrarne una pagina alla volta è ciò
  // che rende immediato il click su un filtro.
  //
  // NOTA: si pagina SOLO il rendering della griglia. AI Intelligence continua
  // a ricevere `filteredPosts` per intero, altrimenti le sue statistiche
  // cambierebbero premendo "Mostra altri", che sarebbe assurdo.
  const [visibili, setVisibili] = useState(PAGINA);

  // Cambiare filtro riparte dalla prima pagina: restare a "500 mostrati" dopo
  // aver ristretto a 12 post non avrebbe senso, e vanificherebbe il taglio.
  //
  // Le dipendenze sono i criteri di filtro, non `filteredPosts`: quell'array
  // cambia identità anche quando il polling ogni 30s rimpiazza `posts` con
  // contenuto identico (setPosts riceve sempre un array nuovo), quindi tenere
  // `filteredPosts` come dipendenza resettava "Mostra altri" a 24 da solo ogni
  // 30 secondi, indipendentemente da cosa stesse guardando l'utente — bug
  // riportato in produzione (10/09/2026).
  useEffect(() => {
    setVisibili(PAGINA);
  }, [
    searchDiffuso,
    sentimentFilter,
    verificationFilter,
    dateFilter,
    monthFilter,
    resortFilter,
    authorFilter,
  ]);

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
                <span
                  className={`text-lg font-semibold ${stats.total2026 > stats.total2025 ? "text-green-600" : "text-red-600"}`}
                >
                  {stats.total2026 - stats.total2025 > 0 ? "+" : ""}
                  {stats.total2026 - stats.total2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. sentiment</span>
                <span
                  className={`text-lg font-semibold ${stats.sentiment2026 > stats.sentiment2025 ? "text-green-600" : "text-red-600"}`}
                >
                  {stats.sentiment2026 - stats.sentiment2025 > 0 ? "+" : ""}
                  {stats.sentiment2026 - stats.sentiment2025}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Var. confirmed</span>
                <span
                  className={`text-lg font-semibold ${stats.confirmed2026 > stats.confirmed2025 ? "text-green-600" : "text-red-600"}`}
                >
                  {stats.confirmed2026 - stats.confirmed2025 > 0 ? "+" : ""}
                  {stats.confirmed2026 - stats.confirmed2025}
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

        {/* Filtro autore: non ha un controllo nel pannello Filtri (si imposta
            cliccando un nome in AI Intelligence), quindi senza questa chip
            resterebbe attivo senza modo di vedere che c'è o di toglierlo. */}
        {authorFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
              Autore: @{authorFilter}
              <button
                type="button"
                onClick={() => setAuthorFilter("")}
                aria-label={`Rimuovi il filtro sull'autore @${authorFilter}`}
                className="rounded-full p-0.5 hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}

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

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Analisi dei post confermati
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={avviaAnalisi}
                  disabled={analisiStato?.fase === "invio"}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-full font-medium bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                >
                  {analisiStato?.fase === "invio" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Wand2 className="size-3" />
                  )}
                  Analizza nuovi confermati
                </button>

                {analisiStato?.fase === "avviata" && (
                  <span className="text-xs text-muted-foreground">
                    Analisi avviata su GitHub Actions — dura qualche minuto.{" "}
                    <a
                      href={analisiStato.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Vedi l'avanzamento
                    </a>
                  </span>
                )}
                {analisiStato?.fase === "errore" && (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    Avvio fallito: {analisiStato.messaggio}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Recupera KPI e caption, trascrive audio e testo on-screen, poi analizza sentiment e
                topic. Ogni post viene analizzato una volta sola: quelli già fatti vengono saltati.
              </p>
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
            <AIInsights
              posts={filteredPosts}
              totaleNonFiltrato={uniqueTotal}
              activeAuthor={authorFilter}
              onSelectAuthor={(autore) =>
                setAuthorFilter((prev) => (prev === autore ? "" : autore))
              }
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPosts.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">
            Nessun post trovato
          </div>
        ) : (
          filteredPosts.slice(0, visibili).map((post) => (
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
              search={searchDiffuso}
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

      {visibili < filteredPosts.length && (
        <div className="flex flex-col items-center gap-2 py-4">
          <span className="text-xs text-muted-foreground">
            {visibili} di {filteredPosts.length} post mostrati
          </span>
          <button
            onClick={() => setVisibili((n) => n + PAGINA)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Mostra altri {Math.min(PAGINA, filteredPosts.length - visibili)}
          </button>
        </div>
      )}
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
  // Autore attualmente filtrato (stringa vuota = nessuno) e callback per
  // impostarlo: arrivano dal componente padre, che tiene lo stato e mostra
  // la chip rimovibile. Ripassati giù fino a UtentiBreakdown, dove si clicca.
  activeAuthor: string;
  onSelectAuthor: (autore: string) => void;
}

function AIInsights({ posts, totaleNonFiltrato, activeAuthor, onSelectAuthor }: AIInsightsProps) {
  // Elenco topic esteso: chiuso di default perché la coda è lunga (la maggior
  // parte dei topic compare una volta sola) e in cima stanno comunque quelli
  // che contano.
  const [tuttiITopic, setTuttiITopic] = useState(false);
  const confirmedPosts2025 = useMemo(
    () => posts.filter((p) => isInJulyAugustStandalone(p.date, 2025)),
    [posts],
  );
  const confirmedPosts2026 = useMemo(
    () => posts.filter((p) => isInJulyAugustStandalone(p.date, 2026)),
    [posts],
  );
  // Classifica COMPLETA dei topic: il taglio ai primi 5 si fa al rendering,
  // così l'elenco esteso non deve ricontare nulla e il totale mostrato sul
  // pulsante è quello vero. A parità di occorrenze ordina per nome, altrimenti
  // la coda lunga (la maggior parte dei topic compare una volta sola)
  // cambierebbe ordine a ogni render senza motivo.
  const getTopTopics = (posts: Post[]): { topic: string; count: number }[] => {
    const topicCounts: Record<string, number> = {};
    posts.forEach((p) => {
      p.topics?.forEach((topic) => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });
    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
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
  const sentiment2026 = getSentimentBreakdown(confirmedPosts2026);
  const sentiment2025 = getSentimentBreakdown(confirmedPosts2025);

  // Questo pannello nasce per il confronto anno su anno, ma il filtro di
  // periodo può restringere i post a una sola annata: allora il secchio
  // dell'altro anno è vuoto e ogni delta diventa un paragone con lo zero.
  // È il motivo per cui, filtrando su Lug-Ago 2025, si leggeva "0 (0%)" sotto
  // un titolo fisso "Lug-Ago 2026" e un delta di -88pp: i numeri erano quelli
  // di un anno che non era a schermo.
  //
  // Gli anni si deducono dai post invece di farsi passare il filtro attivo:
  // anche un filtro per resort o per autore può lasciare una sola annata, e
  // in quel caso il confronto è altrettanto privo di senso.
  const ha2025 = confirmedPosts2025.length > 0;
  const ha2026 = confirmedPosts2026.length > 0;
  const confrontoPossibile = ha2025 && ha2026;
  const periodo = confrontoPossibile ? "Lug-Ago 25-26" : ha2026 ? "Lug-Ago 2026" : "Lug-Ago 2025";

  // Le card principali seguono ciò che è davvero a schermo, non un anno
  // cablato: `confermati` è l'insieme filtrato dentro le due finestre.
  const sentimentMostrato = getSentimentBreakdown(confermati);
  const topTopics = getTopTopics(confermati);
  const avgViewsMostrato =
    confermati.length > 0
      ? Math.round(confermati.reduce((sum, p) => sum + (p.views || 0), 0) / confermati.length)
      : 0;
  const avgViews2026 =
    confirmedPosts2026.length > 0
      ? Math.round(
          confirmedPosts2026.reduce((sum, p) => sum + (p.views || 0), 0) /
            confirmedPosts2026.length,
        )
      : 0;
  const avgViews2025 =
    confirmedPosts2025.length > 0
      ? Math.round(
          confirmedPosts2025.reduce((sum, p) => sum + (p.views || 0), 0) /
            confirmedPosts2025.length,
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Sentiment dei post a schermo */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Sentiment {periodo}</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>😊 Positivi</span>
              <span className="font-semibold text-green-600">
                {sentimentMostrato.positive} (
                {Math.round((sentimentMostrato.positive / sentimentMostrato.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😐 Neutrali</span>
              <span className="font-semibold text-slate-600">
                {sentimentMostrato.neutral} (
                {Math.round((sentimentMostrato.neutral / sentimentMostrato.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>😞 Negativi</span>
              <span className="font-semibold text-red-600">
                {sentimentMostrato.negative} (
                {Math.round((sentimentMostrato.negative / sentimentMostrato.analyzed) * 100) || 0}%)
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Analizzati</span>
              <span className="font-semibold">
                {sentimentMostrato.analyzed}/{confermati.length} (
                {Math.round((sentimentMostrato.analyzed / confermati.length) * 100) || 0}%)
              </span>
            </div>
          </div>
        </div>

        {/* Confronto anno su anno: ha senso solo con entrambe le annate a
            schermo, altrimenti confronterebbe un anno con un insieme vuoto. */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Confronto Sentiment</div>
          {confrontoPossibile ? (
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
                <span
                  className={`font-semibold ${
                    (sentiment2026.positive / sentiment2026.analyzed || 0) >
                    (sentiment2025.positive / sentiment2025.analyzed || 0)
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {Math.round(
                    ((sentiment2026.positive / sentiment2026.analyzed || 0) -
                      (sentiment2025.positive / sentiment2025.analyzed || 0)) *
                      100,
                  )}
                  pp
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A schermo c'è solo {periodo}: il confronto anno su anno compare selezionando il
              periodo Lug-Ago 25-26.
            </p>
          )}
        </div>
      </div>

      {/* Timeline sentiment: stessa logica delle card sopra ma spalmata nel
          tempo, sui post che passano i filtri attivi (compreso l'eventuale
          autore selezionato in tabella). */}
      <SentimentTimeline posts={posts} />

      {/* Topic: i primi 5 di default, l'elenco completo a richiesta. Sui dati
          attuali i topic distinti sono oltre 250, quindi da espansi vanno in
          un contenitore che scorre da solo: srotolarli tutti nel pannello
          spingerebbe fuori schermo tutto quello che viene dopo. */}
      {topTopics.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {tuttiITopic ? `Tutti i ${topTopics.length} topic` : "Topic Top 5"} ({periodo})
            </div>
            {topTopics.length > 5 && (
              <button
                onClick={() => setTuttiITopic((v) => !v)}
                className="text-xs text-primary hover:underline underline-offset-2 shrink-0"
              >
                {tuttiITopic ? "Mostra solo i primi 5" : `Mostra tutti (${topTopics.length})`}
              </button>
            )}
          </div>
          <div
            className={tuttiITopic ? "space-y-1.5 max-h-72 overflow-y-auto pr-1" : "space-y-1.5"}
          >
            {(tuttiITopic ? topTopics : topTopics.slice(0, 5)).map((item, i) => (
              <div key={item.topic} className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground shrink-0">#{i + 1}</span>
                <span className="flex-1 mx-2 truncate" title={item.topic}>
                  {item.topic}
                </span>
                <span className="font-semibold text-primary shrink-0">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Engagement Metrics: due colonne solo quando ci sono due anni da
          confrontare, altrimenti una delle due mostrerebbe zero. */}
      {confrontoPossibile ? (
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
      ) : (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Avg Views {periodo}</div>
          <div className="text-lg font-semibold">{avgViewsMostrato.toLocaleString()}</div>
        </div>
      )}

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

      <UtentiBreakdown
        posts={confermati}
        activeAuthor={activeAuthor}
        onSelectAuthor={onSelectAuthor}
      />

      {/* Key Insights: la frase confronta le due annate, quindi si scrive solo
          quando ci sono entrambe. Con una sola a schermo si dice cosa c'è. */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
        {confrontoPossibile ? (
          <p>
            <strong>Insight:</strong> Lug-Ago 2026 ha {total2026 > total2025 ? "+" : ""}
            {total2026 - total2025} post BSConfirmed rispetto a Lug-Ago 2025 ({total2025}).
            {sentiment2026.analyzed > sentiment2025.analyzed && (
              <span>
                {" "}
                L'analisi sentiment è cresciuta di +
                {sentiment2026.analyzed - sentiment2025.analyzed} post.
              </span>
            )}
          </p>
        ) : (
          <p>
            <strong>Insight:</strong> {periodo} ha {confermati.length} post, di cui{" "}
            {sentimentMostrato.analyzed} con sentiment analizzato.
          </p>
        )}
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

// --------------------------------------------------- AI: timeline sentiment

// Stessi colori, stessa aggregazione per giorno e stesso LineChart "raw" del
// grafico "Timeline Sentiment" già esistente su /ai-intelligence
// (src/routes/ai-intelligence.index.tsx, SENTIMENT_COLORS + timelineMap):
// qui è lo stesso identico grafico, applicato ai post che passano i filtri
// di QUESTO pannello invece che a quelli di quella pagina.
const SENTIMENT_TIMELINE_COLORS = {
  positive: "#10b981",
  neutral: "#6b7280",
  negative: "#ef4444",
};

function SentimentTimeline({ posts }: { posts: Post[] }) {
  const dati = useMemo(() => {
    // Un punto per giorno, non per mese: è la stessa granularità
    // dell'originale, e a differenza del filtro mesi qui non riempie i
    // giorni senza post — un giorno senza dati è un buco nella linea, non
    // uno zero.
    //
    // Solo i post CON sentiment, come nell'originale: la timeline non
    // rappresenta i non analizzati, a differenza delle card più sopra.
    const timelineMap = new Map<string, { positive: number; negative: number; neutral: number }>();
    for (const p of posts) {
      if (!p.date || !p.sentiment) continue;
      const date = p.date.slice(0, 10);
      const entry = timelineMap.get(date) || { positive: 0, negative: 0, neutral: 0 };
      entry[p.sentiment]++;
      timelineMap.set(date, entry);
    }
    return [...timelineMap.entries()]
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [posts]);

  if (dati.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Calendar className="size-3.5" />
        Timeline Sentiment
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={dati}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="positive"
            stroke={SENTIMENT_TIMELINE_COLORS.positive}
            name="Positivi"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="neutral"
            stroke={SENTIMENT_TIMELINE_COLORS.neutral}
            name="Neutrali"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="negative"
            stroke={SENTIMENT_TIMELINE_COLORS.negative}
            name="Negativi"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
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
          espongono ancora).
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

// Criteri di ordinamento condivisi da "Per resort" e "Per utente": le due
// tabelle rispondono alle stesse domande ("chi pubblica di più", "chi raccoglie
// più negativi") e avere due controlli diversi le renderebbe difficili da
// confrontare.
type OrdineSezione = "volume" | "views" | "positive" | "neutral" | "negative";

const ETICHETTE_ORDINE: Record<OrdineSezione, string> = {
  volume: "contenuti",
  views: "visualizzazioni",
  positive: "post positivi",
  neutral: "post neutrali",
  negative: "post negativi",
};

// Ordina per NUMERO di post con quel sentiment, non per percentuale: la
// domanda dietro "ordina per negativi" è quasi sempre "dove sta il grosso del
// malcontento", e una quota alta su tre post non è quello. La composizione in
// percentuale resta comunque leggibile nella barra sentiment di ogni riga.
//
// A parità di valore vince il volume: due resort con un solo post negativo a
// testa restano in ordine di grandezza invece che nell'ordine casuale in cui
// sono stati incontrati.
function ordinaPerCriterio<T extends { posts: Post[]; views: number }>(
  righe: T[],
  ordine: OrdineSezione,
): T[] {
  const valore = (r: T) => {
    if (ordine === "volume") return r.posts.length;
    if (ordine === "views") return r.views;
    return r.posts.filter((p) => p.sentiment === ordine).length;
  };
  return [...righe].sort((a, b) => valore(b) - valore(a) || b.posts.length - a.posts.length);
}

// Tendina di ordinamento, identica nelle due tabelle.
function SelettoreOrdine({
  valore,
  onChange,
  id,
}: {
  valore: OrdineSezione;
  onChange: (ordine: OrdineSezione) => void;
  id: string;
}) {
  return (
    <label className="flex items-center gap-1" htmlFor={id}>
      <span className="text-muted-foreground">Ordina per</span>
      <select
        id={id}
        value={valore}
        onChange={(e) => onChange(e.target.value as OrdineSezione)}
        className="rounded border border-border bg-background px-1 py-0.5 outline-none focus:border-primary"
      >
        {(Object.keys(ETICHETTE_ORDINE) as OrdineSezione[]).map((k) => (
          <option key={k} value={k}>
            {ETICHETTE_ORDINE[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResortBreakdown({ posts }: { posts: Post[] }) {
  const [ordine, setOrdine] = useState<OrdineSezione>("volume");

  const righe = useMemo(() => {
    const gruppi = new Map<string, Post[]>();
    for (const p of posts) {
      const resort = resolveResort(p);
      const lista = gruppi.get(resort);
      if (lista) lista.push(p);
      else gruppi.set(resort, [p]);
    }
    const base = [...gruppi.entries()].map(([resort, lista]) => ({
      resort,
      posts: lista,
      views: somma(lista, "views"),
      likes: somma(lista, "likes"),
      comments: somma(lista, "comments"),
      shares: somma(lista, "shares"),
    }));
    return ordinaPerCriterio(base, ordine);
  }, [posts, ordine]);

  // La barra del volume resta proporzionale al massimo di POST, anche quando
  // l'ordinamento è un altro: è la scala della colonna "Volume", non del
  // criterio scelto, e cambiarla farebbe sembrare che i numeri cambino.
  const maxVolume = Math.max(1, ...righe.map((r) => r.posts.length));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Per resort</div>
        <div className="text-[10px]">
          <SelettoreOrdine id="ordine-resort" valore={ordine} onChange={setOrdine} />
        </div>
      </div>

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

function UtentiBreakdown({
  posts,
  activeAuthor,
  onSelectAuthor,
}: {
  posts: Post[];
  activeAuthor: string;
  onSelectAuthor: (autore: string) => void;
}) {
  const [ordine, setOrdine] = useState<OrdineSezione>("volume");
  const [limite, setLimite] = useState(10);
  const [soloProlifici, setSoloProlifici] = useState(false);

  const righe = useMemo(() => {
    const gruppi = new Map<string, Post[]>();
    for (const p of posts) {
      const autore = authorLabel(p);
      const lista = gruppi.get(autore);
      if (lista) lista.push(p);
      else gruppi.set(autore, [p]);
    }
    const base = [...gruppi.entries()].map(([autore, lista]) => ({
      autore,
      posts: lista,
      views: somma(lista, "views"),
    }));
    return ordinaPerCriterio(base, ordine);
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
          <SelettoreOrdine id="ordine-utenti" valore={ordine} onChange={setOrdine} />
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
            {visibili.map((r) => {
              const attivo = r.autore === activeAuthor;
              return (
                <tr
                  key={r.autore}
                  className={`border-t border-border/60 ${attivo ? "bg-primary/5" : ""}`}
                >
                  <td className="py-2 pr-3">
                    {/* Filtra il feed e questo stesso pannello su questo
                        autore; ricliccare lo stesso nome toglie il filtro,
                        così la tabella resta reversibile senza dover cercare
                        la chip in cima alla pagina. */}
                    <button
                      type="button"
                      onClick={() => onSelectAuthor(r.autore)}
                      aria-pressed={attivo}
                      title={
                        attivo
                          ? "Clicca per togliere il filtro"
                          : `Mostra solo i post di @${r.autore}`
                      }
                      className={`hover:underline ${attivo ? "font-semibold text-primary" : ""}`}
                    >
                      @{r.autore}
                    </button>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.posts.length}</td>
                  <td className="w-32 py-2 pr-3">
                    <SentimentBar posts={r.posts} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{nf.format(r.views)}</td>
                </tr>
              );
            })}
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
        <LazyEmbed url={post.url} />
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <PlatformIcon platform={post.platform} className="size-3" />
            {post.platform}
            {/* Post inserito a mano (vedi scripts/add-manual-tiktok-post.mjs)
                e poi ripescato DA SOLO da una fonte automatica: conferma
                indipendente che il post è reale e ancora raggiungibile, non
                solo un URL inserito una tantum e mai più verificato. */}
            {post.manualAdd?.confirmedAt && (
              <span
                title={`Aggiunto a mano il ${new Date(post.manualAdd.addedAt).toLocaleDateString("it-IT")}, confermato dallo scraping il ${new Date(post.manualAdd.confirmedAt).toLocaleDateString("it-IT")}`}
              >
                <Star className="size-3 text-amber-500 fill-amber-500" />
              </span>
            )}
          </span>
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
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

        {post.caption && (
          <p className="text-[11px] line-clamp-2 text-muted-foreground">{post.caption}</p>
        )}

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
                  <span className="text-[9px] text-muted-foreground">
                    +{post.topics.length - 3}
                  </span>
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
