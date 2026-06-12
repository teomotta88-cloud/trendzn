import { useMemo, useState } from "react";
import type { TrendItem } from "@/lib/trends";
import { detectPlatform } from "@/lib/trends";
import { SocialEmbed, PlatformIcon } from "./SocialEmbed";
import { Search, X, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  items: TrendItem[];
  dbIds?: Record<string, string>; // url → supabase id
  onDelete?: (url: string) => void;
};

function unique(values: (string | null | undefined)[]) {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim().length > 0))).sort();
}

export function TrendGrid({ items, dbIds = {}, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const categories = useMemo(() => unique(items.map((i) => i.category)), [items]);
  const industries = useMemo(() => unique(items.map((i) => i.industry)), [items]);
  const platforms = useMemo(() => unique(items.flatMap((i) => i.links.map(detectPlatform))), [items]);

  const filtered = items.filter((i) => {
    if (category && i.category !== category) return false;
    if (industry && i.industry !== industry) return false;
    if (platform && !i.links.some((l) => detectPlatform(l) === platform)) return false;
    if (query) {
      const hay = [i.nome_trend, i.descrizione, i.applicazione, i.canali, i.industry]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  });

  const hasFilters = !!(query || category || industry || platform);

  async function handleDelete(url: string) {
    const id = dbIds[url];
    if (!id) return;
    if (!window.confirm("Eliminare questo contenuto?")) return;
    setDeleting(url);
    await supabase.from("trend_submissions").delete().eq("id", id);
    setDeleting(null);
    onDelete?.(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4 backdrop-blur">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome, descrizione, applicazione…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select label="Categoria" value={category} onChange={setCategory} options={categories} />
        <Select label="Industry" value={industry} onChange={setIndustry} options={industries} />
        <Select label="Piattaforma" value={platform} onChange={setPlatform} options={platforms} />
        {hasFilters && (
          <button
            onClick={() => {
              setQuery("");
              setCategory("");
              setIndustry("");
              setPlatform("");
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" /> Reset
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {items.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun trend trovato con i filtri selezionati.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item, idx) => {
            const url = item.links[0];
            const isDb = !!dbIds[url];
            return (
              <article
                key={idx}
                className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 transition hover:border-primary/60"
              >
                {isDb && (
                  <button
                    onClick={() => handleDelete(url)}
                    disabled={deleting === url}
                    className="absolute right-3 top-3 z-10 hidden rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive group-hover:flex"
                    title="Elimina"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                <SocialEmbed url={url} />
                <div className="space-y-2 px-1 pb-2">
                  {item.category && (
                    <span className="inline-block rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {item.category}
                    </span>
                  )}
                  <h3 className="font-display text-base font-semibold leading-snug text-foreground">
                    {item.nome_trend ?? "—"}
                  </h3>
                  {item.descrizione && <p className="text-xs text-muted-foreground line-clamp-3">{item.descrizione}</p>}
                  {item.applicazione && (
                    <p className="text-xs text-foreground/80">
                      <span className="text-muted-foreground">Applicazione:</span> {item.applicazione}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {item.industry && (
                      <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {item.industry}
                      </span>
                    )}
                    {item.links.map((l, i) => (
                      <a
                        key={i}
                        href={l}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
                      >
                        <PlatformIcon platform={detectPlatform(l)} className="size-3" />
                        {detectPlatform(l)}
                      </a>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  if (options.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
    >
      <option value="">{label}: tutti</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
