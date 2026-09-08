import { createFileRoute } from "@tanstack/react-router";

// Trascrizione Audio (pagina standalone /trascrizione-audio, non in menu):
// avvia una trascrizione con riconoscimento interlocutori su un file già
// caricato dal browser nel bucket pubblico "audio-transcriptions" (upload
// diretto client -> Supabase Storage, mai attraverso questo hook: un file
// da 100+MB non deve passare per il Worker Cloudflare che serve l'app).
//
// Il lavoro pesante è delegato ad AssemblyAI: gli passiamo l'URL pubblico
// del file (lo scarica lui lato server, nessun limite di dimensione sul
// nostro hook) e la diarization è un parametro nativo della loro API
// (speaker_labels), niente da implementare qui. La API key va nell'ambiente
// di deploy dell'app, letta da process.env.ASSEMBLYAI_API_KEY (stesso
// pattern di OPENROUTER_API_KEY in extract-keywords.ts).

const ASSEMBLYAI_URL = "https://api.assemblyai.com/v2/transcript";

interface StartBody {
  storagePath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  // Codice lingua AssemblyAI (es. "it", "en"). Se assente, si usa il
  // riconoscimento automatico della lingua.
  language?: string;
}

export const Route = createFileRoute("/api/public/hooks/transcribe-audio-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as StartBody;
          const storagePath = body.storagePath?.trim();
          const fileName = body.fileName?.trim();
          if (!storagePath || !fileName) {
            return Response.json(
              { ok: false, error: "storagePath e fileName sono obbligatori" },
              { status: 400 },
            );
          }

          const apiKey = process.env.ASSEMBLYAI_API_KEY;
          if (!apiKey) {
            return Response.json(
              { ok: false, error: "ASSEMBLYAI_API_KEY non configurata nell'ambiente dell'app" },
              { status: 500 },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: publicUrlData } = supabaseAdmin.storage
            .from("audio-transcriptions")
            .getPublicUrl(storagePath);
          const audioUrl = publicUrlData.publicUrl;

          const { data: row, error: insertError } = await (supabaseAdmin as any)
            .from("audio_transcriptions")
            .insert({
              file_name: fileName,
              storage_path: storagePath,
              file_size_bytes: body.fileSizeBytes ?? null,
              language: body.language ?? null,
              status: "processing",
            })
            .select("id")
            .single();
          if (insertError || !row) {
            throw new Error(insertError?.message ?? "insert audio_transcriptions fallito");
          }

          const assemblyRes = await fetch(ASSEMBLYAI_URL, {
            method: "POST",
            headers: {
              authorization: apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              audio_url: audioUrl,
              speaker_labels: true,
              punctuate: true,
              format_text: true,
              ...(body.language ? { language_code: body.language } : { language_detection: true }),
            }),
            signal: AbortSignal.timeout(20000),
          });

          if (!assemblyRes.ok) {
            const detail = (await assemblyRes.text()).slice(0, 300);
            await (supabaseAdmin as any)
              .from("audio_transcriptions")
              .update({
                status: "error",
                error_detail: `AssemblyAI ha risposto ${assemblyRes.status}: ${detail}`,
              })
              .eq("id", row.id);
            return Response.json(
              { ok: false, error: `AssemblyAI ha risposto ${assemblyRes.status}: ${detail}` },
              { status: 502 },
            );
          }

          const assemblyData = (await assemblyRes.json()) as { id: string };
          await (supabaseAdmin as any)
            .from("audio_transcriptions")
            .update({ provider_job_id: assemblyData.id })
            .eq("id", row.id);

          return Response.json({ ok: true, id: row.id });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
