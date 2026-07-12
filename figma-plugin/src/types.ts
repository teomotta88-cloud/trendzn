// Tipi condivisi tra ui.ts (thread iframe, ha fetch/rete) e code.ts (thread
// sandbox, ha le API figma.*). Rispecchiano lo schema Supabase definito in
// supabase/migrations/20260711100000_sbam_autographics.sql e i tipi in
// src/lib/autographics.ts dell'app principale — se cambia lo schema là,
// aggiorna anche qui (progetti separati, nessun import condiviso possibile
// perché il plugin è un pacchetto npm a sé).

export type TipoTemplate = "photo_card" | "text_icon_card";

export interface Rubrica {
  id: string;
  nome: string;
  tipo_template: TipoTemplate;
  figma_file_key: string;
  figma_component_id: string;
  attiva: boolean;
}

export interface TemplateConstraint {
  id: string;
  rubrica_id: string;
  layer_name: string;
  max_chars: number | null;
  min_font_size: number | null;
  max_font_size: number | null;
  max_lines: number | null;
  obbligatorio: boolean;
}

export interface GraphicJobFormat {
  id: string;
  job_id: string;
  formato: string;
  figma_component_id: string | null;
  width_px: number | null;
  height_px: number | null;
  status: "pending" | "rendering" | "done" | "error";
  output_url: string | null;
  error_detail: string | null;
}

// Job così come arriva dalla query PostgREST con gli embed
// (rubriche(...), graphic_job_formats(...), template_constraints tramite
// una query separata perché non c'è FK diretta job -> constraints).
export interface JobBundle {
  id: string;
  post_id: string;
  rubrica_id: string;
  copy_payload: Record<string, string>;
  getty_image_url: string | null;
  status: string;
  rubrica: Rubrica;
  formats: GraphicJobFormat[];
  constraints: TemplateConstraint[];
}

export interface Credentials {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

// --- Messaggi tra ui.ts e code.ts ------------------------------------------

export type UiToCodeMessage =
  | { type: "load-credentials" }
  | { type: "save-credentials"; credentials: Credentials }
  | { type: "render-jobs"; jobs: JobBundle[] }
  | { type: "image-bytes"; requestId: string; bytes: Uint8Array | null; error?: string };

export type CodeToUiMessage =
  | { type: "credentials-loaded"; credentials: Credentials | null }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "need-image"; requestId: string; url: string }
  | {
      type: "job-format-error";
      jobId: string;
      formatId: string;
      detail: string;
    }
  | {
      type: "job-format-done";
      jobId: string;
      formatId: string;
      formato: string;
      fileName: string;
      bytes: Uint8Array;
    }
  | { type: "job-error"; jobId: string; detail: string }
  | { type: "job-done"; jobId: string }
  | { type: "processing-complete" };
