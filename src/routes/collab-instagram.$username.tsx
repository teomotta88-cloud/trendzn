import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SocialEmbed } from "@/components/SocialEmbed";
import {
  getMonitoredProfileByUsername,
  listPostsForUsername,
  type CollabPost,
  type MonitoredProfile,
} from "@/lib/instagramCollab";

export const Route = createFileRoute("/collab-instagram/$username")({
  head: ({ params }) => ({
    meta: [{ title: `@${params.username} — Collab Instagram` }],
  }),
  component: InfluencerCollabFeedPage,
});

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

type FeedFilter = "collab" | "all";

function formatFollowers(value: number | null): string {
  if (value == null) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M follower`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K follower`;
  return `${value} follower`;
}

function InfluencerCollabFeedPage() {
  const { username } = Route.useParams();
  const [filter, setFilter] = useState<FeedFilter>("collab");
  const [posts, setPosts] = useState<CollabPost[]>([]);
  const [profile, setProfile] = useState<MonitoredProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMonitoredProfileByUsername(username)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [username]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listPostsForUsername(username, { collabOnly: filter === "collab" })
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [username, filter]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        to="/collab-instagram"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Torna a Collab Instagram
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {profile?.profile_pic_url ? (
            <img
              src={profile.profile_pic_url}
              alt={username}
              className="size-14 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="size-14 rounded-full bg-muted" />
          )}
          <div>
            <h1 className="text-2xl font-semibold">@{username}</h1>
            <p className="text-sm text-muted-foreground">
              {posts.length} {filter === "collab" ? "post in collaborazione" : "post"} rilevati
              finora
              {profile?.followers_count != null && ` · ${formatFollowers(profile.followers_count)}`}
              .
            </p>
          </div>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FeedFilter)}>
          <TabsList>
            <TabsTrigger value="collab">Solo collab</TabsTrigger>
            <TabsTrigger value="all">Tutti i post</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "collab"
            ? "Nessun post in collaborazione ancora rilevato per questo profilo."
            : "Nessun post ancora rilevato per questo profilo."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {posts.map((post) => (
            <div key={post.id} className="space-y-2">
              <SocialEmbed url={post.url} />
              <div className="flex flex-wrap gap-1">
                {post.collaborators
                  .filter((c) => c !== username)
                  .map((c) => (
                    <Badge key={c} variant="secondary">
                      @{c}
                    </Badge>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(post.published_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
