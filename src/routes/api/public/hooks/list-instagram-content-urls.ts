import { createFileRoute } from "@tanstack/react-router";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";

const DEFAULT_LIMIT = 150;

/**
 * Elenco degli URL Instagram già in viral_trend_content (ultimi 7 giorni,
 * stessa finestra del feed) da ricontrollare con
 * scripts/recheck-viral-engagement.mjs — gratuito, nessun credit anysite,
 * copre solo like/commenti (vedi scripts/lib/instagram-public-metrics.mjs).
 * Solo Instagram: la tecnica non è stata verificata su TikTok.
 *
 * Restituisce anche `content` (la didascalia già salvata): serve al
 * ricontrollo per applicare retroattivamente il filtro lingua italiana
 * anche quando Instagram blocca il re-fetch della pagina (login-wall) —
 * in quel caso la didascalia salvata è l'unica base su cui decidere se il
 * post va tenuto o cancellato.
 */
export const Route = createFileRoute("/api/public/hooks/list-instagram-content-urls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const limitParam = new URL(request.url).searchParams.get("limit");
          const limit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT, 1), 300);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const since = new Date();
          since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
          const sinceIso = since.toISOString();

          const { data, error } = await supabaseAdmin
            .from("viral_trend_content")
            .select("platform, external_id, url, content")
            .eq("platform", "instagram")
            .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`)
            .limit(limit);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          return Response.json({ ok: true, items: data ?? [] });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
