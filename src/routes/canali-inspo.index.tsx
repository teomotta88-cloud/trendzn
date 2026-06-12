import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { canaliInspo } from "@/lib/trends";
import type { CanaleInspo } from "@/lib/trends";
import { PlatformIcon } from "@/components/SocialEmbed";
import { Search } from "lucide-react";
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
  component: Feed,
});

function detectPlatform(url: string): "instagram" | "tiktok" | "youtube" | "web" {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

function extractHandle(url: string): string {
  try {
    const clean = url.replace(/\/$/, "");
    const parts = clean.split("/");
    const handle = parts[parts.length - 1].replace(/^@/, "");
    return handle || url;
  } catch {
    return url;
  }
}

function submissionToCanale(row: {
  id: string;
  url: string;
  title: string | null;
  industry: string | null;
  category: string | null;
}): CanaleInspo {
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

function Feed() {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState("");
  const [dbCanali, setDbCanali] = useState<CanaleInspo[]>([]);

  useEffect(() => {
    supabase
      .from("trend_submissions")
      .select("id, url, title, industry, category")
      .eq("section", "canali-inspo")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbCanali(data.map(submissionToCanale));
      });
  }, []);

  const allCanali = [...dbCanali, ...canaliInspo];

  const platforms = useMemo(
    () => Array.from(new Set(allCanali.flatMap((c) => c.accounts.map((a) => a.platform)))).sort(),
    [allCanali],
  );

  const filtered = allCanali.filter((c) => {
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
  });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Canali Inspo</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Account e siti da tenere d'occhio per trend, format, meme e real time marketing.
        </p>
      </header>

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
          const isDb = dbCanali.some((d) => d.id === c.id);
          const className =
            "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary";
          const inner = (
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
                  <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{c.descrizione}</p>
                )}
              </div>
            </>
          );
          return isDb ? (
            <a key={c.id} href={main.url} target="_blank" rel="noreferrer" className={className}>
              {inner}
            </a>
          ) : (
            <Link key={c.id} to="/canali-inspo/$id" params={{ id: c.id }} className={className}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
