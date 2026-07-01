import { createFileRoute, Link } from "@tanstack/react-router";
import { FeedPageToggle } from "./feed.index";
import { useMemo, useState, useEffect, useCallback } from "react";
import type { CanaleInspo } from "@/lib/trends";
import { PlatformIcon } from "@/components/SocialEmbed";
import { ManualSubmitDialog } from "@/components/ManualSubmitDialog";
import { Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/canali-inspo/")({
  head: () => ({
    meta: [
      { title: "Canali Inspo — Feed" },
      {
        name: "description",
        content: "Bacheca di account e siti da seguire per inspo social, format, meme e real time marketing.",
      },
    ],
  }),
  component: CanaliInspoView,
});

const TRENDS_JSON_URL = "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/trends.json";

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

type DbRow = {
  id: string;
  url: string;
  title: string | null;
  industry: string | null;
  category: string | null;
};

function rowToCanale(row: DbRow): CanaleInspo {
  const platform = detectPlatform(row.url);
  const handle = extractHandle(row.url);
  return {
    id: row.id,
    name: row.title ?? handle,
    urls: [row.url],
    descrizione: row.industry ?? null,
    accounts: [{ platform, handle, url: row.url }],
  };
}

export function CanaliInspoView({ tab, setTab }: { tab?: "feed" | "canali"; setTab?: (t: "feed" | "canali") => void }) {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState("");
  const [dbRows, setDbRows] = useState<DbRow[]>([]);
  const [jsonCanali, setJsonCanali] = useState<CanaleInspo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Conferma a doppio click invece di window.confirm: nell'iframe di preview
  // i dialog nativi vengono spesso bloccati/auto-dismessi (confirm() ritorna
  // false all'istante), facendo sembrare il bottone elimina "rotto".
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingId) return;
    const t = setTimeout(() => setConfirmingId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmingId]);

  // Legge trends.json da GitHub a runtime
  const fetchJson = useCallback(() => {
    return fetch(TRENDS_JSON_URL)
      .then((r) => r.json())
      .then((decoded) => {
        setJsonCanali(decoded.canali_inspo || []);
      })
      .catch((e) => console.error("Errore caricamento trends.json:", e));
  }, []);

  // Legge canali da Supabase
  const fetchDb = useCallback(() => {
    return supabase
      .from("trend_submissions")
      .select("id, url, title, industry, category")
      .eq("section", "canali-inspo")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbRows(data as DbRow[]);
      });
  }, []);

  useEffect(() => {
    Promise.all([fetchJson(), fetchDb()]).finally(() => setLoading(false));
  }, [fetchJson, fetchDb]);

  // Dopo un inserimento manuale, il canale finisce su Supabase E (se non è duplicato)
  // viene subito sincronizzato su GitHub: ricarichiamo entrambe le fonti.
  const handleManualSuccess = useCallback(() => {
    fetchDb();
    // Piccolo delay per dare tempo al commit GitHub di propagarsi prima del refetch
    setTimeout(fetchJson, 1500);
  }, [fetchDb, fetchJson]);

  // Mappa handle → id Supabase
  const handleToDbId = useMemo(() => {
    const map = new Map<string, string>();
    dbRows.forEach((r) => {
      const handle = extractHandle(r.url).toLowerCase();
      if (!map.has(handle)) map.set(handle, r.id);
    });
    return map;
  }, [dbRows]);

  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Elimina canale da Supabase (inseriti via mail o manualmente)
  const handleDeleteSupabase = useCallback(async (dbId: string) => {
    setConfirmingId(null);
    setDeleting(dbId);
    try {
      const res = await fetch("/api/public/hooks/delete-trend-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dbId }),
      });
      if (res.ok) {
        setDbRows((prev) => prev.filter((r) => r.id !== dbId));
      } else {
        setDeleteError("Errore durante l'eliminazione. Riprova.");
        setTimeout(() => setDeleteError(null), 4000);
      }
    } catch {
      setDeleteError("Errore di rete. Riprova.");
      setTimeout(() => setDeleteError(null), 4000);
    }
    setDeleting(null);
  }, []);

  // Elimina canale da trends.json via endpoint server (canali statici)
  const handleDeleteJson = useCallback(async (canaleId: string) => {
    setConfirmingId(null);
    setDeleting(canaleId);
    try {
      const res = await fetch("/api/public/hooks/delete-canale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canaleId }),
      });
      if (res.ok) {
        setJsonCanali((prev) => prev.filter((c) => c.id !== canaleId));
      } else {
        setDeleteError("Errore durante l'eliminazione. Riprova.");
        setTimeout(() => setDeleteError(null), 4000);
      }
    } catch {
      setDeleteError("Errore di rete. Riprova.");
      setTimeout(() => setDeleteError(null), 4000);
    }
    setDeleting(null);
  }, []);

  // Filtra i canali Supabase già nel JSON (evita doppioni)
  const jsonHandles = useMemo(
    () => new Set(jsonCanali.flatMap((c) => c.accounts.map((a) => a.handle.toLowerCase()))),
    [jsonCanali],
  );

  const dbCanali = useMemo(
    () => dbRows.map(rowToCanale).filter((c) => !c.accounts.some((a) => jsonHandles.has(a.handle.toLowerCase()))),
    [dbRows, jsonHandles],
  );

  const allCanali = useMemo(() => [...dbCanali, ...jsonCanali], [dbCanali, jsonCanali]);
  const dbIds = useMemo(() => new Set(dbRows.map((r) => r.id)), [dbRows]);

  const platforms = useMemo(
    () => Array.from(new Set(allCanali.flatMap((c) => c.accounts.map((a) => a.platform)))).sort(),
    [allCanali],
  );

  const filtered = useMemo(
    () =>
      allCanali.filter((c) => {
        if (plat && !c.accounts.some((a) => a.platform === plat)) return false;
        if (q) {
          const hay = (
            c.name +
            " " +
            (c.descrizione ?? "") +
            " " +
            c.accounts.map((a) => a.handle).join(" ")
          ).toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [allCanali, q, plat],
  );

  if (loading)
    return (
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Canali Inspo</h1>
        </header>
        <div className="text-sm text-muted-foreground">Caricamento canali…</div>
      </div>
    );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Canali Inspo</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Account e siti da tenere d'occhio per trend, format, meme e real time marketing.
          </p>
        </div>
        <ManualSubmitDialog section="canali-inspo" onSuccess={handleManualSuccess} />
      </header>

      {deleteError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {tab !== undefined && setTab && (
        <div className="flex">
          <FeedPageToggle tab={tab} setTab={setTab} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca account o descrizione…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
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
          {filtered.length} / {allCanali.length}
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
          const isJsonCanale = jsonCanali.some((j) => j.id === c.id);

          const dbIdForCanale = isDb
            ? c.id
            : (c.accounts.map((a) => handleToDbId.get(a.handle.toLowerCase())).find(Boolean) ?? null);

          // Un canale presente in trends.json va sempre eliminato da lì, anche se
          // condivide l'handle con una riga Supabase (es. duplicato già filtrato
          // da dbCanali): altrimenti il bottone elimina solo la riga Supabase
          // senza toccare il json e il canale resta visibile.
          const canDeleteJson = isJsonCanale;
          const canDeleteSupabase = !!dbIdForCanale && !isJsonCanale;

          const deletingThis = !!deleting && (deleting === dbIdForCanale || deleting === c.id);

          return (
            <div key={c.id} className="group relative">
              {canDeleteSupabase &&
                (() => {
                  const isConfirming = confirmingId === dbIdForCanale;
                  return (
                    <button
                      onClick={() =>
                        isConfirming ? handleDeleteSupabase(dbIdForCanale!) : setConfirmingId(dbIdForCanale)
                      }
                      disabled={deletingThis}
                      className={
                        "absolute right-2 top-2 z-10 rounded-lg border p-1.5 text-xs font-medium transition " +
                        (isConfirming
                          ? "flex items-center gap-1 border-destructive bg-destructive text-destructive-foreground"
                          : "hidden border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex")
                      }
                      title={isConfirming ? "Clicca di nuovo per confermare" : "Elimina"}
                    >
                      <Trash2 className="size-3.5" />
                      {isConfirming && "Confermi?"}
                    </button>
                  );
                })()}
              {canDeleteJson &&
                (() => {
                  const isConfirming = confirmingId === c.id;
                  return (
                    <button
                      onClick={() => (isConfirming ? handleDeleteJson(c.id) : setConfirmingId(c.id))}
                      disabled={deletingThis}
                      className={
                        "absolute right-2 top-2 z-10 rounded-lg border p-1.5 text-xs font-medium transition " +
                        (isConfirming
                          ? "flex items-center gap-1 border-destructive bg-destructive text-destructive-foreground"
                          : "hidden border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex")
                      }
                      title={isConfirming ? "Clicca di nuovo per confermare" : "Elimina"}
                    >
                      <Trash2 className="size-3.5" />
                      {isConfirming && "Confermi?"}
                    </button>
                  );
                })()}
              {(() => {
                const cardContent = (
                  <>
                    <div className="relative mx-auto flex aspect-square w-full max-w-[120px] items-center justify-center rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10">
                      <div className="flex size-[88%] items-center justify-center rounded-full bg-card font-display text-3xl font-bold">
                        {initial}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="truncate font-display text-sm font-semibold">@{main.handle}</div>
                      <div className="mt-1 flex items-center justify-center gap-1.5 text-muted-foreground">
                        {c.accounts.map((a, i) => (
                          <PlatformIcon key={i} platform={a.platform} className="size-3.5" />
                        ))}
                      </div>
                      {c.descrizione && (
                        <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                          {c.descrizione}
                        </p>
                      )}
                    </div>
                  </>
                );

                const cardClassName =
                  "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary";

                if (isJsonCanale) {
                  return (
                    <Link to="/canali-inspo/$id" params={{ id: c.id }} className={cardClassName}>
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
