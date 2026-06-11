import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { canaliInspo, detectPlatform, embedUrl, type CanaleInspo } from "@/lib/trends";
import { SocialEmbed, PlatformIcon } from "@/components/SocialEmbed";
import { ArrowLeft, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/canali-inspo/$id")({
  loader: ({ params }): { canale: CanaleInspo } => {
    const canale = canaliInspo.find((c) => c.id === params.id);
    if (!canale) throw notFound();
    return { canale };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `@${loaderData?.canale.name ?? "Canale"} — Inspo` },
      { name: "description", content: loaderData?.canale.descrizione ?? "Canale di ispirazione social." },
    ],
  }),
  notFoundComponent: () => (
    <div className="py-20 text-center">
      <h1 className="font-display text-2xl font-bold">Canale non trovato</h1>
      <Link to="/canali-inspo" className="mt-4 inline-block text-primary">Torna ai canali</Link>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="py-20 text-center">
      <h1 className="font-display text-2xl font-bold">Errore</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="mt-4 text-primary">Riprova</button>
    </div>
  ),
  component: Page,
});

function Page() {
  const { canale } = Route.useLoaderData();
  const initial = canale.name.replace(/[^a-zA-Z0-9]/g, "").charAt(0).toUpperCase() || "•";

  // Posts come from any account URL that resolves to an embeddable single post.
  // For account-level URLs (no post id), there's no embed; we show the profile link card.
  const postEmbeds = canale.accounts.filter((a) => embedUrl(a.url));
  const profileLinks = canale.accounts.filter((a) => !embedUrl(a.url));

  return (
    <div className="space-y-8">
      <Link to="/canali-inspo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tutti i canali
      </Link>

      <header className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-gradient-to-br from-card to-secondary/40 p-8 sm:flex-row sm:items-start sm:gap-8">
        <div className="relative flex aspect-square w-32 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10">
          <div className="flex size-[88%] items-center justify-center rounded-full bg-card font-display text-5xl font-bold">{initial}</div>
        </div>
        <div className="flex-1 space-y-3 text-center sm:text-left">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">@{canale.name}</h1>
          {canale.descrizione && <p className="text-sm text-muted-foreground sm:text-base">{canale.descrizione}</p>}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {canale.accounts.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
              >
                <PlatformIcon platform={a.platform} className="size-3.5" />
                {a.platform} · {a.handle}
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Ultimi contenuti</h2>
        {postEmbeds.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nessun post embeddabile per questo canale.<br />
              Aggiungi URL di singoli post nel file Excel (colonna LINK) per vederli qui.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {profileLinks.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <PlatformIcon platform={a.platform} className="size-4" />
                  Apri profilo {a.platform}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {postEmbeds.map((a, i) => (
              <article key={i} className="space-y-2 rounded-2xl border border-border bg-card p-3">
                <SocialEmbed url={a.url} />
                <div className="flex items-center justify-between px-1 pb-1 text-xs">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <PlatformIcon platform={detectPlatform(a.url)} className="size-3" />
                    {detectPlatform(a.url)}
                  </span>
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Apri ↗</a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
