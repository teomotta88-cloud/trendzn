import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, FileAudio, Download, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Pagina standalone (volutamente non in navLinks in __root.tsx: link
// condiviso a mano, non nel menu). Trascrizione audio->testo pensata per
// file grandi (interviste/riunioni lunghe, 100+MB): l'upload va diretto dal
// browser allo storage Supabase (mai attraverso il server dell'app), e la
// trascrizione con riconoscimento interlocutori è delegata ad AssemblyAI
// tramite i due hook transcribe-audio-start/status.

export const Route = createFileRoute("/trascrizione-audio")({
  head: () => ({
    meta: [
      { title: "Trascrizione Audio — Trendzn" },
      {
        name: "description",
        content:
          "Carica un file audio (anche grande) e ottieni una trascrizione con riconoscimento degli interlocutori, esportabile in Word.",
      },
    ],
  }),
  component: TrascrizioneAudioPage,
});

interface Utterance {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface Transcription {
  id: string;
  file_name: string;
  status: "processing" | "completed" | "error";
  transcript_text: string | null;
  utterances: Utterance[] | null;
  error_detail: string | null;
}

const LANGUAGES = [
  { value: "auto", label: "Rilevamento automatico" },
  { value: "it", label: "Italiano" },
  { value: "en", label: "Inglese" },
];

const POLL_INTERVAL_MS = 5000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, coerente col bucket

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function speakerLabel(speaker: string): string {
  return `Interlocutore ${speaker}`;
}

const SPEAKER_COLORS = [
  "text-blue-600 dark:text-blue-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-amber-600 dark:text-amber-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
  "text-rose-600 dark:text-rose-400",
  "text-cyan-600 dark:text-cyan-400",
];

function speakerColor(speaker: string): string {
  const index = speaker.charCodeAt(0) % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[index] ?? SPEAKER_COLORS[0];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Genera un .doc apribile da Word senza dipendenze esterne: un documento
// HTML con i namespace Office che Word riconosce e renderizza come un vero
// documento (titolo, interlocutori in grassetto, un paragrafo per turno di
// parola), non un file OOXML "vero" ma il trucco standard per l'export a
// Word lato browser.
function downloadAsWord(transcription: Transcription) {
  const title = `Trascrizione — ${transcription.file_name}`;
  const generatedAt = new Date().toLocaleString("it-IT");
  const body =
    transcription.utterances && transcription.utterances.length > 0
      ? transcription.utterances
          .map(
            (u) =>
              `<p style="margin:0 0 12pt 0;"><b>${escapeHtml(speakerLabel(u.speaker))}</b> ` +
              `<span style="color:#888;font-size:9pt;">[${formatTimestamp(u.startMs)}]</span><br/>` +
              `${escapeHtml(u.text)}</p>`,
          )
          .join("\n")
      : `<p>${escapeHtml(transcription.transcript_text ?? "")}</p>`;

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">
<h1 style="font-size:16pt;">${escapeHtml(title)}</h1>
<p style="color:#888;font-size:9pt;">Generato il ${escapeHtml(generatedAt)}</p>
${body}
</body></html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trascrizione-${transcription.file_name.replace(/\.[^.]+$/, "")}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function TrascrizioneAudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("auto");
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const poll = useCallback((id: string) => {
    fetch("/api/public/hooks/transcribe-audio-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then((res) => res.json())
      .then((data: { ok: boolean; error?: string; transcription?: Transcription }) => {
        if (!data.ok || !data.transcription) {
          setError(data.error ?? "Errore durante il controllo dello stato");
          setPhase("error");
          return;
        }
        setTranscription(data.transcription);
        if (data.transcription.status === "completed") {
          setPhase("done");
        } else if (data.transcription.status === "error") {
          setError(data.transcription.error_detail ?? "Errore durante la trascrizione");
          setPhase("error");
        } else {
          pollTimer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
        }
      })
      .catch((err) => {
        setError(String(err));
        setPhase("error");
      });
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`Il file supera il limite massimo di ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`);
      setPhase("error");
      return;
    }

    setError(null);
    setTranscription(null);
    setPhase("uploading");

    try {
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("audio-transcriptions")
        .upload(storagePath, file, { contentType: file.type || undefined });
      if (uploadError) throw uploadError;

      setPhase("processing");

      const res = await fetch("/api/public/hooks/transcribe-audio-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          fileName: file.name,
          fileSizeBytes: file.size,
          language: language === "auto" ? undefined : language,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; id?: string };
      if (!data.ok || !data.id) throw new Error(data.error ?? "Avvio trascrizione fallito");

      poll(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [file, language, poll]);

  const reset = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setFile(null);
    setError(null);
    setTranscription(null);
    setPhase("idle");
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Trascrizione Audio</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Carica un file audio (anche di grandi dimensioni, 100+MB): la trascrizione riconosce
          automaticamente i diversi interlocutori e il risultato è scaricabile come file Word.
        </p>
      </header>

      {(phase === "idle" || phase === "error") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nuova trascrizione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              htmlFor="audio-file-input"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input px-4 py-10 text-center hover:bg-accent/50"
            >
              <FileAudio className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <span className="text-sm font-medium">
                  {file.name} · {formatFileSize(file.size)}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Clicca per scegliere un file audio (o video) da trascrivere
                </span>
              )}
              <input
                id="audio-file-input"
                type="file"
                accept="audio/*,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button onClick={handleUpload} disabled={!file}>
                <Upload className="h-4 w-4" />
                Carica e trascrivi
              </Button>
            </div>

            {phase === "error" && error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {phase === "uploading" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm font-medium">Caricamento del file audio in corso…</p>
            <p className="text-xs text-muted-foreground">
              Per file grandi può richiedere qualche minuto: non chiudere questa pagina.
            </p>
          </CardContent>
        </Card>
      )}

      {phase === "processing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm font-medium">
              Trascrizione in corso (riconoscimento interlocutori)…
            </p>
            <p className="text-xs text-muted-foreground">
              Per file lunghi può richiedere diversi minuti. La pagina si aggiorna da sola.
            </p>
          </CardContent>
        </Card>
      )}

      {phase === "done" && transcription && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base">{transcription.file_name}</CardTitle>
            <div className="flex gap-2">
              <Button onClick={() => downloadAsWord(transcription)}>
                <Download className="h-4 w-4" />
                Scarica Word
              </Button>
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Nuova trascrizione
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto rounded-md border p-4">
              {transcription.utterances && transcription.utterances.length > 0 ? (
                transcription.utterances.map((u, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={speakerColor(u.speaker)}>
                        {speakerLabel(u.speaker)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(u.startMs)}
                      </span>
                    </div>
                    <p className="text-sm">{u.text}</p>
                  </div>
                ))
              ) : (
                <p className="whitespace-pre-wrap text-sm">{transcription.transcript_text}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
