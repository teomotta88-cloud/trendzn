import { createFileRoute } from "@tanstack/react-router";
import { VIRALITY_WINDOW_DAYS } from "@/lib/virality";
import { fingerprintSimilarity, FINGERPRINT_MATCH_THRESHOLD } from "@/lib/audioFingerprintSimilarity";

// Soglie esplicite richieste: 3+ Reel diversi con lo stesso audio, da
// almeno 3 canali Canali Inspo distinti — stessa soglia già usata per il
// trend cross-profilo testuale (MIN_CROSS_PROFILE_CHANNELS in
// discover-canali-inspo-content.mjs).
const MIN_REEL_COUNT = 3;
const MIN_CHANNEL_COUNT = 3;

// Due passate, in ordine di affidabilità:
//   1. Match ESATTO su audio_url — deterministico, copre il caso comune
//      (più creator scelgono lo stesso audio dalla libreria Instagram).
//   2. Match per FINGERPRINT ACUSTICO (Chromaprint, vedi
//      scripts/lib/audio-fingerprint.mjs) — euristico, solo sui Reel che
//      la prima passata non è riuscita a raggruppare: recupera il caso di
//      un audio ricaricato con un audio_url diverso (audio "originale"
//      ripubblicato), che il match esatto per definizione non vede. Un
//      Reel già promosso dalla passata 1 non viene ririesaminato dalla 2.
export const Route = createFileRoute("/api/public/hooks/sync-audio-trends")({
  server: {
    handlers: {
      // Chiamato da scripts/sync-audio-trends.mjs su schedule: nessuno
      // scraping qui, solo aggregazione di ciò che discover-canali-inspo-content.mjs
      // ha già raccolto (audio_name/audio_url dalla Fase F, audio_fingerprint
      // da questa fase) — un GROUP BY per la passata 1, un confronto a
      // coppie (dataset piccolo: solo i Reel Canali Inspo di 7gg) per la 2.
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const since = new Date();
          since.setDate(since.getDate() - VIRALITY_WINDOW_DAYS);
          const sinceIso = since.toISOString();

          const { data, error } = await supabaseAdmin
            .from("viral_trend_content")
            .select("id, audio_url, audio_fingerprint, author, published_at, created_at")
            .eq("discovery_source", "canali-inspo")
            .not("audio_url", "is", null)
            .or(
              `published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`,
            )
            .limit(2000);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          type Row = {
            id: string;
            audio_url: string | null;
            audio_fingerprint: number[] | null;
            author: string | null;
          };
          const rows = (data ?? []) as Row[];

          // --- Passata 1: match esatto su audio_url ---
          const byAudioUrl = new Map<string, Row[]>();
          for (const row of rows) {
            if (!row.audio_url) continue;
            const group = byAudioUrl.get(row.audio_url) ?? [];
            group.push(row);
            byAudioUrl.set(row.audio_url, group);
          }

          const exactQualifiedIds = new Set<string>();
          let exactPromoted = 0;
          let exactReset = 0;

          for (const group of byAudioUrl.values()) {
            const channels = new Set(group.map((r) => r.author).filter((a): a is string => !!a));
            const qualifies = group.length >= MIN_REEL_COUNT && channels.size >= MIN_CHANNEL_COUNT;

            const { error: updateError } = await supabaseAdmin
              .from("viral_trend_content")
              .update({
                audio_trend_reel_count: qualifies ? group.length : null,
                audio_trend_channel_count: qualifies ? channels.size : null,
                audio_trend_matched_by: qualifies ? "exact" : null,
              })
              .in(
                "id",
                group.map((r) => r.id),
              );

            if (!updateError) {
              if (qualifies) {
                exactPromoted += group.length;
                for (const r of group) exactQualifiedIds.add(r.id);
              } else {
                exactReset += group.length;
              }
            }
          }

          // --- Passata 2: fingerprint acustico, solo sui rimasti fuori ---
          // Union-find "quasi-lineare" (array padre + path compression):
          // per ogni coppia con similarità sopra soglia, unisce i due
          // gruppi — dataset atteso piccolo (Reel Canali Inspo di 7gg con
          // fingerprint calcolato, limitati a MAX_FINGERPRINTS_PER_RUN per
          // giro in discover-canali-inspo-content.mjs), il confronto O(n²)
          // è accettabile. Tetto di sicurezza comunque presente: se il
          // numero di candidati crescesse molto (più fonti di fingerprint
          // in futuro), il confronto si ferma ai più recenti invece di
          // crescere senza limite nel tempo di esecuzione dell'hook.
          const MAX_FINGERPRINT_CANDIDATES = 300;
          const allCandidates = rows.filter(
            (r) => !exactQualifiedIds.has(r.id) && r.audio_fingerprint != null && r.audio_fingerprint.length > 0,
          );
          const candidates = allCandidates.slice(0, MAX_FINGERPRINT_CANDIDATES);

          const parent = candidates.map((_, i) => i);
          function find(i: number): number {
            while (parent[i] !== i) {
              parent[i] = parent[parent[i]];
              i = parent[i];
            }
            return i;
          }
          function union(a: number, b: number) {
            const ra = find(a);
            const rb = find(b);
            if (ra !== rb) parent[ra] = rb;
          }

          for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
              const fpA = candidates[i].audio_fingerprint;
              const fpB = candidates[j].audio_fingerprint;
              if (!fpA || !fpB) continue;
              const similarity = fingerprintSimilarity(fpA, fpB);
              if (similarity != null && similarity >= FINGERPRINT_MATCH_THRESHOLD) {
                union(i, j);
              }
            }
          }

          const fingerprintGroups = new Map<number, Row[]>();
          candidates.forEach((row, i) => {
            const root = find(i);
            const group = fingerprintGroups.get(root) ?? [];
            group.push(row);
            fingerprintGroups.set(root, group);
          });

          let fingerprintPromoted = 0;

          for (const group of fingerprintGroups.values()) {
            if (group.length < 2) continue; // nessun gruppo, non serve toccare la riga (già null dalla passata 1)
            const channels = new Set(group.map((r) => r.author).filter((a): a is string => !!a));
            const qualifies = group.length >= MIN_REEL_COUNT && channels.size >= MIN_CHANNEL_COUNT;
            if (!qualifies) continue;

            const { error: updateError } = await supabaseAdmin
              .from("viral_trend_content")
              .update({
                audio_trend_reel_count: group.length,
                audio_trend_channel_count: channels.size,
                audio_trend_matched_by: "fingerprint",
              })
              .in(
                "id",
                group.map((r) => r.id),
              );

            if (!updateError) fingerprintPromoted += group.length;
          }

          return Response.json({
            ok: true,
            audioUrlGroups: byAudioUrl.size,
            exactPromoted,
            exactReset,
            fingerprintCandidates: candidates.length,
            fingerprintPromoted,
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
