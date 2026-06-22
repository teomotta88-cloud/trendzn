import { supabase } from "@/integrations/supabase/client";

export type ReviewComponent = "copy" | "copy_visual" | "visual";

export interface EditorialPlan {
  id: string;
  year: number;
  month: number; // 1-12
  created_at: string;
}

export interface EditorialPost {
  id: string;
  plan_id: string;
  post_date: string; // YYYY-MM-DD
  rubrica: string | null;
  topic: string | null;
  canale: string | null;
  formato: string | null;
  copy: string | null;
  copy_visual: string | null;
  visual_url: string | null;
  visual_type: string | null;
  disclaimer: string | null;
  obiettivo_media: string | null;
  budget_media: number | null;
  created_at: string;
}

export interface EditorialPostComment {
  id: string;
  post_id: string;
  component: ReviewComponent;
  body: string;
  created_at: string;
}

export const MONTH_NAMES = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

// Le tabelle editorial_* non sono ancora nei tipi generati del client Supabase:
// passiamo dal cast per evitare di dover rigenerare types.ts ad ogni modifica.
const db = supabase as any;

export async function getOrCreatePlan(year: number, month: number): Promise<EditorialPlan> {
  const { data: existing } = await db
    .from("editorial_plans")
    .select("*")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await db.from("editorial_plans").insert({ year, month }).select("*").single();
  if (error) throw error;
  return created;
}

export async function listPosts(planId: string): Promise<EditorialPost[]> {
  const { data, error } = await db
    .from("editorial_posts")
    .select("*")
    .eq("plan_id", planId)
    .order("post_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createPost(input: Omit<EditorialPost, "id" | "created_at">): Promise<EditorialPost> {
  const { data, error } = await db.from("editorial_posts").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await db.from("editorial_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function getApprovalCounts(postId: string): Promise<Record<ReviewComponent, number>> {
  const { data, error } = await db.from("editorial_post_approvals").select("component").eq("post_id", postId);
  if (error) throw error;
  const counts: Record<ReviewComponent, number> = { copy: 0, copy_visual: 0, visual: 0 };
  (data ?? []).forEach((r: { component: ReviewComponent }) => {
    counts[r.component] = (counts[r.component] ?? 0) + 1;
  });
  return counts;
}

export async function approveComponent(postId: string, component: ReviewComponent): Promise<void> {
  const { error } = await db.from("editorial_post_approvals").insert({ post_id: postId, component });
  if (error) throw error;
}

export async function listComments(postId: string): Promise<EditorialPostComment[]> {
  const { data, error } = await db
    .from("editorial_post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addComment(
  postId: string,
  component: ReviewComponent,
  body: string,
): Promise<EditorialPostComment> {
  const { data, error } = await db
    .from("editorial_post_comments")
    .insert({ post_id: postId, component, body })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function uploadVisual(file: File): Promise<{ url: string; type: string }> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("piano-editoriale").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("piano-editoriale").getPublicUrl(path);
  return { url: data.publicUrl, type: file.type };
}
