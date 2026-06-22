import { useEffect, useRef } from "react";
import type { EditorialPost } from "@/lib/editorialPlan";

const RAIL_WIDTH = 56;
const GAP = 16;

function formatDayMonth(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function PostNumberRail({
  posts,
  getPostEl,
  anchorRef,
}: {
  posts: EditorialPost[];
  getPostEl: (id: string) => HTMLElement | null;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let frame = requestAnimationFrame(tick);

    function tick() {
      const anchorEl = anchorRef.current;
      const railEl = railRef.current;
      if (anchorEl && railEl) {
        const left = anchorEl.getBoundingClientRect().left - GAP - RAIL_WIDTH;
        railEl.style.left = `${Math.max(8, left)}px`;
      }

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
  }, [posts, getPostEl, anchorRef]);

  if (posts.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="fixed top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-3 sm:flex"
      style={{ perspective: "800px", width: RAIL_WIDTH }}
    >
      {posts.map((post, i) => (
        <div
          key={post.id}
          ref={(el) => {
            boxRefs.current[i] = el;
          }}
          className="flex size-11 items-center justify-center rounded-xl border text-[11px] font-bold tabular-nums transition-[background-color,border-color,box-shadow] [transform-style:preserve-3d] will-change-transform"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted-foreground)" }}
        >
          {formatDayMonth(post.post_date)}
        </div>
      ))}
    </div>
  );
}
