import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SocialEmbed } from "@/components/SocialEmbed";
import { listCollabPostsForUsername, type CollabPost } from "@/lib/instagramCollab";

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

function InfluencerCollabFeedPage() {
  const { username } = Route.useParams();
  const [posts, setPosts] = useState<CollabPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listCollabPostsForUsername(username)
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [username]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        to="/collab-instagram"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Torna a Collab Instagram
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">@{username}</h1>
        <p className="text-sm text-muted-foreground">
          {posts.length} post in collaborazione rilevati finora.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun post in collaborazione ancora rilevato per questo profilo.
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
