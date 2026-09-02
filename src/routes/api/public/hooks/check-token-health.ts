import { createFileRoute } from "@tanstack/react-router";

// Verifica periodica di validità dei secret/token usati dall'app (lato
// Cloudflare, letti da process.env — vedi anche scripts/check-ci-secrets-health.mjs
// per i secret usati SOLO dagli script di sync in CI, che vivono nei
// GitHub Actions secrets e non sono raggiungibili da qui).
//
// Ogni check fa UNA chiamata read-only economica al provider reale (mai
// un endpoint indovinato: ognuno riusa esattamente lo stesso URL/header già
// in uso altrove nel progetto per quel token) e riporta {configured, valid,
// detail, expiresAt}. expiresAt è noto con certezza solo per GitHub (il
// provider lo restituisce in un header quando il token ha una scadenza);
// per gli altri, quando il provider non espone la scadenza via API,
// riportiamo solo la validità corrente — vedi FIGMA_TOKEN_EXPECTED_EXPIRY
// per l'unica eccezione con una data nota manualmente.
//
// Chiamato sia dalla UI (banner di avviso in TokenHealthAlert) sia da un
// workflow schedulato (.github/workflows/check-secrets-health.yml), stesso
// pattern degli altri hook pubblici + script di sync già nel progetto.

export interface TokenCheckResult {
  name: string;
  label: string;
  configured: boolean;
  valid: boolean | null;
  detail: string;
  expiresAt: string | null;
  daysRemaining: number | null;
}

// Aggiornare ad ogni rotazione del token Figma (90 giorni dalla generazione,
// vedi Figma → Account Settings → Personal Access Tokens): l'API di Figma
// non espone la data di scadenza, quindi qui la teniamo a mano come unica
// fonte per l'avviso proattivo — il check live cattura comunque un token
// già scaduto/revocato indipendentemente da questa data.
const FIGMA_TOKEN_EXPECTED_EXPIRY = "2026-10-17";

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const diffMs = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function notConfigured(name: string, label: string): TokenCheckResult {
  return {
    name,
    label,
    configured: false,
    valid: null,
    detail: "Non configurato in questo ambiente.",
    expiresAt: null,
    daysRemaining: null,
  };
}

function okResult(
  name: string,
  label: string,
  detail: string,
  expiresAt: string | null = null,
): TokenCheckResult {
  return {
    name,
    label,
    configured: true,
    valid: true,
    detail,
    expiresAt,
    daysRemaining: daysUntil(expiresAt),
  };
}

function invalidResult(name: string, label: string, detail: string): TokenCheckResult {
  return {
    name,
    label,
    configured: true,
    valid: false,
    detail,
    expiresAt: null,
    daysRemaining: null,
  };
}

function errorResult(name: string, label: string, err: unknown): TokenCheckResult {
  return invalidResult(name, label, `Verifica fallita: ${String(err).slice(0, 200)}`);
}

async function checkGithubToken(): Promise<TokenCheckResult> {
  const name = "GITHUB_TOKEN";
  const label = "GitHub (sync canali/rubriche)";
  const token = process.env.GITHUB_TOKEN;
  if (!token) return notConfigured(name, label);

  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };

  try {
    const rateRes = await fetch("https://api.github.com/rate_limit", {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!rateRes.ok) {
      return invalidResult(
        name,
        label,
        `GitHub ha risposto ${rateRes.status} su /rate_limit (token non valido o scaduto).`,
      );
    }
    const expiresHeader = rateRes.headers.get("github-authentication-token-expiration");
    const expiresAt = expiresHeader ? new Date(expiresHeader).toISOString() : null;

    // /rate_limit autentica con QUALSIASI token valido, anche senza lo
    // scope "repo": da solo non basta a garantire che gli hook di
    // scrittura (update-bluserena-verification.ts e affini) riescano
    // davvero a leggere/scrivere il file che usano — verificato su un caso
    // reale (403 solo qui, /rate_limit rispondeva comunque 200). Chiamiamo
    // lo stesso identico endpoint/repo/file che quegli hook interrogano
    // per primo: un token autenticato ma senza scope "repo", o non
    // autorizzato via SSO per l'organizzazione, risponde 403 qui pur
    // passando /rate_limit.
    const repoRes = await fetch(
      "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/bluserena-monitoring.json",
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!repoRes.ok) {
      return invalidResult(
        name,
        label,
        `Il token autentica (GitHub risponde su /rate_limit) ma non può leggere ` +
          `teomotta88-cloud/trendzn: risposta ${repoRes.status}. Probabile scope ` +
          `"repo" mancante sul token, o SSO non autorizzato per l'organizzazione ` +
          `teomotta88-cloud (GitHub → Settings → Developer settings → ` +
          `Personal access tokens → il token → "Configure SSO").`,
      );
    }

    return okResult(name, label, "Token valido, con accesso in lettura al repo.", expiresAt);
  } catch (err) {
    return errorResult(name, label, err);
  }
}

async function checkOpenRouter(): Promise<TokenCheckResult> {
  const name = "OPENROUTER_API_KEY";
  const label = "OpenRouter (estrazione keyword)";
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return notConfigured(name, label);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return invalidResult(name, label, `OpenRouter ha risposto ${res.status}.`);
    return okResult(name, label, "Chiave valida.");
  } catch (err) {
    return errorResult(name, label, err);
  }
}

async function checkFigmaToken(): Promise<TokenCheckResult> {
  const name = "FIGMA_ACCESS_TOKEN";
  const label = "Figma (import template)";
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) return notConfigured(name, label);
  try {
    // /v1/me richiede lo scope "Current user: Read", che però NON è tra
    // quelli che chiediamo di selezionare all'utente (solo "File content:
    // Read-only", l'unico scope che serve davvero a figma-import.ts). Un
    // token con solo quello scope risponde 403 su /v1/me pur funzionando
    // perfettamente sugli endpoint file/nodes/images: qui distinguiamo
    // quel 403-per-scope (falso allarme) da un token davvero scaduto o
    // revocato, guardando il messaggio d'errore restituito da Figma.
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return okResult(name, label, "Token valido.", FIGMA_TOKEN_EXPECTED_EXPIRY);
    const body = await res.text();
    if (res.status === 403 && /scope/i.test(body)) {
      return okResult(
        name,
        label,
        "Token valido per l'import file (scope limitato a File content, come richiesto).",
        FIGMA_TOKEN_EXPECTED_EXPIRY,
      );
    }
    return invalidResult(
      name,
      label,
      `Figma ha risposto ${res.status} (token scaduto o revocato?).`,
    );
  } catch (err) {
    return errorResult(name, label, err);
  }
}

async function checkGmailGateway(): Promise<TokenCheckResult> {
  const name = "GOOGLE_MAIL_API_KEY";
  const label = "Gmail (poll canali cliente)";
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_MAIL_API_KEY;
  if (!lovableKey || !connKey) return notConfigured(name, label);
  try {
    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/profile",
      {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": connKey,
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return invalidResult(name, label, `Gateway Gmail ha risposto ${res.status}.`);
    return okResult(name, label, "Connessione Gmail valida.");
  } catch (err) {
    return errorResult(name, label, err);
  }
}

async function checkSupabase(): Promise<TokenCheckResult> {
  const name = "SUPABASE_SERVICE_ROLE_KEY";
  const label = "Supabase";
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return notConfigured(name, label);
  try {
    // /auth/v1/settings invece della root di /rest/v1/: endpoint pubblico
    // pensato apposta per essere interrogato con la sola apikey, non
    // dipende dai permessi RLS di una tabella specifica (che darebbero un
    // 403 anche con una chiave valida, un falso negativo).
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return invalidResult(name, label, `Supabase ha risposto ${res.status}.`);
    return okResult(name, label, "Connessione valida.");
  } catch (err) {
    return errorResult(name, label, err);
  }
}

const CHECKS: Record<string, () => Promise<TokenCheckResult>> = {
  GITHUB_TOKEN: checkGithubToken,
  OPENROUTER_API_KEY: checkOpenRouter,
  FIGMA_ACCESS_TOKEN: checkFigmaToken,
  GOOGLE_MAIL_API_KEY: checkGmailGateway,
  SUPABASE_SERVICE_ROLE_KEY: checkSupabase,
};

export const Route = createFileRoute("/api/public/hooks/check-token-health")({
  server: {
    handlers: {
      // GET invece di POST (a differenza degli altri hook): è una lettura
      // pura, senza body, comoda da richiamare sia da fetch lato UI sia da
      // un semplice curl nel workflow schedulato.
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const only = url.searchParams.get("name");
          const entries = only ? [[only, CHECKS[only]] as const] : Object.entries(CHECKS);
          const missing = entries.find(([, fn]) => !fn);
          if (missing) {
            return Response.json(
              { ok: false, error: `Check sconosciuto: ${missing[0]}` },
              { status: 400 },
            );
          }
          const results = await Promise.all(entries.map(([, fn]) => fn()));
          const allValidOrUnconfigured = results.every((r) => r.valid !== false);
          return Response.json(
            { ok: true, results },
            { status: allValidOrUnconfigured ? 200 : 207 },
          );
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
