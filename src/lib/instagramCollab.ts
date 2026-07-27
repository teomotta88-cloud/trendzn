import { supabase } from "@/integrations/supabase/client";

export type ProfileKind = "brand" | "influencer";

export interface MonitoredProfile {
  id: string;
  username: string;
  kind: ProfileKind;
  industry: string | null;
  display_name: string | null;
  active: boolean;
  check_interval_minutes: number;
  first_checked_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}

export interface CollabPost {
  id: string;
  shortcode: string;
  url: string;
  owner_username: string;
  published_at: string | null;
  collaborators: string[];
}

export type CollabWindow = "1m" | "3m" | "6m" | "1y";

const WINDOW_DAYS: Record<CollabWindow, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 182,
  "1y": 365,
};

export async function listMonitoredProfiles(): Promise<MonitoredProfile[]> {
  const { data, error } = await supabase
    .from("instagram_monitored_profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MonitoredProfile[];
}

// Un brand caricato manualmente con la sua industry: il worker di sync
// (scripts/sync-instagram-collab.mjs, via l'hook sync-instagram-collab)
// lo prende in carico al primo run utile in base a check_interval_minutes —
// non c'è un backfill immediato, vedi
// supabase/migrations/20260727100000_instagram_collab_monitoring.sql.
export async function addBrandProfile(input: {
  username: string;
  industry: string;
  checkIntervalMinutes?: number;
}): Promise<void> {
  const username = input.username.trim().replace(/^@/, "");
  const industry = input.industry.trim();
  if (!username || !industry) throw new Error("Username e industry sono obbligatori.");

  const { error } = await supabase.from("instagram_monitored_profiles").insert({
    username,
    kind: "brand",
    industry,
    check_interval_minutes: input.checkIntervalMinutes ?? 1440,
  });
  if (error) throw error;
}

// Industry distinte tra tutti gli influencer scoperti finora (per il filtro
// nell'elenco) — un influencer può averne più di una, se ha collaborato con
// brand di industry diverse.
export async function listInfluencerIndustries(): Promise<string[]> {
  const { data, error } = await supabase.from("instagram_influencer_industries").select("industry");
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.industry))].sort();
}

// Mappa username influencer -> industry associate, per filtrare l'elenco
// profili lato client senza bisogno di una join nativa (influencer_username
// è un testo libero, non una FK verso instagram_monitored_profiles: un
// influencer può comparire prima come collaboratore che come profilo
// promosso).
export async function listInfluencerIndustryMap(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("instagram_influencer_industries")
    .select("influencer_username, industry");
  if (error) throw error;

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.influencer_username) ?? [];
    list.push(row.industry);
    map.set(row.influencer_username, list);
  }
  return map;
}

// Conteggio collab per influencer nella finestra temporale scelta.
//
// Semplificazione nota: conta ogni post con >=2 collaboratori distinti in
// cui l'username compare, indipendentemente da chi risulta owner_username
// per quel post — se in futuro monitoriamo direttamente il profilo
// dell'influencer e RSS-Bridge lo ritrova come owner dello stesso post
// (stesso shortcode), l'ultimo check "vince" sull'owner_username salvato,
// ma il post viene comunque contato una sola volta per via della dedup su
// post_id.
export async function getCollabCounts(window: CollabWindow): Promise<Map<string, number>> {
  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS[window]);

  const { data, error } = await supabase
    .from("instagram_post_collaborators")
    .select("username, post_id, instagram_posts!inner(published_at)")
    .gte("instagram_posts.published_at", since.toISOString());
  if (error) throw error;

  const collaboratorsByPost = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = collaboratorsByPost.get(row.post_id) ?? new Set<string>();
    set.add(row.username);
    collaboratorsByPost.set(row.post_id, set);
  }

  const counts = new Map<string, number>();
  for (const usernames of collaboratorsByPost.values()) {
    if (usernames.size < 2) continue; // non un vero collab, solo l'autore
    for (const username of usernames) {
      counts.set(username, (counts.get(username) ?? 0) + 1);
    }
  }
  return counts;
}

// Tutti i post in collab (>=2 collaboratori distinti) in cui questo username
// compare — sia come owner (post pubblicato direttamente da lui) sia come
// collaboratore taggato sul post di un altro profilo monitorato.
export async function listCollabPostsForUsername(username: string): Promise<CollabPost[]> {
  const { data: collabRows, error } = await supabase
    .from("instagram_post_collaborators")
    .select("post_id")
    .eq("username", username);
  if (error) throw error;

  const postIds = [...new Set((collabRows ?? []).map((r) => r.post_id))];
  if (postIds.length === 0) return [];

  const { data: posts, error: postsError } = await supabase
    .from("instagram_posts")
    .select("id, shortcode, url, owner_username, published_at")
    .in("id", postIds)
    .order("published_at", { ascending: false, nullsFirst: false });
  if (postsError) throw postsError;

  const { data: allCollaborators, error: collabError } = await supabase
    .from("instagram_post_collaborators")
    .select("post_id, username")
    .in("post_id", postIds);
  if (collabError) throw collabError;

  const collaboratorsByPost = new Map<string, string[]>();
  for (const row of allCollaborators ?? []) {
    const list = collaboratorsByPost.get(row.post_id) ?? [];
    list.push(row.username);
    collaboratorsByPost.set(row.post_id, list);
  }

  return (posts ?? [])
    .map((p) => ({ ...p, collaborators: collaboratorsByPost.get(p.id) ?? [] }))
    .filter((p) => p.collaborators.length >= 2);
}
