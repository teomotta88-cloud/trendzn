import { supabase } from "@/integrations/supabase/client";

export type ReviewComponent = "copy" | "copy_visual" | "visual";

export const CHANNELS = [
  { code: "IG", label: "Instagram" },
  { code: "IGS", label: "Instagram Stories" },
  { code: "FB", label: "Facebook" },
  { code: "TT", label: "TikTok" },
  { code: "LK", label: "LinkedIn" },
  { code: "X", label: "X" },
  { code: "YT", label: "YouTube" },
] as const;

export type ChannelCode = (typeof CHANNELS)[number]["code"];

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
  canali: string[];
  formato: string | null;
  channel_copies: Record<string, string>;
  copy_visual: string | null;
  visual_url: string | null;
  visual_type: string | null;
  disclaimer: string | null;
  obiettivo_media: string | null;
  budget_media: number | null;
  created_at: string;
}

export interface EditorialPostMedia {
  id: string;
  post_id: string;
  url: string;
  type: string | null;
  position: number;
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

export async function updatePostText(id: string, field: "copy_visual", value: string | null): Promise<void> {
  const { error } = await db.from("editorial_posts").update({ [field]: value }).eq("id", id);
  if (error) throw error;
}

export async function updateChannelCopy(
  id: string,
  channel: string,
  value: string | null,
  channelCopies: Record<string, string>,
): Promise<Record<string, string>> {
  const next = { ...channelCopies };
  if (value) next[channel] = value;
  else delete next[channel];
  const { error } = await db.from("editorial_posts").update({ channel_copies: next }).eq("id", id);
  if (error) throw error;
  return next;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await db.from("editorial_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function getApprovalStatus(postId: string): Promise<Record<ReviewComponent, boolean>> {
  const { data, error } = await db.from("editorial_post_approvals").select("component").eq("post_id", postId);
  if (error) throw error;
  const status: Record<ReviewComponent, boolean> = { copy: false, copy_visual: false, visual: false };
  (data ?? []).forEach((r: { component: ReviewComponent }) => {
    status[r.component] = true;
  });
  return status;
}

export async function toggleApproval(postId: string, component: ReviewComponent, approved: boolean): Promise<void> {
  if (approved) {
    const { error } = await db.from("editorial_post_approvals").delete().eq("post_id", postId).eq("component", component);
    if (error) throw error;
  } else {
    const { error } = await db.from("editorial_post_approvals").insert({ post_id: postId, component });
    if (error) throw error;
  }
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

export async function listMedia(postId: string): Promise<EditorialPostMedia[]> {
  const { data, error } = await db
    .from("editorial_post_media")
    .select("*")
    .eq("post_id", postId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addMedia(postId: string, file: File): Promise<EditorialPostMedia> {
  const uploaded = await uploadVisual(file);
  const existing = await listMedia(postId);
  const nextPosition = existing.length > 0 ? Math.max(...existing.map((m) => m.position)) + 1 : 0;
  const { data, error } = await db
    .from("editorial_post_media")
    .insert({ post_id: postId, url: uploaded.url, type: uploaded.type, position: nextPosition })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMedia(id: string): Promise<void> {
  const { error } = await db.from("editorial_post_media").delete().eq("id", id);
  if (error) throw error;
}

export async function swapMediaPosition(a: EditorialPostMedia, b: EditorialPostMedia): Promise<void> {
  const { error: errA } = await db.from("editorial_post_media").update({ position: b.position }).eq("id", a.id);
  if (errA) throw errA;
  const { error: errB } = await db.from("editorial_post_media").update({ position: a.position }).eq("id", b.id);
  if (errB) throw errB;
}
