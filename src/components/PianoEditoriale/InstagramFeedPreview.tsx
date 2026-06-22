import { useEffect, useState } from "react";
import { Grid3x3, Bookmark, UserSquare2, Heart, MessageCircle, Send, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type EditorialPost, type EditorialPostMedia, listMedia } from "@/lib/editorialPlan";

const PROFILE = {
  avatar: "https://instagram.fblq3-1.fna.fbcdn.net/v/t51.82787-19/657357989_18574636963062354_1764510709046221226_n.jpg?stp=dst-jpg_s150x150_tt6",
  handle: "namedsport",
  name: "NAMEDSPORT",
  bio: "Supplements for Conscious Sport\nEnergy • Hydration • Muscle Mass • Wellbeing • Diet",
  linkLabel: "www.namedsport.com",
  linkUrl: "https://www.namedsport.com",
  posts: "1304",
  followers: "42K",
  following: "2127",
};

function isVideo(url: string, type: string | null | undefined) {
  return (!!type && type.startsWith("video")) || /\.(mp4|mov|webm)$/i.test(url);
}

export function InstagramFeedPreview({ posts }: { posts: EditorialPost[] }) {
  const [mediaByPost, setMediaByPost] = useState<Record<string, EditorialPostMedia[]>>({});
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [mediaIndex, setMediaIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all(posts.map((p) => listMedia(p.id).then((m) => [p.id, m] as const))).then((entries) => {
      if (!cancelled) setMediaByPost(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [posts]);

  function mediaFor(post: EditorialPost): { url: string; type: string | null }[] {
    const fromTable = mediaByPost[post.id];
    if (fromTable && fromTable.length > 0) return fromTable.map((m) => ({ url: m.url, type: m.type }));
    if (post.visual_url) return [{ url: post.visual_url, type: post.visual_type }];
    return [];
  }

  const withVisual = [...posts]
    .filter((p) => mediaFor(p).length > 0)
    .sort((a, b) => b.post_date.localeCompare(a.post_date));

  const selectedPost = withVisual.find((p) => p.id === selectedPostId) ?? null;
  const selectedMedia = selectedPost ? mediaFor(selectedPost) : [];

  function openPost(postId: string) {
    setSelectedPostId(postId);
    setMediaIndex(0);
  }

  function closeModal() {
    setSelectedPostId(null);
  }

  function navigateMedia(dir: -1 | 1) {
    setMediaIndex((i) => (selectedMedia.length === 0 ? 0 : (i + dir + selectedMedia.length) % selectedMedia.length));
  }

  useEffect(() => {
    if (!selectedPost) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowLeft") navigateMedia(-1);
      if (e.key === "ArrowRight") navigateMedia(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPost, selectedMedia.length]);

  const currentMedia = selectedMedia[mediaIndex];

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 sm:p-8">
      <div className="flex items-center gap-6 sm:gap-10">
        <img src={PROFILE.avatar} alt={PROFILE.handle} className="size-20 rounded-full object-cover sm:size-32" />
        <div className="flex-1 space-y-3">
          <h2 className="text-lg font-semibold">{PROFILE.handle}</h2>
          <div className="flex gap-6 text-sm">
            <span><strong>{PROFILE.posts}</strong> post</span>
            <span><strong>{PROFILE.followers}</strong> follower</span>
            <span><strong>{PROFILE.following}</strong> seguiti</span>
          </div>
          <div className="text-sm">
            <p className="font-semibold">{PROFILE.name}</p>
            <p className="whitespace-pre-line text-muted-foreground">{PROFILE.bio}</p>
            <a href={PROFILE.linkUrl} target="_blank" rel="noreferrer" className="text-primary">{PROFILE.linkLabel}</a>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button className="flex-1 rounded-lg bg-primary py-1.5 text-sm font-semibold text-primary-foreground">Segui</button>
        <button className="flex-1 rounded-lg border border-border py-1.5 text-sm font-semibold">Messaggio</button>
      </div>

      <div className="mt-6 flex justify-center gap-10 border-t border-border pt-2 text-muted-foreground">
        <Grid3x3 className="size-5 text-foreground" />
        <UserSquare2 className="size-5" />
        <Bookmark className="size-5" />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-0.5">
        {withVisual.length === 0 && (
          <p className="col-span-3 py-10 text-center text-sm text-muted-foreground">
            Nessun visual ancora caricato nel piano.
          </p>
        )}
        {withVisual.map((p) => {
          const media = mediaFor(p);
          const first = media[0];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openPost(p.id)}
              className="relative aspect-square overflow-hidden bg-muted"
            >
              {first && isVideo(first.url, first.type) ? (
                <video src={first.url} className="size-full object-cover" muted />
              ) : first ? (
                <img src={first.url} alt={p.topic ?? ""} className="size-full object-cover" />
              ) : null}
              {media.length > 1 && (
                <span className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {media.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedPost && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" onClick={closeModal}>
          <button
            onClick={closeModal}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            title="Chiudi"
          >
            <X className="size-5" />
          </button>

          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-card sm:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex aspect-square shrink-0 items-center justify-center bg-black sm:aspect-auto sm:w-[62%]">
              {currentMedia && isVideo(currentMedia.url, currentMedia.type) ? (
                <video src={currentMedia.url} controls autoPlay className="max-h-full max-w-full object-contain" />
              ) : currentMedia ? (
                <img src={currentMedia.url} alt="" className="max-h-full max-w-full object-contain" />
              ) : null}

              {selectedMedia.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateMedia(-1);
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
                    title="Precedente"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateMedia(1);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
                    title="Successivo"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white">
                    {mediaIndex + 1} / {selectedMedia.length}
                  </span>
                </>
              )}
            </div>

            <div className="flex min-h-0 w-full min-w-0 flex-col sm:w-[38%]">
              <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
                <img src={PROFILE.avatar} alt={PROFILE.handle} className="size-8 shrink-0 rounded-full object-cover" />
                <span className="text-sm font-semibold">{PROFILE.handle}</span>
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto p-3 text-sm">
                <p className="whitespace-pre-line break-words">
                  <span className="font-semibold">{PROFILE.handle}</span> {selectedPost.copy || ""}
                </p>
              </div>
              <div className="shrink-0 border-t border-border p-3">
                <div className="flex items-center gap-3 text-foreground">
                  <Heart className="size-5" />
                  <MessageCircle className="size-5" />
                  <Send className="size-5" />
                  <Bookmark className="ml-auto size-5" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
