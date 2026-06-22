import { useEffect, useRef } from "react";
import type { EditorialPost } from "@/lib/editorialPlan";

export function PostNumberRail({
  posts,
  getPostEl,
}: {
  posts: EditorialPost[];
  getPostEl: (id: string) => HTMLElement | null;
}) {
  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let frame = requestAnimationFrame(tick);

    function tick() {
      const viewportCenter = window.innerHeight / 2;
      const spread = window.innerHeight * 0.55;
      posts.forEach((post, i) => {
        const el = getPostEl(post.id);
        const boxEl = boxRefs.current[i];
        if (!el || !boxEl) return;
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const dist = Math.abs(centerY - viewportCenter);
        const t = Math.max(0, 1 - dist / spread);
        const scale = 1 + t * 0.55;
        const z = t * 60;
        boxEl.style.transform = `translateZ(${z}px) scale(${scale})`;
        boxEl.style.borderColor =
          t > 0.55 ? "var(--color-primary)" : "color-mix(in oklch, var(--color-border) 100%, transparent)";
        boxEl.style.backgroundColor = t > 0.55 ? "color-mix(in oklch, var(--color-primary) 18%, transparent)" : "transparent";
        boxEl.style.color = t > 0.55 ? "var(--color-primary)" : "var(--color-muted-foreground)";
        boxEl.style.boxShadow =
          t > 0.55 ? "0 6px 20px color-mix(in oklch, var(--color-primary) 35%, transparent)" : "none";
        boxEl.style.zIndex = t > 0.55 ? "10" : "1";
      });
      frame = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frame);
  }, [posts, getPostEl]);

  if (posts.length === 0) return null;

  return (
    <div
      className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-3 sm:flex"
      style={{ perspective: "800px" }}
    >
      {posts.map((post, i) => (
        <div
          key={post.id}
          ref={(el) => {
            boxRefs.current[i] = el;
          }}
          className="flex size-11 items-center justify-center rounded-xl border text-base font-bold tabular-nums transition-[background-color,border-color,box-shadow] [transform-style:preserve-3d] will-change-transform"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted-foreground)" }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
