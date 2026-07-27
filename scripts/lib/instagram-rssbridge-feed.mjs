// Lista dei post recenti di un account Instagram via RSS-Bridge — estratto
// da probe-instagram-rssbridge-collab.mjs dopo aver verificato (leggendo il
// sorgente di InstagramBridge.php) che il bridge non supporta paginazione:
// restituisce sempre e solo l'ultima finestra di post disponibile (~6-10
// nei test reali, a seconda che sia stato usato il percorso GraphQL
// primario o quello di fallback), MAI oltre. Non esiste un modo di chiedere
// "i post precedenti" — ogni chiamata ripetuta ridà la stessa finestra,
// finché l'account non pubblica altro. Per questo il monitoraggio si basa
// su check periodici che accumulano nel tempo, non su un backfill singolo
// (vedi supabase/migrations/20260727100000_instagram_collab_monitoring.sql).
//
// Richiede un'istanza RSS-Bridge raggiungibile su RSS_BRIDGE_BASE (default
// http://localhost:3000/ — il service container avviato dal workflow,
// stesso setup di sync-canali-feed.yml).

const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";

function rssBridgeUrl(handle) {
  return `${RSS_BRIDGE_BASE}?action=display&bridge=Instagram&context=Username&u=${handle}&format=JSON`;
}

function isPostUrl(url) {
  return /\/p\/|\/reel\/|\/reels\//.test(url || "");
}

// Ritorna { posts, error }: posts è un array di { url, shortcode, author,
// publishedAt } (solo gli item che sono effettivamente post/reel, non altri
// tipi di item che il bridge potrebbe restituire), error è valorizzato solo
// se la richiesta stessa è fallita (rete/HTTP), non se l'account non ha
// nuovi post.
export async function fetchRecentPosts(handle) {
  const normalized = handle?.trim().replace(/^@/, "");
  if (!normalized) return { posts: [], error: "handle mancante" };

  const res = await fetch(rssBridgeUrl(normalized), { signal: AbortSignal.timeout(20000) }).catch(
    (e) => ({ ok: false, _fetchError: e.message }),
  );

  if (!res || res._fetchError) return { posts: [], error: res?._fetchError ?? "errore di rete" };
  if (!res.ok) return { posts: [], error: `RSS-Bridge ha risposto ${res.status}` };

  const data = await res.json().catch(() => null);
  if (!data) return { posts: [], error: "risposta non JSON" };

  const posts = (data.items ?? [])
    .filter((item) => isPostUrl(item.url))
    .map((item) => {
      const match = item.url.match(/\/(?:p|reel|reels)\/([^/?#]+)/);
      return {
        url: item.url,
        shortcode: match ? match[1] : item.url,
        author: item.author?.name ?? null,
        publishedAt: item.date_modified || item.date_published || null,
      };
    });

  return { posts, error: null };
}
