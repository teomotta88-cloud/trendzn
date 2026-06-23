import { useEffect, useRef } from "react";
import type { EditorialPost, ReviewComponent } from "@/lib/editorialPlan";

const RAIL_WIDTH = 56;
const GAP = 16;

const PALETTE = {
  none: { border: "var(--color-border)", bg: "transparent", text: "var(--color-muted-foreground)", solid: "var(--color-primary)" },
  some: { border: "#eab308", bg: "color-mix(in oklch, #eab308 18%, transparent)", text: "#eab308", solid: "#eab308" },
  all: { border: "#22c55e", bg: "color-mix(in oklch, #22c55e 18%, transparent)", text: "#22c55e", solid: "#22c55e" },
  violet: { border: "#8b5cf6", bg: "color-mix(in oklch, #8b5cf6 18%, transparent)", text: "#8b5cf6", solid: "#8b5cf6" },
  published: { border: "#06b6d4", bg: "color-mix(in oklch, #06b6d4 18%, transparent)", text: "#06b6d4", solid: "#06b6d4" },
} as const;

function formatDayMonth(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function approvalLevel(
  approvals: Record<ReviewComponent, boolean> | undefined,
  programmato: boolean,
  publishedCount: number,
): keyof typeof PALETTE {
  if (publishedCount > 0) return "published";
  if (!approvals) return "none";
  const values = [approvals.copy, approvals.copy_visual, approvals.visual];
  if (values.every(Boolean)) return programmato ? "violet" : "all";
  if (values.some(Boolean)) return "some";
  return "none";
}

export function PostNumberRail({
  posts,
  getPostEl,
  anchorRef,
  approvalsByPost,
  publishedCountByPost,
}: {
  posts: EditorialPost[];
  getPostEl: (id: string) => HTMLElement | null;
  anchorRef: React.RefObject<HTMLElement | null>;
  approvalsByPost: Record<string, Record<ReviewComponent, boolean>>;
  publishedCountByPost: Record<string, number>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
        const active = t > 0.55;
        const palette = PALETTE[approvalLevel(approvalsByPost[post.id], post.programmato, publishedCountByPost[post.id] ?? 0)];
        const scale = 1 + t * 0.55;
        const z = t * 60;
        boxEl.style.transform = `translateZ(${z}px) scale(${scale})`;
        boxEl.style.borderColor = palette.border;
        boxEl.style.backgroundColor = palette.bg;
        boxEl.style.color = palette.text;
        boxEl.style.boxShadow = "none";
        boxEl.style.zIndex = active ? "10" : "1";
      });
      frame = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frame);
  }, [posts, getPostEl, anchorRef, approvalsByPost, publishedCountByPost]);

  if (posts.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="fixed top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-3 sm:flex"
      style={{ perspective: "800px", width: RAIL_WIDTH }}
    >
      {posts.map((post, i) => (
        <button
          key={post.id}
          type="button"
          onClick={() => getPostEl(post.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}
          ref={(el) => {
            boxRefs.current[i] = el;
          }}
          title={`Vai al post del ${formatDayMonth(post.post_date)}`}
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl border text-[11px] font-bold tabular-nums transition-[background-color,border-color,box-shadow] [transform-style:preserve-3d] will-change-transform"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted-foreground)" }}
        >
          {formatDayMonth(post.post_date)}
        </button>
      ))}
    </div>
  );
}
