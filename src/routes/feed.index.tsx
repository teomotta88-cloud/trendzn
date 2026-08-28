import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Zap, Flame, Infinity as InfinityIcon, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CanaliInspoView } from "./canali-inspo.index";

export const Route = createFileRoute("/feed/")({
  component: FeedPage,
});

export function FeedPageToggle({
  tab,
  setTab,
  canaliLabel = "Canali Inspo",
}: {
  tab: "feed" | "canali";
  setTab: (t: "feed" | "canali") => void;
  canaliLabel?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["canali", "feed"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          style={{
            padding: "5px 14px",
            borderRadius: 20,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: tab === t ? 700 : 400,
            background: tab === t ? "#1e293b" : "transparent",
            color: tab === t ? "#fff" : "#64748b",
            transition: "all 0.15s",
          }}
        >
          {t === "canali" ? canaliLabel : "Feed"}
        </button>
      ))}
    </div>
  );
}

function FeedPage() {
  const [tab, setTab] = useState<"feed" | "canali">("canali");
  return tab === "canali" ? (
    <CanaliInspoView tab={tab} setTab={setTab} />
  ) : (
    <TrendzFeed tab={tab} setTab={setTab} />
  );
}

const TRENDS_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/trends.json";

const GITHUB_SYNC_ENDPOINT = "/api/public/hooks/trigger-sync-canali-feed";

interface Account {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
  imageUrl?: string | null;
}

interface Canale {
  id: string;
  name: string;
  accounts: Account[];
}

type TrendsData = Record<string, Canale[]>;

interface Post {
  url: string;
  handle: string;
  platform: string;
  canaleName: string;
  date: string | null;
  caption: string | null;
  imageUrl: string | null;
}

function isPostUrl(url: string): boolean {
  return /\/p\/|\/reel\/|\/reels\/|\/video\/|\/videos\/|\/photo\/|\/photos\/|\/watch\/|\/tv\/|\/status\/|\/posts\/|permalink\.php|story_fbid=/.test(
    url,
  );
}

function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}

function getPlatform(url: string): string {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/linkedin\.com/.test(url)) return "linkedin";
  if (/x\.com|twitter\.com/.test(url)) return "x";
  return "web";
}

function getEmbedUrl(url: string): string | null {
  const ig = url.match(/instagram\.com\/(p|reel|reels|tv)\/([^/?#]+)/);
  if (ig) return `https://www.instagram.com/${ig[1]}/${ig[2]}/embed/`;
  const tt = url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&/?#]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Intl.DateTimeFormat("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return "";
  }
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function postMatchesKeyword(post: Post, keyword: string): boolean {
  const q = normalizeKeyword(keyword);
  if (!q) return false;

  const haystack = [post.caption, post.handle, post.canaleName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    instagram: { bg: "#f0e6f6", text: "#7c3aed" },
    tiktok: { bg: "#e8f0fe", text: "#1a73e8" },
    youtube: { bg: "#fce8e8", text: "#d93025" },
    linkedin: { bg: "#e8f3ff", text: "#0a66c2" },
    x: { bg: "#e5e7eb", text: "#111827" },
    facebook: { bg: "#e7f0ff", text: "#1877f2" },
    web: { bg: "#f0f4f8", text: "#64748b" },
  };
  const c = colors[platform] || colors.web;
  const labels: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    x: "X",
    facebook: "Facebook",
    web: "Web",
  };
  return (
    <span
      style={{
        background: c.bg,
        color: c.text,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        textTransform: "uppercase",
      }}
    >
      {labels[platform] || platform}
    </span>
  );
}

// L'iframe viene montato quando la card entra (quasi) in viewport e SMONTATO
// quando se ne allontana: prima restava montato per sempre, così scorrendo il
// feed si accumulavano centinaia di iframe Instagram/TikTok/YouTube attivi e
// la pagina si bloccava (memoria + CPU), sia su desktop che su mobile.
function LazyEmbed({ embedUrl, height }: { embedUrl: string; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const isNear = entries[0].isIntersecting;
        setVisible(isNear);
        if (!isNear) setLoaded(false);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", background: "#f8f9fa", height }}>
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f8f9fa",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Caricamento…
        </div>
      )}
      {visible && (
        <iframe
          src={embedUrl}
          width="100%"
          height={height}
          frameBorder={0}
          allowFullScreen
          scrolling="no"
          loading="lazy"
          style={{ display: "block", border: "none", position: "relative" }}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}

type TrendSection = "trend-real-time" | "trend-attuali" | "trend-evergreen";

const TREND_SECTIONS: { section: TrendSection; label: string; icon: typeof Zap; color: string }[] =
  [
    { section: "trend-real-time", label: "Real Time", icon: Zap, color: "#d97706" },
    { section: "trend-attuali", label: "Attuali", icon: Flame, color: "#dc2626" },
    { section: "trend-evergreen", label: "Evergreen", icon: InfinityIcon, color: "#16a34a" },
  ];

function MarkAsTrendButtons({
  post,
  marked,
  onMarked,
}: {
  post: Post;
  marked: Set<TrendSection>;
  onMarked: (section: TrendSection) => void;
}) {
  const [loadingSection, setLoadingSection] = useState<TrendSection | null>(null);

  async function handleMark(section: TrendSection) {
    if (marked.has(section) || loadingSection) return;
    setLoadingSection(section);
    try {
      const res = await fetch("/api/public/hooks/submit-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          url: post.url,
          title: post.caption ? post.caption.slice(0, 200) : post.canaleName,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onMarked(section);
      } else if (res.status === 409) {
        onMarked(section);
      }
    } catch {
      // silenzioso: l'utente può ritentare
    } finally {
      setLoadingSection(null);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "8px 14px",
        borderTop: "1px solid #f1f1f1",
      }}
    >
      {TREND_SECTIONS.map(({ section, label, icon: Icon, color }) => {
        const isMarked = marked.has(section);
        const isLoading = loadingSection === section;
        return (
          <button
            key={section}
            onClick={() => handleMark(section)}
            disabled={isLoading}
            title={isMarked ? `Già in ${label}` : `Marca come ${label}`}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "5px 6px",
              borderRadius: 8,
              border: "1px solid " + (isMarked ? color : "#e2e8f0"),
              background: isMarked ? color + "1a" : "#fff",
              color: isMarked ? color : "#64748b",
              fontSize: 11,
              fontWeight: 600,
              cursor: isLoading ? "default" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {isMarked ? <Check size={12} /> : <Icon size={12} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PostCard({
  post,
  canaleName,
  marked,
  onMarked,
}: {
  post: Post;
  canaleName: string;
  marked: Set<TrendSection>;
  onMarked: (section: TrendSection) => void;
}) {
  const embedUrl = getEmbedUrl(post.url);
  const platform = post.platform || getPlatform(post.url);
  const heights: Record<string, number> = { instagram: 480, tiktok: 560, youtube: 315 };
  const h = heights[platform] || 400;
  const dateStr = formatDate(post.date);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid #f1f1f1",
        }}
      >
        <PlatformBadge platform={platform} />
        <span
          style={{
            fontSize: 12,
            color: "#94a3b8",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 120,
          }}
        >
          {canaleName}
        </span>
        {dateStr && (
          <span
            style={{ fontSize: 11, color: "#cbd5e1", marginLeft: "auto", whiteSpace: "nowrap" }}
          >
            {dateStr}
          </span>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Apri su ${platform}`}
          style={{
            marginLeft: dateStr ? 8 : "auto",
            display: "flex",
            alignItems: "center",
            color: "#94a3b8",
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {embedUrl ? (
        <LazyEmbed embedUrl={embedUrl} height={h} />
      ) : post.imageUrl ? (
        // Facebook non ha un embed pubblico semplice (servirebbe un App ID e
        // la review della Graph API): mostriamo l'anteprima immagine reale
        // del post già catturata dal sync, con link cliccabile sopra.
        <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
          <img
            src={post.imageUrl}
            alt=""
            style={{ display: "block", width: "100%", maxHeight: h, objectFit: "cover" }}
          />
        </a>
      ) : (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            padding: "20px 14px",
            color: "#3b82f6",
            fontSize: 13,
            textDecoration: "none",
            wordBreak: "break-all",
          }}
        >
          {post.url}
        </a>
      )}

      {post.caption && (
        <p
          style={{
            margin: 0,
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "#334155",
            borderTop: "1px solid #f1f1f1",
            maxHeight: "8em",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {decodeHtmlEntities(post.caption)}
        </p>
      )}

      <MarkAsTrendButtons post={post} marked={marked} onMarked={onMarked} />
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 14px",
        borderRadius: 99,
        border: active ? "none" : "1px solid #e2e8f0",
        background: active ? "#1e293b" : "#fff",
        color: active ? "#fff" : "#64748b",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

type SyncStatus = "idle" | "loading" | "success" | "error";
type SortOrder = "recenti" | "meno_recenti";

export function SyncButton({ endpoint, label: idleLabel }: { endpoint: string; label: string }) {
  const [status, setStatus] = useState<SyncStatus>("idle");

  const handleSync = async () => {
    setStatus("loading");
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      setStatus("success");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  };

  const label: Record<SyncStatus, string> = {
    idle: idleLabel,
    loading: "Sincronizzazione…",
    success: "✓ Avviato",
    error: "Errore — riprova",
  };
  const bg: Record<SyncStatus, string> = {
    idle: "#f1f5f9",
    loading: "#e2e8f0",
    success: "#dcfce7",
    error: "#fee2e2",
  };
  const color: Record<SyncStatus, string> = {
    idle: "#475569",
    loading: "#94a3b8",
    success: "#16a34a",
    error: "#dc2626",
  };

  return (
    <button
      onClick={handleSync}
      disabled={status === "loading"}
      style={{
        padding: "5px 14px",
        borderRadius: 99,
        border: "none",
        background: bg[status],
        color: color[status],
        fontSize: 13,
        fontWeight: 500,
        cursor: status === "loading" ? "default" : "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
      }}
    >
      {label[status]}
    </button>
  );
}

const PAGE_SIZE = 12;
const EXPORT_FEED_PPTX_ENDPOINT = "/api/public/hooks/export-feed-pptx";
const EMPTY_MARKED: Set<TrendSection> = new Set();

export function TrendzFeed({
  tab,
  setTab,
  jsonUrl = TRENDS_JSON_URL,
  dataKey = "canali_inspo",
  syncEndpoint = GITHUB_SYNC_ENDPOINT,
  canaliLabel,
  enableDateFilter = false,
  enableKeywordMonitor = false,
}: {
  tab: "feed" | "canali";
  setTab: (t: "feed" | "canali") => void;
  jsonUrl?: string;
  dataKey?: string;
  syncEndpoint?: string;
  canaliLabel?: string;
  enableDateFilter?: boolean;
  enableKeywordMonitor?: boolean;
}) {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recenti");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [markedByUrl, setMarkedByUrl] = useState<Record<string, Set<TrendSection>>>({});

  const keywordStorageKey = `${dataKey}:monitored-keywords`;
  const keywordSeenStorageKey = `${dataKey}:keyword-seen-urls`;

  const [keywordInput, setKeywordInput] = useState("");
  const [monitoredKeywords, setMonitoredKeywords] = useState<string[]>([]);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [seenByKeyword, setSeenByKeyword] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetch(jsonUrl)
      .then((r) => r.json())
      .then((decoded) => {
        setData(decoded);
      })
      .catch(() => setError("Impossibile caricare il feed."));
  }, [jsonUrl]);

  useEffect(() => {
    supabase
      .from("trend_submissions")
      .select("url, section")
      .in(
        "section",
        TREND_SECTIONS.map((t) => t.section),
      )
      .eq("status", "approved")
      .then(({ data: rows }) => {
        if (!rows) return;
        setMarkedByUrl((prev) => {
          const next = { ...prev };
          for (const row of rows as { url: string; section: TrendSection }[]) {
            const set = new Set(next[row.url] ?? []);
            set.add(row.section);
            next[row.url] = set;
          }
          return next;
        });
      });
  }, []);

  useEffect(() => {
    if (!enableKeywordMonitor) return;

    try {
      const storedKeywords = window.localStorage.getItem(keywordStorageKey);
      const storedSeen = window.localStorage.getItem(keywordSeenStorageKey);

      if (storedKeywords) setMonitoredKeywords(JSON.parse(storedKeywords));
      if (storedSeen) setSeenByKeyword(JSON.parse(storedSeen));
    } catch {
      // localStorage non disponibile o dati corrotti: ignoriamo
    }
  }, [enableKeywordMonitor, keywordStorageKey, keywordSeenStorageKey]);

  const handleMarked = (url: string, section: TrendSection) => {
    setMarkedByUrl((prev) => {
      const set = new Set(prev[url] ?? []);
      set.add(section);
      return { ...prev, [url]: set };
    });
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [platformFilter, search, sortOrder, dateFrom, dateTo, activeKeyword]);

  if (error)
    return <div style={{ padding: 40, color: "#ef4444", textAlign: "center" }}>{error}</div>;
  if (!data)
    return (
      <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>Caricamento feed…</div>
    );

  const allPosts: Post[] = [];
  for (const canale of data[dataKey] || []) {
    const name = canale.name || canale.id || "";
    for (const account of canale.accounts || []) {
      if (isPostUrl(account.url)) {
        allPosts.push({
          url: account.url,
          handle: account.handle,
          platform: account.platform || getPlatform(account.url),
          canaleName: name,
          date: account.date ?? null,
          caption: account.caption ?? null,
          imageUrl: account.imageUrl ?? null,
        });
      }
    }
  }

  const sorted = [...allPosts].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return sortOrder === "recenti" ? db - da : da - db;
  });

  const fromTime = enableDateFilter && dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const toTime = enableDateFilter && dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

  function getKeywordPostUrls(keyword: string): string[] {
    return allPosts.filter((post) => postMatchesKeyword(post, keyword)).map((post) => post.url);
  }

  function getNewKeywordCount(keyword: string): number {
    const currentUrls = getKeywordPostUrls(keyword);
    const seenUrls = new Set(seenByKeyword[keyword] ?? []);
    return currentUrls.filter((url) => !seenUrls.has(url)).length;
  }

  function persistKeywords(next: string[]) {
    setMonitoredKeywords(next);
    window.localStorage.setItem(keywordStorageKey, JSON.stringify(next));
  }

  function persistSeen(next: Record<string, string[]>) {
    setSeenByKeyword(next);
    window.localStorage.setItem(keywordSeenStorageKey, JSON.stringify(next));
  }

  function handleAddKeyword() {
    const keyword = normalizeKeyword(keywordInput);
    if (!keyword) return;

    if (monitoredKeywords.includes(keyword)) {
      setActiveKeyword(keyword);
      setKeywordInput("");
      return;
    }

    persistKeywords([...monitoredKeywords, keyword]);
    setActiveKeyword(keyword);
    setKeywordInput("");
  }

  function handleSelectKeyword(keyword: string) {
    const nextActiveKeyword = activeKeyword === keyword ? null : keyword;
    setActiveKeyword(nextActiveKeyword);

    const urls = getKeywordPostUrls(keyword);
    persistSeen({
      ...seenByKeyword,
      [keyword]: Array.from(new Set([...(seenByKeyword[keyword] ?? []), ...urls])),
    });
  }

  function handleRemoveKeyword(keyword: string) {
    const nextKeywords = monitoredKeywords.filter((item) => item !== keyword);
    const nextSeen = { ...seenByKeyword };
    delete nextSeen[keyword];

    persistKeywords(nextKeywords);
    persistSeen(nextSeen);

    if (activeKeyword === keyword) setActiveKeyword(null);
  }

  async function handleExportPptx(postsToExport: Post[], exportKeyword: string) {
    const keyword = normalizeKeyword(exportKeyword);

    if (!keyword) {
      window.alert("Inserisci o seleziona una keyword prima di esportare il PPT.");
      return;
    }

    if (postsToExport.length === 0) {
      window.alert("Nessun post da esportare per questa keyword.");
      return;
    }

    try {
      const res = await fetch(EXPORT_FEED_PPTX_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          title: `Feed ASPI Monitoring - ${keyword}`,
          posts: postsToExport.map((post) => ({
            url: post.url,
            handle: post.handle,
            platform: post.platform,
            canaleName: post.canaleName,
            date: post.date,
            caption: post.caption,
            imageUrl: post.imageUrl,
          })),
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || "Errore durante la generazione del PPT");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aspi-feed-${keyword}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(String(err));
    }
  }

  const filtered = sorted.filter((p) => {
    const matchPlatform = platformFilter === "tutti" || p.platform === platformFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      p.handle?.toLowerCase().includes(q) ||
      p.canaleName?.toLowerCase().includes(q) ||
      p.caption?.toLowerCase().includes(q);

    const matchKeyword = !activeKeyword || postMatchesKeyword(p, activeKeyword);

    let matchDate = true;
    if (fromTime !== null || toTime !== null) {
      const t = p.date ? new Date(p.date).getTime() : NaN;
      if (Number.isNaN(t)) matchDate = false;
      else if (fromTime !== null && t < fromTime) matchDate = false;
      else if (toTime !== null && t > toTime) matchDate = false;
    }

    return matchPlatform && matchSearch && matchKeyword && matchDate;
  });

  const visiblePosts = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const platforms = ["tutti", ...new Set(allPosts.map((p) => p.platform))];

  const pptKeyword = activeKeyword || search.trim();
  const pptPosts = pptKeyword ? sorted.filter((post) => postMatchesKeyword(post, pptKeyword)) : [];
  const canExportPptx = pptKeyword.trim().length > 0 && pptPosts.length > 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Feed</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Post recenti dai canali monitorati su Instagram, TikTok, LinkedIn e X.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SyncButton endpoint={syncEndpoint} label="↻ Sincronizza ora" />
        </div>
      </header>

      <div className="flex">
        <FeedPageToggle tab={tab} setTab={setTab} canaliLabel={canaliLabel} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        {enableKeywordMonitor && (
          <div className="flex w-full flex-wrap items-center gap-2 border-b border-border/60 pb-3">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddKeyword();
              }}
              placeholder="Inserisci keyword da monitorare…"
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
            />

            <button
              onClick={handleAddKeyword}
              disabled={!keywordInput.trim()}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Monitora keyword
            </button>

            {activeKeyword && (
              <button
                onClick={() => setActiveKeyword(null)}
                className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                Mostra tutti
              </button>
            )}

            {monitoredKeywords.length > 0 && (
              <div className="flex w-full flex-wrap gap-2 pt-1">
                {monitoredKeywords.map((keyword) => {
                  const newCount = getNewKeywordCount(keyword);
                  const active = activeKeyword === keyword;

                  return (
                    <div key={keyword} className="group relative inline-flex items-center">
                      <button
                        onClick={() => handleSelectKeyword(keyword)}
                        className={
                          "relative rounded-full px-4 py-2 pr-8 text-sm font-medium transition " +
                          (active
                            ? "bg-slate-900 text-white"
                            : "border border-border bg-card text-foreground hover:border-primary")
                        }
                      >
                        {keyword}
                        {newCount > 0 && (
                          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {newCount}
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => handleRemoveKeyword(keyword)}
                        title="Rimuovi keyword"
                        className="absolute right-2 text-xs text-muted-foreground opacity-60 transition hover:text-red-600 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <input
          placeholder="Cerca canale, account o nella caption…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-background/60 py-2 px-3 text-sm outline-none focus:border-primary"
        />

        <button
          onClick={() => handleExportPptx(pptPosts, pptKeyword)}
          disabled={!canExportPptx}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            canExportPptx
              ? `Esporta ${pptPosts.length} post in PPT`
              : "Inserisci una keyword nella ricerca o seleziona una keyword monitorata"
          }
        >
          Esporta PPT{canExportPptx ? ` (${pptPosts.length})` : ""}
        </button>

        <div className="flex gap-2 flex-wrap">
          {platforms.map((p) => (
            <FilterPill
              key={p}
              label={p === "tutti" ? `Tutti (${allPosts.length})` : p}
              active={platformFilter === p}
              onClick={() => setPlatformFilter(p)}
            />
          ))}
        </div>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="rounded-lg border border-border bg-background/60 py-2 px-3 text-sm text-muted-foreground outline-none cursor-pointer"
        >
          <option value="recenti">Più recenti</option>
          <option value="meno_recenti">Meno recenti</option>
        </select>
        {enableDateFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Dal</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-border bg-background/60 py-2 px-3 text-sm text-muted-foreground outline-none focus:border-primary"
            />
            <label className="text-xs text-muted-foreground">al</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-border bg-background/60 py-2 px-3 text-sm text-muted-foreground outline-none focus:border-primary"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                Azzera
              </button>
            )}
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} post</span>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nessun post trovato.</div>
      ) : (
        <>
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
          >
            {visiblePosts.map((post, i) => (
              <PostCard
                key={`${post.url}-${i}`}
                post={post}
                canaleName={post.canaleName}
                marked={markedByUrl[post.url] ?? EMPTY_MARKED}
                onMarked={(section) => handleMarked(post.url, section)}
              />
            ))}
          </div>
          {hasMore && (
            <div className="text-center mt-6">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-full border border-border bg-card px-7 py-2.5 text-sm font-medium text-foreground transition hover:border-primary"
              >
                Carica altri ({filtered.length - visibleCount} rimanenti)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
