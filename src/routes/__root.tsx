import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      {
        name: "description",
        content:
          "Trend Watcher analyzes Excel files to display YouTube videos from specified URLs, with filtering options.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      {
        property: "og:description",
        content:
          "Trend Watcher analyzes Excel files to display YouTube videos from specified URLs, with filtering options.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Lovable App" },
      {
        name: "twitter:description",
        content:
          "Trend Watcher analyzes Excel files to display YouTube videos from specified URLs, with filtering options.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8bb61e71-74bc-45ae-9543-23f1d14fff21/id-preview-8f4a3ee6--54afe560-3e1f-4196-977c-05f75da520ec.lovable.app-1781187441235.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8bb61e71-74bc-45ae-9543-23f1d14fff21/id-preview-8f4a3ee6--54afe560-3e1f-4196-977c-05f75da520ec.lovable.app-1781187441235.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-10">
          <Outlet />
        </main>
      </div>
    </QueryClientProvider>
  );
}

function Navbar() {
  const items = [
    { to: "/", label: "Home" },
    { to: "/trend-real-time", label: "Trend Real Time" },
    { to: "/trend-attuali", label: "Trend Attuali" },
    { to: "/trend-evergreen", label: "Trend Evergreen" },
    { to: "/canali-inspo", label: "Canali Inspo" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-3 sm:px-6 lg:px-10">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            T
          </span>
          <span className="font-display text-base font-semibold tracking-tight">TrendDeck</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              activeOptions={{ exact: it.to === "/" }}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              {it.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
