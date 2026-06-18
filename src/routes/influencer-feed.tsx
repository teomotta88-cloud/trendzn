import { useState, useEffect, useRef, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/influencer-feed")({
  component: InfluencerFeed,
});

const TRENDS_JSON_URL =
  "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

const N8N_WEBHOOK = "https://trendzn.app.n8n.cloud/webhook/trendzn-sync";

interface Account {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
}

interface InfluencerProfile {
  id: string;
  name: string;
  cliente: string | null;
  accounts: Account[];
}

interface TrendsData {
  influencer_profiles?: InfluencerProfile[];
}

interface Post {
  url: string;
  handle: string;
  platform: string;
  influencerName: string;
  cliente: string | null;
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

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

function PostCard({ post }: { post: Post }) {
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
            maxWidth: 110,
          }}
        >
          {post.influencerName}
        </span>
        {post.cliente && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#ea580c",
              background: "#fff7ed",
              padding: "1px 6px",
              borderRadius: 99,
              whiteSpace: "nowrap",
            }}
          >
            {post.cliente}
          </span>
        )}
        {dateStr && (
          <span style={{ fontSize: 11, color: "#cbd5e1", marginLeft: "auto", whiteSpace: "nowrap" }}>
            {dateStr}
          </span>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Apri il post"
          style={{
            marginLeft: dateStr ? 8 : "auto",
            display: "flex",
            alignItems: "center",
            color: "#94a3b8",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
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
type DatePreset = "tutto" | "7g" | "30g" | "90g" | "custom";

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
    idle: "#f1f5f9", loading: "#e2e8f0", success: "#dcfce7", error: "#fee2e2",
  };
  const color: Record<SyncStatus, string> = {
    idle: "#475569", loading: "#94a3b8", success: "#16a34a", error: "#dc2626",
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

function DateRangeFilter({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
}: {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
}) {
  const presets: { key: DatePreset; label: string }[] = [
    { key: "tutto", label: "Tutto" },
    { key: "7g", label: "Ultima settimana" },
    { key: "30g", label: "Ultimo mese" },
    { key: "90g", label: "Ultimi 3 mesi" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <FilterPill key={p.key} label={p.label} active={preset === p.key} onClick={() => setPreset(p.key)} />
        ))}
        <FilterPill label="Personalizzato" active={preset === "custom"} onClick={() => setPreset("custom")} />
      </div>
      {preset === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={{
              padding: "5px 8px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#000",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            style={{
              padding: "5px 8px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#000",
              outline: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 12;

function InfluencerFeed() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recenti");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [datePreset, setDatePreset] = useState<DatePreset>("tutto");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

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
  }, [platformFilter, search, sortOrder, datePreset, customFrom, customTo]);

  const dateRange = useMemo(() => {
    const now = new Date();
    if (datePreset === "tutto") return null;
    if (datePreset === "custom") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo + "T23:59:59") : null;
      if (!from && !to) return null;
      return { from, to };
    }
    const days = datePreset === "7g" ? 7 : datePreset === "30g" ? 30 : 90;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from, to: now };
  }, [datePreset, customFrom, customTo]);

  if (error)
    return <div style={{ padding: 40, color: "#ef4444", textAlign: "center" }}>{error}</div>;
  if (!data)
    return <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>Caricamento feed…</div>;

  const allPosts: Post[] = [];
  for (const profile of data.influencer_profiles || []) {
    const name = profile.name || profile.id || "";
    for (const account of profile.accounts || []) {
      if (isPostUrl(account.url)) {
        allPosts.push({
          url: account.url,
          handle: account.handle,
          platform: account.platform || getPlatform(account.url),
          influencerName: name,
          cliente: profile.cliente ?? null,
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
      p.influencerName?.toLowerCase().includes(q) ||
      p.cliente?.toLowerCase().includes(q) ||
      p.caption?.toLowerCase().includes(q);

    let matchDate = true;
    if (dateRange) {
      if (!p.date) {
        matchDate = false;
      } else {
        const d = new Date(p.date);
        if (dateRange.from && d < dateRange.from) matchDate = false;
        if (dateRange.to && d > dateRange.to) matchDate = false;
      }
    }

    return matchPlatform && matchSearch && matchDate;
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
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#1e293b", letterSpacing: -0.5 }}>
              Trendzn <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 14 }}>/ influencer feed</span>
            </div>

            <input
              placeholder="Cerca influencer, cliente, account o caption…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                fontSize: 13,
                outline: "none",
                width: 260,
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

            <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
              {filtered.length} post
            </span>
          </div>

          <DateRangeFilter
            preset={datePreset}
            setPreset={setDatePreset}
            customFrom={customFrom}
            setCustomFrom={setCustomFrom}
            customTo={customTo}
            setCustomTo={setCustomTo}
          />
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 60, fontSize: 14 }}>
            Nessun post trovato.
          </div>
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
                <PostCard key={`${post.url}-${i}`} post={post} />
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
