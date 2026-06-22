import { Grid3x3, Bookmark, UserSquare2 } from "lucide-react";
import type { EditorialPost } from "@/lib/editorialPlan";

// Dati profilo presi dallo screenshot fornito dall'utente (instagram.com/namedsport/).
// Modificabili qui finché non serve un editor da UI.
const PROFILE = {
  avatar:
    "https://instagram.fblq3-1.fna.fbcdn.net/v/t51.82787-19/657357989_18574636963062354_1764510709046221226_n.jpg?stp=dst-jpg_s150x150_tt6",
  handle: "namedsport",
  name: "NAMEDSPORT",
  bio: "Supplements for Conscious Sport\nEnergy • Hydration • Muscle Mass • Wellbeing • Diet",
  linkLabel: "www.namedsport.com",
  linkUrl: "https://www.namedsport.com",
  posts: "1304",
  followers: "42K",
  following: "2127",
};

export function InstagramFeedPreview({ posts }: { posts: EditorialPost[] }) {
  const withVisual = [...posts].filter((p) => p.visual_url).sort((a, b) => b.post_date.localeCompare(a.post_date));

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 sm:p-8">
      <div className="flex items-center gap-6 sm:gap-10">
        <img src={PROFILE.avatar} alt={PROFILE.handle} className="size-20 rounded-full object-cover sm:size-32" />
        <div className="flex-1 space-y-3">
          <h2 className="text-lg font-semibold">{PROFILE.handle}</h2>
          <div className="flex gap-6 text-sm">
            <span>
              <strong>{PROFILE.posts}</strong> post
            </span>
            <span>
              <strong>{PROFILE.followers}</strong> follower
            </span>
            <span>
              <strong>{PROFILE.following}</strong> seguiti
            </span>
          </div>
          <div className="text-sm">
            <p className="font-semibold">{PROFILE.name}</p>
            <p className="whitespace-pre-line text-muted-foreground">{PROFILE.bio}</p>
            <a href={PROFILE.linkUrl} target="_blank" rel="noreferrer" className="text-primary">
              {PROFILE.linkLabel}
            </a>
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
        {withVisual.map((p) => (
          <div key={p.id} className="relative aspect-square overflow-hidden bg-muted">
            {p.visual_type?.startsWith("video") ? (
              <video src={p.visual_url!} className="size-full object-cover" muted />
            ) : (
              <img src={p.visual_url!} alt={p.topic ?? ""} className="size-full object-cover" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
