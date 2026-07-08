import process from "node:process";

// Wrapper server-only per Facebook Login for Business + Instagram Graph API
// (flusso "classico": l'account Instagram del cliente deve essere
// Business/Creator collegato a una Pagina Facebook). Nessuna delle funzioni
// qui dentro va importata da codice che finisce nel bundle client — solo da
// route .ts sotto src/routes/api/meta/ e da script server-side.
//
// Variabili d'ambiente richieste (impostate su Lovable, mai nel repo):
//   META_APP_ID
//   META_APP_SECRET
//   META_OAUTH_REDIRECT_URI   es. https://trendzn.lovable.app/api/meta/oauth-callback
//   META_GRAPH_API_VERSION    opzionale, default v21.0

const DEFAULT_GRAPH_VERSION = "v21.0";

// Scope minimi per leggere post + insights dei canali cliente (Fase 1).
// instagram_content_publish (pubblicazione) va richiesto solo quando la
// Fase 3 è pronta: è "Advanced Access" e passa da App Review separato.
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_insights",
] as const;

function graphVersion(): string {
  return process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
}

function graphUrl(path: string): URL {
  return new URL(`https://graph.facebook.com/${graphVersion()}${path}`);
}

export function getMetaAppCredentials(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  const missing = [
    ...(!appId ? ["META_APP_ID"] : []),
    ...(!appSecret ? ["META_APP_SECRET"] : []),
    ...(!redirectUri ? ["META_OAUTH_REDIRECT_URI"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(`Variabili d'ambiente Meta mancanti: ${missing.join(", ")}`);
  }
  return { appId: appId!, appSecret: appSecret!, redirectUri: redirectUri! };
}

export function buildOAuthDialogUrl(state: string): string {
  const { appId, redirectUri } = getMetaAppCredentials();
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function graphFetch<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message || `Graph API error (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function exchangeCodeForUserToken(code: string): Promise<GraphTokenResponse> {
  const { appId, appSecret, redirectUri } = getMetaAppCredentials();
  const url = graphUrl("/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  return graphFetch<GraphTokenResponse>(url);
}

// Scambia un token utente (short-lived o long-lived non ancora scaduto) per
// un nuovo token long-lived (~60gg) — usato sia subito dopo il login sia dal
// job di refresh periodico per estendere la scadenza prima che avvenga.
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<GraphTokenResponse> {
  const { appId, appSecret } = getMetaAppCredentials();
  const url = graphUrl("/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  return graphFetch<GraphTokenResponse>(url);
}

export interface FacebookPageWithInstagram {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

// Elenca le Pagine Facebook amministrate dall'utente che ha appena fatto
// login, con l'account Instagram Business/Creator collegato (se presente) —
// una Pagina senza instagram_business_account non ha un IG collegabile.
export async function getUserPagesWithInstagram(
  userAccessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  const url = graphUrl("/me/accounts");
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  url.searchParams.set("access_token", userAccessToken);
  const data = await graphFetch<{ data: FacebookPageWithInstagram[] }>(url);
  return data.data ?? [];
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export async function getInstagramMedia(
  igBusinessAccountId: string,
  pageAccessToken: string,
  limit = 25,
): Promise<InstagramMediaItem[]> {
  const url = graphUrl(`/${igBusinessAccountId}/media`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count",
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", pageAccessToken);
  const data = await graphFetch<{ data: InstagramMediaItem[] }>(url);
  return data.data ?? [];
}

export interface InstagramMediaInsights {
  impressions?: number;
  reach?: number;
}

// Le metriche disponibili variano per media_type (es. "impressions" non è
// supportata sui REELS su alcune versioni della Graph API): se la chiamata
// fallisce ripieghiamo su nessun insight invece di far fallire tutto il sync
// per un singolo post.
export async function getInstagramMediaInsights(
  mediaId: string,
  pageAccessToken: string,
): Promise<InstagramMediaInsights> {
  try {
    const url = graphUrl(`/${mediaId}/insights`);
    url.searchParams.set("metric", "impressions,reach");
    url.searchParams.set("access_token", pageAccessToken);
    const data = await graphFetch<{ data: { name: string; values: { value: number }[] }[] }>(url);
    const insights: InstagramMediaInsights = {};
    for (const metric of data.data ?? []) {
      const value = metric.values?.[0]?.value;
      if (metric.name === "impressions") insights.impressions = value;
      if (metric.name === "reach") insights.reach = value;
    }
    return insights;
  } catch {
    return {};
  }
}
