import { createFileRoute } from "@tanstack/react-router";

const VALID_SOURCES = ["tiktok-hashtag", "google-trends", "x-trending", "canali-inspo"] as const;
const VALID_TIERS = ["hot", "spicy", "super_spicy"] as const;

type IncomingGroup = {
  label: string;
  sourceCount: number;
  tier?: string | null;
  sources: string[];
  topicIds?: string[];
  canaliInspoTopic?: string | null;
};

export const Route = createFileRoute("/api/public/hooks/sync-cross-source-trends")({
  server: {
    handlers: {
      // Chiamato da scripts/match-cross-source-trends.mjs a fine matching:
      // sostituisce SEMPRE l'intero contenuto della tabella (nessuno storico
      // da preservare, il risultato precedente non ha più senso una volta
      // ricalcolato) invece di fare un upsert riga per riga.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { groups?: IncomingGroup[] };
          const incoming = Array.isArray(body.groups) ? body.groups : [];

          const rows = incoming
            .filter(
              (g) =>
                typeof g.label === "string" &&
                g.label.trim().length > 0 &&
                Array.isArray(g.sources) &&
                g.sources.every((s) => (VALID_SOURCES as readonly string[]).includes(s)),
            )
            .map((g) => ({
              label: g.label.trim(),
              source_count: g.sourceCount,
              tier: g.tier && (VALID_TIERS as readonly string[]).includes(g.tier) ? g.tier : null,
              sources: g.sources,
              topic_ids: Array.isArray(g.topicIds) ? g.topicIds : [],
              canali_inspo_topic: g.canaliInspoTopic ?? null,
            }));

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Nessuna colonna "sempre vera" su cui filtrare un delete totale:
          // source_count >= 1 è garantito dal check constraint, quindi
          // cancella ogni riga esistente.
          const { error: deleteError } = await supabaseAdmin
            .from("cross_source_trends")
            .delete()
            .gte("source_count", 0);

          if (deleteError) {
            return Response.json({ ok: false, error: deleteError.message }, { status: 500 });
          }

          if (rows.length === 0) {
            return Response.json({ ok: true, inserted: 0 });
          }

          const { error: insertError } = await supabaseAdmin
            .from("cross_source_trends")
            .insert(rows);

          if (insertError) {
            return Response.json({ ok: false, error: insertError.message }, { status: 500 });
          }

          return Response.json({ ok: true, inserted: rows.length });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
