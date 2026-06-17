import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feed/")({
  component: TrendzFeed,
});

const TRENDS_JSON_URL = "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

const N8N_WEBHOOK = "https://trendzn.app.n8n.cloud/webhook/trendzn-sync";

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

interface TrendsData {
  canali_inspo: Canale[];
}

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

function PostCard({ post, canaleName }: { post: Post; canaleName: string }) {
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
          <span style={{ fontSize: 11, color: "#cbd5e1", marginLeft: "auto", whiteSpace: "nowrap" }}>{dateStr}</span>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Apri su GitHub"
          style={{
            marginLeft: dateStr ? 8 : "auto",
            display: "flex",
            alignItems: "center",
            color: "#94a3b8",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12" />
          </svg>
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
            fontSize: 12,
            lineHeight: 1.4,
            color: "#475569",
            borderTop: "1px solid #f1f1f1",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {post.caption}
        </p>
      )}
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function SyncButton() {
  const [status, setStatus] = useState<SyncStatus>("idle");

  const handleSync = async () => {
    setStatus("loading");
    try {
      await fetch(N8N_WEBHOOK, {
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
    idle: "↻ Sync ora",
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

function TrendzFeed() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recenti");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((res) => {
        const decoded = JSON.parse(atob(res.content.replace(/\n/g, "")));
        setData(decoded);
      })
      .catch(() => setError("Impossibile caricare il feed."));
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [platformFilter, search, sortOrder]);

  if (error) return <div style={{ padding: 40, color: "#ef4444", textAlign: "center" }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>Caricamento feed…</div>;

  const allPosts: Post[] = [];
  for (const canale of data.canali_inspo || []) {
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
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          position: "sticky",
          top: 0,
          zIndex: 10,
          padding: "12px 20px",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18, color: "#1e293b", letterSpacing: -0.5 }}>
            Trendzn <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 14 }}>/ feed</span>
          </div>

          <input
            placeholder="Cerca canale, account o nella caption…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 13,
              outline: "none",
              width: 240,
              background: "#f8fafc",
              color: "#000",
            }}
          />

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
            style={{
              padding: "5px 10px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              fontSize: 13,
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="recenti">Più recenti</option>
            <option value="meno_recenti">Meno recenti</option>
          </select>

          <SyncButton />

          <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>{filtered.length} post</span>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 60, fontSize: 14 }}>Nessun post trovato.</div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 20,
              }}
            >
              {visiblePosts.map((post, i) => (
                <PostCard key={`${post.url}-${i}`} post={post} canaleName={post.canaleName} />
              ))}
            </div>

            {hasMore && (
              <div style={{ textAlign: "center", marginTop: 28 }}>
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  style={{
                    padding: "10px 28px",
                    borderRadius: 99,
                    border: "1px solid #e2e8f0",
                    background: "#fff",
                    color: "#1e293b",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Carica altri ({filtered.length - visibleCount} rimanenti)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
