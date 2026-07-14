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

const N8N_WEBHOOK = "https://trendzn.app.n8n.cloud/webhook/trendzn-sync";
const GITHUB_SYNC_ENDPOINT = "/api/public/hooks/trigger-sync-canali-feed";

interface Account {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
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
}

function isPostUrl(url: string): boolean {
  return /\/p\/|\/reel\/|\/reels\/|\/video\/|\/photo\/|\/watch\/|\/tv\//.test(url);
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

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    instagram: { bg: "#f0e6f6", text: "#7c3aed" },
    tiktok: { bg: "#e8f0fe", text: "#1a73e8" },
    youtube: { bg: "#fce8e8", text: "#d93025" },
    web: { bg: "#f0f4f8", text: "#64748b" },
  };
  const c = colors[platform] || colors.web;
  const labels: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
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

function LazyEmbed({ embedUrl, height }: { embedUrl: string; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", background: "#f8f9fa", minHeight: height }}>
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
        // già presente: la consideriamo comunque marcata
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
  const platform = getPlatform(post.url);
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
          {platform === "instagram" && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
          )}
          {platform === "tiktok" && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.74a4.85 4.85 0 01-1.01-.05z" />
            </svg>
          )}
          {platform === "youtube" && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          )}
          {(platform === "web" ||
            (platform !== "instagram" && platform !== "tiktok" && platform !== "youtube")) && (
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
          )}
        </a>
      </div>

      {embedUrl ? (
        <LazyEmbed embedUrl={embedUrl} height={h} />
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

function SyncButton({ endpoint, label: idleLabel }: { endpoint: string; label: string }) {
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
const EMPTY_MARKED: Set<TrendSection> = new Set();

export function TrendzFeed({
  tab,
  setTab,
  jsonUrl = TRENDS_JSON_URL,
  dataKey = "canali_inspo",
  syncEndpoint = GITHUB_SYNC_ENDPOINT,
  canaliLabel,
}: {
  tab: "feed" | "canali";
  setTab: (t: "feed" | "canali") => void;
  jsonUrl?: string;
  dataKey?: string;
  syncEndpoint?: string;
  canaliLabel?: string;
}) {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recenti");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [markedByUrl, setMarkedByUrl] = useState<Record<string, Set<TrendSection>>>({});

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

  const handleMarked = (url: string, section: TrendSection) => {
    setMarkedByUrl((prev) => {
      const set = new Set(prev[url] ?? []);
      set.add(section);
      return { ...prev, [url]: set };
    });
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [platformFilter, search, sortOrder]);

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
        });
      }
    }
  }

  const sorted = [...allPosts].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return sortOrder === "recenti" ? db - da : da - db;
  });

  const filtered = sorted.filter((p) => {
    const matchPlatform = platformFilter === "tutti" || p.platform === platformFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      p.handle?.toLowerCase().includes(q) ||
      p.canaleName?.toLowerCase().includes(q) ||
      p.caption?.toLowerCase().includes(q);
    return matchPlatform && matchSearch;
  });

  const visiblePosts = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const platforms = ["tutti", ...new Set(allPosts.map((p) => p.platform))];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Feed</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Post recenti dai canali monitorati su Instagram e TikTok.
          </p>
        </div>
        <div className="flex gap-2">
          <SyncButton endpoint={syncEndpoint} label="↻ Sincronizza ora" />
        </div>
      </header>

      <div className="flex">
        <FeedPageToggle tab={tab} setTab={setTab} canaliLabel={canaliLabel} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <input
          placeholder="Cerca canale, account o nella caption…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-background/60 py-2 px-3 text-sm outline-none focus:border-primary"
        />
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
