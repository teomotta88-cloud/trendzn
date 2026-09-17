import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, MapPin, Search } from "lucide-react";

export const Route = createFileRoute("/monitoraggio-subito/")({
  head: () => ({
    meta: [
      { title: "Monitoraggio Subito.it" },
      {
        name: "description",
        content: "Monitoraggio annunci Subito.it per keyword: titolo, prezzo e URL.",
      },
    ],
  }),
  component: MonitoraggioSubitoPage,
});

const SUBITO_JSON_URL =
  "https://raw.githubusercontent.com/teomotta88-cloud/trendzn/main/src/data/monitoraggio-subito.json";

type SubitoListing = {
  url: string;
  title: string;
  price: string | null;
  location: string | null;
  firstSeenAt: string;
};

type SubitoKeyword = {
  keyword: string;
  region: string;
  listings: SubitoListing[];
};

function MonitoraggioSubitoPage() {
  const [keywords, setKeywords] = useState<SubitoKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKeyword, setActiveKeyword] = useState<string>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(SUBITO_JSON_URL)
      .then((r) => r.json())
      .then((data) => setKeywords(Array.isArray(data.keywords) ? data.keywords : []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const allListings = useMemo(
    () =>
      keywords.flatMap((k) =>
        k.listings.map((listing) => ({ ...listing, keyword: k.keyword, region: k.region })),
      ),
    [keywords],
  );

  const filtered = useMemo(() => {
    return allListings
      .filter((l) => activeKeyword === "all" || l.keyword === activeKeyword)
      .filter((l) => !q || l.title.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
  }, [allListings, activeKeyword, q]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Monitoraggio Subito.it</h1>
        <p className="text-sm text-muted-foreground">
          Annunci più recenti trovati su Subito.it per le keyword configurate in{" "}
          <code>src/data/monitoraggio-subito.json</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca nel titolo…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <select
          value={activeKeyword}
          onChange={(e) => setActiveKeyword(e.target.value)}
          className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">Tutte le keyword</option>
          {keywords.map((k) => (
            <option key={k.keyword} value={k.keyword}>
              {k.keyword} ({k.listings.length})
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {allListings.length} annunci
        </span>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Errore nel caricamento: {error}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nessun annuncio ancora. Il workflow di sync gira ogni ora.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((listing) => (
            <a
              key={listing.url}
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition hover:border-primary"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{listing.title}</h2>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>

              <p className="text-base font-bold text-primary">{listing.price ?? "Prezzo n.d."}</p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {listing.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {listing.location}
                  </span>
                )}
                <span className="rounded-full border border-border bg-background/60 px-2 py-0.5">
                  {listing.keyword}
                </span>
                <span>{new Date(listing.firstSeenAt).toLocaleString("it-IT")}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
