import { supabase } from "@/integrations/supabase/client";
import { textSimilarity } from "@/lib/textSimilarity";

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

// Sentinel salvato in channel_copies quando un canale usa "Uguale al copy IG"
// invece di un testo proprio: evita di dover aggiungere una colonna dedicata.
export const SAME_AS_IG_FLAG = "__same_as_ig__";

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
  programmato: boolean;
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

export async function updatePost(
  id: string,
  fields: Partial<Omit<EditorialPost, "id" | "plan_id" | "created_at">>,
): Promise<EditorialPost> {
  const { data, error } = await db.from("editorial_posts").update(fields).eq("id", id).select("*").single();
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
  if (value) await matchPublishedPostsForChannel(id, channel, value);
  return next;
}

const MATCH_SIMILARITY_THRESHOLD = 0.55;
const MATCH_DATE_TOLERANCE_DAYS = 1;

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Cattura i casi in cui n8n ha importato un post pubblicato prima che il copy
// venisse scritto nel piano: a ogni salvataggio del copy proviamo a recuperare
// un match tra i post importati ancora senza match per quel canale.
export async function matchPublishedPostsForChannel(
  postId: string,
  channel: string,
  channelCopy: string,
): Promise<string | null> {
  const { data: post, error: postError } = await db
    .from("editorial_posts")
    .select("post_date")
    .eq("id", postId)
    .single();
  if (postError || !post) return null;

  const { data: candidates, error } = await db
    .from("editorial_published_posts")
    .select("id, url, caption")
    .eq("canale", channel)
    .is("matched_post_id", null)
    .gte("published_date", shiftDate(post.post_date, -MATCH_DATE_TOLERANCE_DAYS))
    .lte("published_date", shiftDate(post.post_date, MATCH_DATE_TOLERANCE_DAYS));
  if (error || !candidates) return null;

  let best: { id: string; url: string; score: number } | null = null;
  for (const candidate of candidates as { id: string; url: string; caption: string | null }[]) {
    if (!candidate.caption) continue;
    const score = textSimilarity(channelCopy, candidate.caption);
    if (score >= MATCH_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { id: candidate.id, url: candidate.url, score };
    }
  }
  if (!best) return null;

  const { error: updateError } = await db
    .from("editorial_published_posts")
    .update({ matched_post_id: postId })
    .eq("id", best.id);
  if (updateError) throw updateError;

  return best.url;
}

export interface PublishedPostMatch {
  url: string;
  canale: string;
}

export async function getPublishedMatches(postId: string): Promise<PublishedPostMatch[]> {
  const { data, error } = await db
    .from("editorial_published_posts")
    .select("url, canale")
    .eq("matched_post_id", postId);
  if (error) throw error;
  return data ?? [];
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

export interface EditorialClientChannel {
  id: string;
  canale: string;
  handle: string;
  url: string;
  created_at: string;
}

export async function listClientChannels(): Promise<EditorialClientChannel[]> {
  const { data, error } = await db
    .from("editorial_client_channels")
    .select("*")
    .order("canale", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addClientChannel(input: Omit<EditorialClientChannel, "id" | "created_at">): Promise<EditorialClientChannel> {
  const { data, error } = await db.from("editorial_client_channels").insert(input).select("*").single();
  if (error) throw error;

  // Scrive il canale anche in trends.json (chiave "canali_cliente") cosi'
  // n8n lo monitora con la stessa logica già usata per "canali_inspo",
  // senza bisogno di modifiche lato n8n.
  fetch("/api/public/hooks/add-client-channel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {});

  return data;
}

export async function deleteClientChannel(id: string): Promise<void> {
  const { error } = await db.from("editorial_client_channels").delete().eq("id", id);
  if (error) throw error;
}

const TRENDS_JSON_URL = "https://api.github.com/repos/teomotta88-cloud/trendzn/contents/src/data/trends.json";

const PLATFORM_TO_CANALE: Record<string, string> = {
  instagram: "IG",
  tiktok: "TT",
  linkedin: "LK",
  youtube: "YT",
  x: "X",
  facebook: "FB",
};

interface TrendsClientAccount {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
}

interface TrendsClienteChannel {
  accounts: TrendsClientAccount[];
}

async function fetchTrendsJsonCanaliCliente(): Promise<TrendsClienteChannel[]> {
  const res = await fetch(TRENDS_JSON_URL, { headers: { Accept: "application/vnd.github.v3+json" } });
  if (!res.ok) {
    console.error("[fetchTrendsJsonCanaliCliente] richiesta a GitHub fallita:", res.status, await res.text());
    return [];
  }
  const file = await res.json();
  const trends = JSON.parse(atob(file.content.replace(/\n/g, "")));
  return Array.isArray(trends.canali_cliente) ? trends.canali_cliente : [];
}

async function matchPublishedPostFromCaption(
  canale: string,
  publishedDate: string,
  caption: string,
): Promise<string | null> {
  const { data: candidates, error } = await db
    .from("editorial_posts")
    .select("id, channel_copies")
    .contains("canali", [canale])
    .gte("post_date", shiftDate(publishedDate, -MATCH_DATE_TOLERANCE_DAYS))
    .lte("post_date", shiftDate(publishedDate, MATCH_DATE_TOLERANCE_DAYS));
  if (error || !candidates) return null;
  console.log("[match] candidati nella finestra di data per", canale, ":", candidates.length);

  let best: { id: string; score: number } | null = null;
  for (const post of candidates as { id: string; channel_copies: Record<string, string> }[]) {
    const channelCopy = post.channel_copies?.[canale];
    if (!channelCopy) continue;
    const score = textSimilarity(channelCopy, caption);
    console.log("[match] score", score.toFixed(2), "per post", post.id);
    if (score >= MATCH_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { id: post.id, score };
    }
  }
  return best?.id ?? null;
}

// Legge trends.json (scritto da n8n sotto "canali_cliente" con la stessa
// logica già usata per "canali_inspo") e matcha i post trovati con il piano
// editoriale, popolando editorial_published_posts.
export async function syncPublishedPostsFromTrendsJson(): Promise<void> {
  const channels = await fetchTrendsJsonCanaliCliente();
  console.log("[syncPublishedPostsFromTrendsJson] canali_cliente trovati:", channels.length);

  for (const channel of channels) {
    for (const account of channel.accounts) {
      if (!account.date || !account.caption) continue;
      const canale = PLATFORM_TO_CANALE[account.platform];
      if (!canale) {
        console.log("[sync] platform non mappata:", account.platform, account.url);
        continue;
      }

      const publishedDate = account.date.slice(0, 10);
      const { data: existing } = await db
        .from("editorial_published_posts")
        .select("id, matched_post_id")
        .eq("canale", canale)
        .eq("url", account.url)
        .maybeSingle();

      if (existing?.matched_post_id) continue;

      const matchedPostId = await matchPublishedPostFromCaption(canale, publishedDate, account.caption);
      console.log("[sync]", canale, publishedDate, account.url, "-> matchedPostId:", matchedPostId);

      const { error } = await db.from("editorial_published_posts").upsert(
        {
          canale,
          url: account.url,
          published_date: publishedDate,
          caption: account.caption,
          matched_post_id: matchedPostId,
        },
        { onConflict: "canale,url" },
      );
      if (error) throw error;
    }
  }
}

export async function reorderMedia(items: EditorialPostMedia[]): Promise<void> {
  const results = await Promise.all(
    items.map((item, position) =>
      item.position === position
        ? null
        : db.from("editorial_post_media").update({ position }).eq("id", item.id),
    ),
  );
  const error = results.find((r) => r?.error)?.error;
  if (error) throw error;
}
