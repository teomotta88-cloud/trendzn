import { supabase } from "@/integrations/supabase/client";

// Data layer dell'editor grafico interno (Fase 2 del percorso deciso al
// posto di Figma/Canva, vedi docs/sbam-autographics-canva.md): CRUD di
// template_elements, l'albero di elementi posizionati che l'editor visuale
// mostra e modifica, e che viene catturato in PNG lato client da
// src/lib/design-capture.ts. Stesso pattern di autographics.ts: tabella non
// ancora nei tipi generati del client Supabase, quindi cast invece di
// rigenerare types.ts.
const db = supabase as any;

export type ElementTipo = "text" | "image" | "icon" | "shape";

export interface TemplateElement {
  id: string;
  rubrica_id: string;
  // null = comune a tutti i formati della rubrica.
  formato: string | null;
  // null = contenuto fisso del design (non sostituito dai dati del job).
  layer_name: string | null;
  tipo: ElementTipo;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  style: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewTemplateElement = Omit<TemplateElement, "id" | "created_at" | "updated_at">;

// Input di replaceTemplateElements: rubrica_id/formato li imposta la
// funzione stessa (sono l'ambito su cui opera, non proprietà del singolo
// elemento lato chiamante).
export type TemplateElementInput = Omit<NewTemplateElement, "rubrica_id" | "formato">;

// Elementi di una rubrica per un formato: include sia quelli specifici del
// formato sia quelli comuni (formato = null), così l'editor li mostra
// assieme quando si lavora su un formato specifico.
export async function listTemplateElements(
  rubricaId: string,
  formato: string | null,
): Promise<TemplateElement[]> {
  const { data, error } = await db
    .from("template_elements")
    .select("*")
    .eq("rubrica_id", rubricaId)
    .or(formato ? `formato.is.null,formato.eq.${formato}` : "formato.is.null")
    .order("z_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Sostituisce tutti gli elementi di una rubrica per un dato ambito (formato
// specifico o null = comuni), stesso pattern "delete poi insert" di
// replaceTemplateConstraints in autographics.ts: l'editor visuale ricompone
// liberamente il design ad ogni salvataggio, non ha senso un merge riga per
// riga.
export async function replaceTemplateElements(
  rubricaId: string,
  formato: string | null,
  elements: TemplateElementInput[],
): Promise<TemplateElement[]> {
  let deleteQuery = db.from("template_elements").delete().eq("rubrica_id", rubricaId);
  deleteQuery = formato ? deleteQuery.eq("formato", formato) : deleteQuery.is("formato", null);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;
  if (elements.length === 0) return [];
  const rows = elements.map((el) => ({ ...el, rubrica_id: rubricaId, formato }));
  const { data, error } = await db.from("template_elements").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

// --- Font custom -----------------------------------------------------

export interface CustomFont {
  id: string;
  family_name: string;
  weight: number;
  style: "normal" | "italic";
  storage_path: string;
  created_at: string;
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const { data, error } = await db.from("custom_fonts").select("*").order("family_name");
  if (error) throw error;
  return data ?? [];
}

export async function uploadCustomFont(
  familyName: string,
  weight: number,
  style: "normal" | "italic",
  file: File,
): Promise<CustomFont> {
  const ext = file.name.split(".").pop() || "ttf";
  const path = `${familyName.replace(/\s+/g, "-").toLowerCase()}-${weight}-${style}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("custom-fonts").upload(path, file);
  if (uploadError) throw uploadError;
  const { data, error } = await db
    .from("custom_fonts")
    .upsert(
      { family_name: familyName, weight, style, storage_path: path },
      { onConflict: "family_name,weight,style" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export function getCustomFontPublicUrl(storagePath: string): string {
  return supabase.storage.from("custom-fonts").getPublicUrl(storagePath).data.publicUrl;
}

export async function deleteCustomFont(font: CustomFont): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from("custom-fonts")
    .remove([font.storage_path]);
  if (storageError) throw storageError;
  const { error } = await db.from("custom_fonts").delete().eq("id", font.id);
  if (error) throw error;
}

// --- Immagini editor (upload libero + rimozione sfondo, Fase 4) --------
// Riusa il bucket graphics-output già esistente (stesso bucket pubblico dei
// PNG generati dai job), sotto un prefisso dedicato: sono comunque asset
// grafici prodotti/usati dall'editor, non serve un bucket a parte.

export async function uploadEditorImage(file: Blob, extension = "png"): Promise<string> {
  const path = `editor-uploads/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("graphics-output").upload(path, file);
  if (error) throw error;
  return supabase.storage.from("graphics-output").getPublicUrl(path).data.publicUrl;
}
