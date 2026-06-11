import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { canaliInspo } from "@/lib/trends";
import { PlatformIcon } from "@/components/SocialEmbed";
import { Search } from "lucide-react";

export const Route = createFileRoute("/canali-inspo")({
  head: () => ({
    meta: [
      { title: "Canali Inspo — Feed" },
      { name: "description", content: "Bacheca di account e siti da seguire per inspo social, format, meme e real time marketing." },
    ],
  }),
  component: Feed,
});

function Feed() {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState("");

  const platforms = useMemo(
    () => Array.from(new Set(canaliInspo.flatMap((c) => c.accounts.map((a) => a.platform)))).sort(),
    [],
  );

  const filtered = canaliInspo.filter((c) => {
    if (plat && !c.accounts.some((a) => a.platform === plat)) return false;
    if (q) {
      const hay = (c.name + " " + (c.descrizione ?? "") + " " + c.accounts.map((a) => a.handle).join(" ")).toLowerCase();
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
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} / {canaliInspo.length}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((c) => {
          const main = c.accounts[0];
          const initial = c.name.replace(/[^a-zA-Z0-9]/g, "").charAt(0).toUpperCase() || "•";
          return (
            <Link
              key={c.id}
              to="/canali-inspo/$id"
              params={{ id: c.id }}
              className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary"
            >
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
