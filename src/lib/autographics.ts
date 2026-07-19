import { supabase } from "@/integrations/supabase/client";

// Data layer di SBAM AutoGraphics: rubriche/template Figma, vincoli anti-overflow,
// coda di generazione grafiche (graphic_jobs) e candidati foto Getty Images.
//
// Le tabelle non sono ancora nei tipi generati del client Supabase (verranno
// rigenerati dopo il merge della migration): stesso pattern di editorialPlan.ts,
// passiamo dal cast invece di rigenerare types.ts ad ogni modifica.
const db = supabase as any;

export type TipoTemplate = "photo_card" | "text_icon_card";

export type GraphicJobStatus =
  "pending_validation" | "pending_image" | "ready_for_render" | "rendering" | "done" | "error";

export type GraphicJobFormatStatus = "pending" | "rendering" | "done" | "error";

export interface Rubrica {
  id: string;
  nome: string;
  tipo_template: TipoTemplate;
  // Opzionali: servono solo alle rubriche che usano ancora il vecchio
  // percorso plugin Figma. Le rubriche basate su Canva Bulk Create (il
  // percorso corrente) non li valorizzano.
  figma_file_key: string | null;
  figma_component_id: string | null;
  attiva: boolean;
  created_at: string;
}

export interface RubricaFormato {
  id: string;
  rubrica_id: string;
  formato: string;
  figma_component_id: string | null;
  width_px: number;
  height_px: number;
  attivo: boolean;
  created_at: string;
}

export type LayerType = "text" | "image";

export interface TemplateConstraint {
  id: string;
  rubrica_id: string;
  layer_name: string;
  layer_type: LayerType;
  // Card (slide) di appartenenza nell'editor rubriche: 1 = prima card. Non
  // influisce sull'export (che lavora su un elenco piatto layer_name->valore),
  // serve solo a ricostruire il raggruppamento in RubrichePanel.
  card_index: number;
  max_chars: number | null;
  min_font_size: number | null;
  max_font_size: number | null;
  max_lines: number | null;
  obbligatorio: boolean;
  created_at: string;
}

export interface GraphicJob {
  id: string;
  post_id: string;
  rubrica_id: string;
  copy_payload: Record<string, string>;
  getty_asset_id: string | null;
  getty_image_url: string | null;
  status: GraphicJobStatus;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphicJobFormat {
  id: string;
  job_id: string;
  formato: string;
  figma_component_id: string | null;
  width_px: number | null;
  height_px: number | null;
  status: GraphicJobFormatStatus;
  output_url: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface GettyCandidate {
  id: string;
  job_id: string;
  // Campo immagine (layer_name del constraint, es. "#image1") a cui si
  // riferisce questa ricerca: un job con più campi #image ha una ricerca e
  // una selezione Getty indipendenti per ciascuno.
  layer_name: string;
  asset_id: string;
  preview_url: string;
  title: string | null;
  orientamento: string | null;
  selected: boolean;
  created_at: string;
}

export type ImageSource = "getty" | "upload";

// L'immagine attualmente attiva per un campo #image di un job: o una foto
// Getty selezionata tra i candidati, o un file caricato manualmente
// dall'utente in alternativa alla ricerca Getty. Un solo record per
// (job_id, layer_name): scegliere/caricare un'altra immagine sostituisce la
// precedente.
export interface GraphicJobImage {
  id: string;
  job_id: string;
  layer_name: string;
  source: ImageSource;
  image_url: string;
  asset_id: string | null;
  created_at: string;
}

// --- Rubriche ---------------------------------------------------------

export async function listRubriche(onlyAttive = false): Promise<Rubrica[]> {
  let query = db.from("rubriche").select("*").order("nome", { ascending: true });
  if (onlyAttive) query = query.eq("attiva", true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRubrica(id: string): Promise<Rubrica | null> {
  const { data, error } = await db.from("rubriche").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createRubrica(input: Omit<Rubrica, "id" | "created_at">): Promise<Rubrica> {
  const { data, error } = await db.from("rubriche").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateRubrica(
  id: string,
  fields: Partial<Omit<Rubrica, "id" | "created_at">>,
): Promise<void> {
  const { error } = await db.from("rubriche").update(fields).eq("id", id);
  if (error) throw error;
}

// graphic_jobs.rubrica_id non ha "on delete cascade" (a differenza di
// rubrica_formati/template_constraints/template_elements): senza cancellarli
// prima, l'eliminazione della rubrica fallirebbe con una violazione di
// foreign key non appena esiste almeno un job collegato.
export async function deleteRubrica(id: string): Promise<void> {
  const { error: jobsError } = await db.from("graphic_jobs").delete().eq("rubrica_id", id);
  if (jobsError) throw jobsError;
  const { error } = await db.from("rubriche").delete().eq("id", id);
  if (error) throw error;
}

// --- Formati per rubrica -----------------------------------------------

export async function listRubricaFormati(
  rubricaId: string,
  onlyAttivi = true,
): Promise<RubricaFormato[]> {
  let query = db.from("rubrica_formati").select("*").eq("rubrica_id", rubricaId).order("formato");
  if (onlyAttivi) query = query.eq("attivo", true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function upsertRubricaFormato(
  input: Omit<RubricaFormato, "id" | "created_at"> & { id?: string },
): Promise<RubricaFormato> {
  const { data, error } = await db
    .from("rubrica_formati")
    .upsert(input, { onConflict: "rubrica_id,formato" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// --- Vincoli template (anti-overflow) -----------------------------------

export async function listTemplateConstraints(rubricaId: string): Promise<TemplateConstraint[]> {
  const { data, error } = await db
    .from("template_constraints")
    .select("*")
    .eq("rubrica_id", rubricaId)
    .order("card_index")
    .order("layer_name");
  if (error) throw error;
  return data ?? [];
}

export async function upsertTemplateConstraint(
  input: Omit<TemplateConstraint, "id" | "created_at"> & { id?: string },
): Promise<TemplateConstraint> {
  const { data, error } = await db
    .from("template_constraints")
    .upsert(input, { onConflict: "rubrica_id,layer_name" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Sostituisce tutti i campi di una rubrica in un colpo solo (delete + insert),
// usata dall'editor visuale RubrichePanel dove l'utente ricompone
// liberamente card e campi ad ogni salvataggio.
export async function replaceTemplateConstraints(
  rubricaId: string,
  constraints: Array<Omit<TemplateConstraint, "id" | "rubrica_id" | "created_at">>,
): Promise<TemplateConstraint[]> {
  const { error: deleteError } = await db
    .from("template_constraints")
    .delete()
    .eq("rubrica_id", rubricaId);
  if (deleteError) throw deleteError;
  if (constraints.length === 0) return [];
  const rows = constraints.map((c) => ({ ...c, rubrica_id: rubricaId }));
  const { data, error } = await db.from("template_constraints").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

// --- Graphic jobs --------------------------------------------------------

export async function getGraphicJob(id: string): Promise<GraphicJob | null> {
  const { data, error } = await db.from("graphic_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getJobForPost(postId: string): Promise<GraphicJob | null> {
  const { data, error } = await db
    .from("graphic_jobs")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createGraphicJob(input: {
  post_id: string;
  rubrica_id: string;
  copy_payload: Record<string, string>;
}): Promise<GraphicJob> {
  const { data, error } = await db
    .from("graphic_jobs")
    .insert({ ...input, status: "pending_validation" as GraphicJobStatus })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateGraphicJob(
  id: string,
  fields: Partial<
    Pick<
      GraphicJob,
      "copy_payload" | "getty_asset_id" | "getty_image_url" | "status" | "error_detail"
    >
  >,
): Promise<void> {
  const { error } = await db
    .from("graphic_jobs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listGraphicJobFormats(jobId: string): Promise<GraphicJobFormat[]> {
  const { data, error } = await db
    .from("graphic_job_formats")
    .select("*")
    .eq("job_id", jobId)
    .order("formato");
  if (error) throw error;
  return data ?? [];
}

// Crea lo snapshot dei formati da renderizzare per il job, a partire dai
// formati attivi configurati sulla rubrica al momento dell'approvazione.
export async function createGraphicJobFormatsFromRubrica(
  jobId: string,
  rubricaId: string,
): Promise<GraphicJobFormat[]> {
  const formati = await listRubricaFormati(rubricaId, true);
  if (formati.length === 0) return [];
  const rows = formati.map((f) => ({
    job_id: jobId,
    formato: f.formato,
    figma_component_id: f.figma_component_id,
    width_px: f.width_px,
    height_px: f.height_px,
    status: "pending" as GraphicJobFormatStatus,
  }));
  const { data, error } = await db.from("graphic_job_formats").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

// --- Candidati Getty ---------------------------------------------------
// Ricerca e selezione sono scoped al singolo campo immagine (layer_name):
// un job con #image1/#image2/#image3 ha tre ricerche indipendenti.

export async function listGettyCandidates(
  jobId: string,
  layerName: string,
): Promise<GettyCandidate[]> {
  const { data, error } = await db
    .from("getty_candidates")
    .select("*")
    .eq("job_id", jobId)
    .eq("layer_name", layerName)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function replaceGettyCandidates(
  jobId: string,
  layerName: string,
  candidates: Array<
    Omit<GettyCandidate, "id" | "job_id" | "layer_name" | "created_at" | "selected">
  >,
): Promise<GettyCandidate[]> {
  const { error: deleteError } = await db
    .from("getty_candidates")
    .delete()
    .eq("job_id", jobId)
    .eq("layer_name", layerName);
  if (deleteError) throw deleteError;
  if (candidates.length === 0) return [];
  const rows = candidates.map((c) => ({
    ...c,
    job_id: jobId,
    layer_name: layerName,
    selected: false,
  }));
  const { data, error } = await db.from("getty_candidates").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

// Seleziona un candidato Getty per il campo e aggiorna in un colpo solo
// graphic_job_images (l'immagine "attiva" per quel layer diventa questa).
export async function selectGettyCandidate(
  jobId: string,
  layerName: string,
  candidateId: string,
): Promise<void> {
  const { error: clearError } = await db
    .from("getty_candidates")
    .update({ selected: false })
    .eq("job_id", jobId)
    .eq("layer_name", layerName);
  if (clearError) throw clearError;
  const { data: selected, error: setError } = await db
    .from("getty_candidates")
    .update({ selected: true })
    .eq("id", candidateId)
    .select("*")
    .single();
  if (setError) throw setError;
  await upsertGraphicJobImage({
    job_id: jobId,
    layer_name: layerName,
    source: "getty",
    image_url: selected.preview_url,
    asset_id: selected.asset_id,
  });
}

// --- Immagine attiva per campo (graphic_job_images) ---------------------

export async function listGraphicJobImages(jobId: string): Promise<GraphicJobImage[]> {
  const { data, error } = await db.from("graphic_job_images").select("*").eq("job_id", jobId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertGraphicJobImage(
  input: Omit<GraphicJobImage, "id" | "created_at">,
): Promise<GraphicJobImage> {
  const { data, error } = await db
    .from("graphic_job_images")
    .upsert(input, { onConflict: "job_id,layer_name" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Caricamento manuale in alternativa alla ricerca Getty: l'utente carica un
// file per il campo, che diventa l'immagine attiva per quel layer (sostitusce
// un'eventuale selezione Getty precedente sullo stesso campo).
export async function uploadJobImage(
  jobId: string,
  layerName: string,
  file: File,
): Promise<GraphicJobImage> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `uploads/${jobId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("graphics-output").upload(path, file);
  if (uploadError) throw uploadError;
  const { data: pub } = supabase.storage.from("graphics-output").getPublicUrl(path);
  return upsertGraphicJobImage({
    job_id: jobId,
    layer_name: layerName,
    source: "upload",
    image_url: pub.publicUrl,
    asset_id: null,
  });
}

// Sottoscrizione Realtime allo stato di un job e dei suoi formati: chiama
// onChange a ogni INSERT/UPDATE/DELETE su graphic_jobs (questo id) o
// graphic_job_formats (questo job_id). Ritorna una funzione di cleanup.
export function subscribeToJob(jobId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`graphic-job-${jobId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "graphic_jobs", filter: `id=eq.${jobId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "graphic_job_formats", filter: `job_id=eq.${jobId}` },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// --- Collegamento post <-> rubrica AutoGraphics --------------------------

// Aggiorna solo editorial_posts.rubrica_id (FK verso rubriche aggiunta dalla
// migration SBAM). Il campo testo libero editorial_posts.rubrica resta
// invariato: sono due cose diverse (vedi migration).
export async function setPostRubricaId(postId: string, rubricaId: string | null): Promise<void> {
  const { error } = await db
    .from("editorial_posts")
    .update({ rubrica_id: rubricaId })
    .eq("id", postId);
  if (error) throw error;
}

// Crea il job per il post se non esiste, altrimenti aggiorna copy_payload e
// riporta lo stato a pending_validation (una modifica al copy invalida un
// eventuale ready_for_render/error precedente).
export async function upsertGraphicJob(input: {
  post_id: string;
  rubrica_id: string;
  copy_payload: Record<string, string>;
}): Promise<GraphicJob> {
  const existing = await getJobForPost(input.post_id);
  if (existing) {
    await updateGraphicJob(existing.id, {
      copy_payload: input.copy_payload,
      status: "pending_validation",
      error_detail: null,
    });
    const refreshed = await getGraphicJob(existing.id);
    if (!refreshed) throw new Error("Job non trovato dopo l'update");
    // Se cambia la rubrica del job, la aggiorniamo separatamente (raro).
    if (existing.rubrica_id !== input.rubrica_id) {
      const { error } = await db
        .from("graphic_jobs")
        .update({ rubrica_id: input.rubrica_id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw error;
      return { ...refreshed, rubrica_id: input.rubrica_id };
    }
    return refreshed;
  }
  return createGraphicJob(input);
}

// --- Export CSV per Canva Bulk Create --------------------------------------

// Un job pronto per l'export, coi valori già risolti per colonna: i layer di
// tipo immagine prendono l'immagine attiva per quel campo da
// graphic_job_images (una per layer_name, non un'unica foto per job — un
// job con #image1/#image2/#image3 ha tre immagini indipendenti).
export interface ExportableJob {
  job_id: string;
  post_id: string;
  post_date: string;
  values: Record<string, string>;
}

// Job con status ready_for_render per una rubrica, filtrati sui post passati
// (tipicamente quelli del mese corrente visualizzato in Piano Editoriale).
// Ritorna anche i template_constraints della rubrica (servono per sapere
// quali colonne includere e quali sono di tipo immagine).
export async function listExportableJobs(
  rubricaId: string,
  postIds: string[],
): Promise<{ jobs: ExportableJob[]; constraints: TemplateConstraint[] }> {
  const constraints = await listTemplateConstraints(rubricaId);
  if (postIds.length === 0) return { jobs: [], constraints };

  const { data, error } = await db
    .from("graphic_jobs")
    .select("id, post_id, copy_payload, editorial_posts(post_date)")
    .eq("rubrica_id", rubricaId)
    .eq("status", "ready_for_render")
    .in("post_id", postIds);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    post_id: string;
    copy_payload: Record<string, string>;
    editorial_posts: { post_date: string } | null;
  }>;

  const imagesByJob = new Map<string, Map<string, string>>();
  const jobIds = rows.map((r) => r.id);
  if (jobIds.length > 0) {
    const { data: images, error: imgError } = await db
      .from("graphic_job_images")
      .select("job_id, layer_name, image_url")
      .in("job_id", jobIds);
    if (imgError) throw imgError;
    for (const img of (images ?? []) as Array<{
      job_id: string;
      layer_name: string;
      image_url: string;
    }>) {
      const perLayer = imagesByJob.get(img.job_id) ?? new Map<string, string>();
      perLayer.set(img.layer_name, img.image_url);
      imagesByJob.set(img.job_id, perLayer);
    }
  }

  const jobs: ExportableJob[] = rows.map((row) => {
    const perLayer = imagesByJob.get(row.id);
    const values: Record<string, string> = {};
    for (const c of constraints) {
      values[c.layer_name] =
        c.layer_type === "image"
          ? (perLayer?.get(c.layer_name) ?? "")
          : (row.copy_payload[c.layer_name] ?? "");
    }
    return {
      job_id: row.id,
      post_id: row.post_id,
      post_date: row.editorial_posts?.post_date ?? "",
      values,
    };
  });

  return { jobs, constraints };
}

// Segna i job come esportati (riusa lo stato "done": in questa pipeline
// significa "incluso in un export CSV per Canva", non "renderizzato" — non
// c'è modo di sapere automaticamente se/quando l'utente ha effettivamente
// completato il Bulk Create su Canva).
export async function markJobsExported(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await db
    .from("graphic_jobs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .in("id", jobIds);
  if (error) throw error;
}
