import { createFileRoute } from "@tanstack/react-router";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";

// Soglie esplicite richieste: 3+ Reel diversi con lo stesso audio, da
// almeno 2 canali Canali Inspo distinti — stessa forma della soglia già
// usata per il trend cross-profilo testuale (MIN_CROSS_PROFILE_CHANNELS in
// discover-canali-inspo-content.mjs), qui su audio_url invece che su
// un'etichetta clusterizzata via LLM: un match esatto sull'URL basta, non
// serve capire semanticamente nulla — sono o lo stesso oggetto audio o no.
const MIN_REEL_COUNT = 3;
const MIN_CHANNEL_COUNT = 2;

// Limite noto, non risolvibile qui: se un utente scarica un audio e lo
// ricarica come "audio originale" proprio, ottiene un audio_url TUTTO
// nuovo — e un audio_name generico legato al suo profilo, non a quello
// originale: nessun segnale testuale condiviso da abbinare, nemmeno con un
// LLM (Groq/OpenRouter, già in uso altrove in questo progetto per il match
// cross-fonte). Un vero riconoscimento richiederebbe scaricare e
// analizzare l'audio reale (fingerprint acustico), fuori scopo qui.
export const Route = createFileRoute("/api/public/hooks/sync-audio-trends")({
  server: {
    handlers: {
      // Chiamato da scripts/sync-audio-trends.mjs su schedule: nessuno
      // scraping qui, solo aggregazione di ciò che discover-canali-inspo-content.mjs
      // ha già raccolto (audio_name/audio_url, Fase F) — a differenza del
      // trend cross-profilo testuale (che richiede l'LLM per capire se due
      // didascalie parlano dello stesso argomento), qui basta un GROUP BY
      // su audio_url fatto in JS.
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const since = new Date();
          since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
          const sinceIso = since.toISOString();

          const { data, error } = await supabaseAdmin
            .from("viral_trend_content")
            .select("id, audio_url, author, published_at, created_at")
            .eq("discovery_source", "canali-inspo")
            .not("audio_url", "is", null)
            .or(
              `published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`,
            )
            .limit(2000);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          type Row = { id: string; audio_url: string | null; author: string | null };
          const rows = (data ?? []) as Row[];

          const byAudio = new Map<string, { ids: string[]; channels: Set<string> }>();
          for (const row of rows) {
            if (!row.audio_url) continue;
            const group = byAudio.get(row.audio_url) ?? { ids: [], channels: new Set<string>() };
            group.ids.push(row.id);
            if (row.author) group.channels.add(row.author);
            byAudio.set(row.audio_url, group);
          }

          let promoted = 0;
          let reset = 0;

          for (const group of byAudio.values()) {
            const qualifies =
              group.ids.length >= MIN_REEL_COUNT && group.channels.size >= MIN_CHANNEL_COUNT;

            const { error: updateError } = await supabaseAdmin
              .from("viral_trend_content")
              .update({
                audio_trend_reel_count: qualifies ? group.ids.length : null,
                audio_trend_channel_count: qualifies ? group.channels.size : null,
              })
              .in("id", group.ids);

            if (!updateError) {
              if (qualifies) promoted += group.ids.length;
              else reset += group.ids.length;
            }
          }

          return Response.json({ ok: true, audioGroups: byAudio.size, promoted, reset });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
