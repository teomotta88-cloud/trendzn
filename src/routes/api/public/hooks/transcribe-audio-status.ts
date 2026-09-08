import { createFileRoute } from "@tanstack/react-router";

// Trascrizione Audio: poll dello stato di una trascrizione avviata da
// transcribe-audio-start.ts. Chiamato dalla UI ogni pochi secondi finché lo
// stato non è "completed" o "error". Interroga AssemblyAI solo se la riga
// non è già in uno stato finale (evita chiamate inutili una volta finito).

const ASSEMBLYAI_URL = "https://api.assemblyai.com/v2/transcript";

interface AssemblyUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface AssemblyTranscript {
  status: "queued" | "processing" | "completed" | "error";
  text?: string | null;
  utterances?: AssemblyUtterance[] | null;
  error?: string | null;
}

export const Route = createFileRoute("/api/public/hooks/transcribe-audio-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { id?: string };
          const id = body.id?.trim();
          if (!id) {
            return Response.json({ ok: false, error: "id è obbligatorio" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: row, error: fetchError } = await (supabaseAdmin as any)
            .from("audio_transcriptions")
            .select("*")
            .eq("id", id)
            .single();
          if (fetchError || !row) {
            return Response.json({ ok: false, error: "Trascrizione non trovata" }, { status: 404 });
          }

          if (row.status === "completed" || row.status === "error") {
            return Response.json({ ok: true, transcription: row });
          }

          if (!row.provider_job_id) {
            // Il job AssemblyAI non è ancora stato creato (o start.ts è
            // fallito a metà): resta "processing", il client riprova.
            return Response.json({ ok: true, transcription: row, providerStatus: "queued" });
          }

          const apiKey = process.env.ASSEMBLYAI_API_KEY;
          if (!apiKey) {
            return Response.json(
              { ok: false, error: "ASSEMBLYAI_API_KEY non configurata nell'ambiente dell'app" },
              { status: 500 },
            );
          }

          const assemblyRes = await fetch(`${ASSEMBLYAI_URL}/${row.provider_job_id}`, {
            headers: { authorization: apiKey },
            signal: AbortSignal.timeout(15000),
          });
          if (!assemblyRes.ok) {
            const detail = (await assemblyRes.text()).slice(0, 300);
            throw new Error(`AssemblyAI ha risposto ${assemblyRes.status}: ${detail}`);
          }
          const data = (await assemblyRes.json()) as AssemblyTranscript;

          if (data.status === "completed") {
            const utterances = (data.utterances ?? []).map((u) => ({
              speaker: u.speaker,
              text: u.text,
              startMs: u.start,
              endMs: u.end,
            }));
            const { data: updated, error: updateError } = await (supabaseAdmin as any)
              .from("audio_transcriptions")
              .update({
                status: "completed",
                transcript_text: data.text ?? null,
                utterances,
                updated_at: new Date().toISOString(),
              })
              .eq("id", id)
              .select("*")
              .single();
            if (updateError || !updated) throw new Error(updateError?.message ?? "update fallito");
            return Response.json({ ok: true, transcription: updated });
          }

          if (data.status === "error") {
            const { data: updated } = await (supabaseAdmin as any)
              .from("audio_transcriptions")
              .update({
                status: "error",
                error_detail: data.error ?? "Errore sconosciuto da AssemblyAI",
                updated_at: new Date().toISOString(),
              })
              .eq("id", id)
              .select("*")
              .single();
            return Response.json({ ok: true, transcription: updated ?? row });
          }

          // "queued" o "processing" lato AssemblyAI: la riga resta invariata.
          return Response.json({ ok: true, transcription: row, providerStatus: data.status });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
