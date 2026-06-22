import { useEffect, useRef } from "react";
import type { EditorialPost } from "@/lib/editorialPlan";

export function PostNumberRail({
  posts,
  getPostEl,
}: {
  posts: EditorialPost[];
  getPostEl: (id: string) => HTMLElement | null;
}) {
  const numberRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let frame = requestAnimationFrame(tick);

    function tick() {
      const viewportCenter = window.innerHeight / 2;
      const spread = window.innerHeight * 0.55;
      posts.forEach((post, i) => {
        const el = getPostEl(post.id);
        const numEl = numberRefs.current[i];
        if (!el || !numEl) return;
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const dist = Math.abs(centerY - viewportCenter);
        const t = Math.max(0, 1 - dist / spread);
        const scale = 1 + t * 1.15;
        const z = t * 50;
        numEl.style.transform = `translateZ(${z}px) scale(${scale})`;
        numEl.style.opacity = String(0.35 + t * 0.65);
        numEl.style.color = t > 0.55 ? "var(--color-primary)" : "var(--color-muted-foreground)";
        numEl.style.fontWeight = t > 0.55 ? "700" : "500";
        numEl.style.textShadow = t > 0.55 ? "0 2px 10px color-mix(in oklch, var(--color-primary) 45%, transparent)" : "none";
      });
      frame = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frame);
  }, [posts, getPostEl]);

  if (posts.length === 0) return null;

  return (
    <div
      className="sticky top-24 hidden h-fit w-10 shrink-0 flex-col items-center gap-4 self-start py-2 sm:flex"
      style={{ perspective: "700px" }}
    >
      {posts.map((post, i) => (
        <span
          key={post.id}
          ref={(el) => {
            numberRefs.current[i] = el;
          }}
          className="text-xs tabular-nums text-muted-foreground transition-[color,text-shadow] [transform-style:preserve-3d] will-change-transform"
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}
