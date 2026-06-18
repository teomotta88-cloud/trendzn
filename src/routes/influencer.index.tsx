import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useCallback } from "react";
import { PlatformIcon } from "@/components/SocialEmbed";
import { ManualSubmitDialog } from "@/components/ManualSubmitDialog";
import { Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/influencer/")({
  head: () => ({
    meta: [
      { title: "Influencer — Trendzn" },
      {
        name: "description",
        content: "Profili influencer monitorati, organizzati per cliente.",
      },
    ],
  }),
  component: InfluencerPage,
});

const TRENDS_JSON_URL =
  "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

function detectPlatform(url: string): "instagram" | "tiktok" | "youtube" | "web" {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

function extractHandle(url: string): string {
  try {
    const clean = url.replace(/\/$/, "").split("?")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1].replace(/^@/, "") || url;
  } catch {
    return url;
  }
}

type InfluencerProfile = {
  id: string;
  name: string;
  cliente: string | null;
  urls: string[];
  descrizione: string | null;
  accounts: { platform: string; handle: string; url: string; date?: string | null; caption?: string | null }[];
};

type DbRow = {
  id: string;
  url: string;
  title: string | null; // cliente
  industry: string | null; // nome influencer
  category: string | null;
};

function rowToProfile(row: DbRow): InfluencerProfile {
  const platform = detectPlatform(row.url);
  const handle = extractHandle(row.url);
  return {
    id: row.id,
    name: row.industry ?? handle,
    cliente: row.title ?? null,
    urls: [row.url],
    descrizione: null,
    accounts: [{ platform, handle, url: row.url }],
  };
}

function InfluencerPage() {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState("");
  const [dbRows, setDbRows] = useState<DbRow[]>([]);
  const [jsonProfiles, setJsonProfiles] = useState<InfluencerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchJson = useCallback(() => {
    return fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((res) => {
        const decoded = JSON.parse(atob(res.content.replace(/\n/g, "")));
        setJsonProfiles(decoded.influencer_profiles || []);
      })
      .catch((e) => console.error("Errore caricamento trends.json:", e));
  }, []);

  const fetchDb = useCallback(() => {
    return supabase
      .from("trend_submissions")
      .select("id, url, title, industry, category")
      .eq("section", "influencer")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbRows(data as DbRow[]);
      });
  }, []);

  useEffect(() => {
    Promise.all([fetchJson(), fetchDb()]).finally(() => setLoading(false));
  }, [fetchJson, fetchDb]);

  const handleManualSuccess = useCallback(() => {
    fetchDb();
    setTimeout(fetchJson, 1500);
  }, [fetchDb, fetchJson]);

  const handleToDbId = useMemo(() => {
    const map = new Map<string, string>();
    dbRows.forEach((r) => {
      const handle = extractHandle(r.url).toLowerCase();
      if (!map.has(handle)) map.set(handle, r.id);
    });
    return map;
  }, [dbRows]);

  const handleDeleteSupabase = useCallback(async (dbId: string) => {
    if (!window.confirm("Eliminare questo profilo?")) return;
    setDeleting(dbId);
    await supabase.from("trend_submissions").delete().eq("id", dbId);
    setDbRows((prev) => prev.filter((r) => r.id !== dbId));
    setDeleting(null);
  }, []);

  const jsonHandles = useMemo(
    () => new Set(jsonProfiles.flatMap((c) => c.accounts.map((a) => a.handle.toLowerCase()))),
    [jsonProfiles],
  );

  const dbProfiles = useMemo(
    () =>
      dbRows
        .map(rowToProfile)
        .filter((c) => !c.accounts.some((a) => jsonHandles.has(a.handle.toLowerCase()))),
    [dbRows, jsonHandles],
  );

  const allProfiles = useMemo(() => [...dbProfiles, ...jsonProfiles], [dbProfiles, jsonProfiles]);
  const dbIds = useMemo(() => new Set(dbRows.map((r) => r.id)), [dbRows]);

  const platforms = useMemo(
    () =>
      Array.from(new Set(allProfiles.flatMap((c) => c.accounts.map((a) => a.platform)))).sort(),
    [allProfiles],
  );

  const filtered = useMemo(
    () =>
      allProfiles.filter((c) => {
        if (plat && !c.accounts.some((a) => a.platform === plat)) return false;
        if (q) {
          const hay = (
            c.name +
            " " +
            (c.cliente ?? "") +
            " " +
            c.accounts.map((a) => a.handle).join(" ")
          ).toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [allProfiles, q, plat],
  );

  if (loading)
    return (
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Influencer</h1>
        </header>
        <div className="text-sm text-muted-foreground">Caricamento profili…</div>
      </div>
    );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Influencer</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Profili influencer monitorati automaticamente, organizzati per cliente.
          </p>
        </div>
        <ManualSubmitDialog section="influencer" onSuccess={handleManualSuccess} />
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca influencer, cliente o account…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <select
          value={plat}
          onChange={(e) => setPlat(e.target.value)}
          className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Tutte le piattaforme</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {allProfiles.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((c) => {
          const main = c.accounts[0];
          const initial =
            c.name
              .replace(/[^a-zA-Z0-9]/g, "")
              .charAt(0)
              .toUpperCase() || "•";

          const isDb = dbIds.has(c.id);
          const isJsonProfile = jsonProfiles.some((j) => j.id === c.id);

          const dbIdForProfile =
            isDb
              ? c.id
              : c.accounts
                  .map((a) => handleToDbId.get(a.handle.toLowerCase()))
                  .find(Boolean) ?? null;

          const canDelete = !!dbIdForProfile;
          const deletingThis = deleting === dbIdForProfile;

          return (
            <div key={c.id} className="group relative">
              {canDelete && (
                <button
                  onClick={() => handleDeleteSupabase(dbIdForProfile!)}
                  disabled={deletingThis}
                  className="absolute right-2 top-2 z-10 hidden rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex"
                  title="Elimina"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
              {(() => {
                const cardContent = (
                  <>
                    <div className="relative mx-auto flex aspect-square w-full max-w-[120px] items-center justify-center rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10">
                      <div className="flex size-[88%] items-center justify-center rounded-full bg-card font-display text-3xl font-bold">
                        {initial}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="truncate font-display text-sm font-semibold">
                        @{main.handle}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1.5 text-muted-foreground">
                        {c.accounts.map((a, i) => (
                          <PlatformIcon key={i} platform={a.platform} className="size-3.5" />
                        ))}
                      </div>
                      {c.cliente && (
                        <span className="mt-2 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {c.cliente}
                        </span>
                      )}
                    </div>
                  </>
                );

                const cardClassName =
                  "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary";

                if (isJsonProfile) {
                  return (
                    <Link
                      to="/influencer/$id"
                      params={{ id: c.id }}
                      className={cardClassName}
                    >
                      {cardContent}
                    </Link>
                  );
                }

                return (
                  <a href={main.url} target="_blank" rel="noreferrer" className={cardClassName}>
                    {cardContent}
                  </a>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
