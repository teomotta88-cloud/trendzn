import { createFileRoute } from "@tanstack/react-router";
import pptxgen from "pptxgenjs";

interface FeedPptPost {
  url: string;
  handle?: string | null;
  platform?: string | null;
  canaleName?: string | null;
  date?: string | null;
  caption?: string | null;
}

interface ExportFeedPptxBody {
  keyword?: string;
  title?: string;
  posts?: FeedPptPost[];
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "Data non disponibile";

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Data non disponibile";

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getPlatformLabel(platform?: string | null): string {
  const p = (platform || "web").toLowerCase();

  const labels: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    x: "X",
    twitter: "X",
    web: "Web",
  };

  return labels[p] || p;
}

function safeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "feed-export";
}

function addFooter(slide: pptxgen.Slide, index: number, total: number) {
  slide.addText(`ASPI Monitoring · ${index}/${total}`, {
    x: 0.5,
    y: 7.05,
    w: 12.3,
    h: 0.25,
    fontSize: 8,
    color: "777777",
    align: "right",
  });
}

export const Route = createFileRoute("/api/public/hooks/export-feed-pptx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as ExportFeedPptxBody;

          const keyword = cleanText(body.keyword || "keyword");
          const title = cleanText(body.title || `Post feed keyword: ${keyword}`);
          const posts = Array.isArray(body.posts) ? body.posts : [];

          if (!keyword) {
            return Response.json(
              { ok: false, error: "Keyword obbligatoria" },
              { status: 400 },
            );
          }

          if (posts.length === 0) {
            return Response.json(
              { ok: false, error: "Nessun post da esportare" },
              { status: 400 },
            );
          }

          const pptx = new pptxgen();
          pptx.layout = "LAYOUT_WIDE";
          pptx.author = "ASPI Monitoring";
          pptx.company = "ASPI Monitoring";
          pptx.subject = `Feed export keyword: ${keyword}`;
          pptx.title = title;
          pptx.lang = "it-IT";
          pptx.theme = {
            headFontFace: "Aptos Display",
            bodyFontFace: "Aptos",
            lang: "it-IT",
          };

          const totalSlides = posts.length + 2;

          // Cover
          const cover = pptx.addSlide();
          cover.background = { color: "0F172A" };
          cover.addText("ASPI Monitoring", {
            x: 0.6,
            y: 0.45,
            w: 5,
            h: 0.35,
            fontSize: 14,
            bold: true,
            color: "CBD5E1",
          });
          cover.addText(title, {
            x: 0.6,
            y: 1.45,
            w: 11.8,
            h: 0.85,
            fontSize: 34,
            bold: true,
            color: "FFFFFF",
            fit: "shrink",
          });
          cover.addText(`Keyword: ${keyword}`, {
            x: 0.65,
            y: 2.55,
            w: 9,
            h: 0.45,
            fontSize: 18,
            color: "E2E8F0",
          });
          cover.addText(`${posts.length} post esportati`, {
            x: 0.65,
            y: 3.1,
            w: 6,
            h: 0.4,
            fontSize: 15,
            color: "CBD5E1",
          });
          cover.addText(
            `Export generato il ${new Intl.DateTimeFormat("it-IT", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date())}`,
            {
              x: 0.65,
              y: 6.65,
              w: 8,
              h: 0.3,
              fontSize: 10,
              color: "94A3B8",
            },
          );
          addFooter(cover, 1, totalSlides);

          // Summary
          const summary = pptx.addSlide();
          summary.background = { color: "F8FAFC" };
          summary.addText("Riepilogo", {
            x: 0.55,
            y: 0.45,
            w: 5,
            h: 0.45,
            fontSize: 26,
            bold: true,
            color: "0F172A",
          });

          const byPlatform = posts.reduce<Record<string, number>>((acc, post) => {
            const label = getPlatformLabel(post.platform);
            acc[label] = (acc[label] || 0) + 1;
            return acc;
          }, {});

          const byChannel = posts.reduce<Record<string, number>>((acc, post) => {
            const name = cleanText(post.canaleName || post.handle || "Canale non disponibile");
            acc[name] = (acc[name] || 0) + 1;
            return acc;
          }, {});

          const platformRows = Object.entries(byPlatform)
            .sort((a, b) => b[1] - a[1])
            .map(([platform, count]) => `${platform}: ${count}`)
            .join("\n");

          const channelRows = Object.entries(byChannel)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([channel, count]) => `${channel}: ${count}`)
            .join("\n");

          summary.addText("Totale post", {
            x: 0.65,
            y: 1.35,
            w: 3,
            h: 0.3,
            fontSize: 11,
            color: "64748B",
            bold: true,
          });
          summary.addText(String(posts.length), {
            x: 0.65,
            y: 1.7,
            w: 3,
            h: 0.55,
            fontSize: 32,
            color: "0F172A",
            bold: true,
          });

          summary.addText("Distribuzione piattaforme", {
            x: 4.3,
            y: 1.35,
            w: 3.8,
            h: 0.3,
            fontSize: 12,
            color: "0F172A",
            bold: true,
          });
          summary.addText(platformRows || "N/D", {
            x: 4.3,
            y: 1.75,
            w: 3.8,
            h: 2.1,
            fontSize: 13,
            color: "334155",
            breakLine: false,
          });

          summary.addText("Canali principali", {
            x: 8.3,
            y: 1.35,
            w: 4.3,
            h: 0.3,
            fontSize: 12,
            color: "0F172A",
            bold: true,
          });
          summary.addText(channelRows || "N/D", {
            x: 8.3,
            y: 1.75,
            w: 4.3,
            h: 4.8,
            fontSize: 11,
            color: "334155",
            breakLine: false,
            fit: "shrink",
          });
          addFooter(summary, 2, totalSlides);

          // Slides post
          posts.forEach((post, index) => {
            const slideNumber = index + 3;
            const slide = pptx.addSlide();
            slide.background = { color: "FFFFFF" };

            const platform = getPlatformLabel(post.platform);
            const channel = cleanText(post.canaleName || post.handle || "Canale non disponibile");
            const handle = cleanText(post.handle || "");
            const caption = cleanText(post.caption || "Testo non disponibile");
            const date = formatDate(post.date);
            const url = cleanText(post.url || "");

            slide.addShape(pptx.ShapeType.rect, {
              x: 0,
              y: 0,
              w: 13.333,
              h: 0.18,
              fill: { color: "0F172A" },
              line: { color: "0F172A" },
            });

            slide.addText(`${index + 1}. ${channel}`, {
              x: 0.55,
              y: 0.45,
              w: 8.4,
              h: 0.45,
              fontSize: 20,
              bold: true,
              color: "0F172A",
              fit: "shrink",
            });

            slide.addText(platform, {
              x: 9.4,
              y: 0.5,
              w: 1.6,
              h: 0.28,
              fontSize: 10,
              bold: true,
              color: "FFFFFF",
              align: "center",
              margin: 0.04,
              fill: { color: "1E293B" },
              breakLine: false,
            });

            slide.addText(date, {
              x: 11.05,
              y: 0.5,
              w: 1.7,
              h: 0.3,
              fontSize: 10,
              color: "64748B",
              align: "right",
            });

            if (handle) {
              slide.addText(handle, {
                x: 0.58,
                y: 0.95,
                w: 8,
                h: 0.25,
                fontSize: 10,
                color: "64748B",
              });
            }

            slide.addText("Testo del post", {
              x: 0.6,
              y: 1.45,
              w: 3,
              h: 0.25,
              fontSize: 11,
              bold: true,
              color: "0F172A",
            });

            slide.addText(truncate(caption, 1700), {
              x: 0.6,
              y: 1.85,
              w: 7.4,
              h: 4.65,
              fontSize: 14,
              color: "334155",
              breakLine: false,
              fit: "shrink",
              valign: "top",
              margin: 0.08,
            });

            slide.addShape(pptx.ShapeType.roundRect, {
              x: 8.55,
              y: 1.45,
              w: 4.15,
              h: 4.9,
              rectRadius: 0.08,
              fill: { color: "F8FAFC" },
              line: { color: "E2E8F0", width: 1 },
            });

            slide.addText("Dettagli", {
              x: 8.85,
              y: 1.8,
              w: 3.4,
              h: 0.3,
              fontSize: 13,
              bold: true,
              color: "0F172A",
            });

            slide.addText(`Piattaforma\n${platform}`, {
              x: 8.85,
              y: 2.35,
              w: 3.4,
              h: 0.65,
              fontSize: 11,
              color: "334155",
              breakLine: false,
            });

            slide.addText(`Canale\n${channel}`, {
              x: 8.85,
              y: 3.15,
              w: 3.4,
              h: 0.8,
              fontSize: 11,
              color: "334155",
              breakLine: false,
              fit: "shrink",
            });

            slide.addText(`Data\n${date}`, {
              x: 8.85,
              y: 4.1,
              w: 3.4,
              h: 0.65,
              fontSize: 11,
              color: "334155",
              breakLine: false,
            });

            if (url) {
              slide.addText("Apri post originale", {
                x: 8.85,
                y: 5.35,
                w: 3.3,
                h: 0.35,
                fontSize: 12,
                bold: true,
                color: "2563EB",
                hyperlink: { url },
              });
            }

            addFooter(slide, slideNumber, totalSlides);
          });

          const buffer = await pptx.write({ outputType: "arraybuffer" });
          const filename = `${safeFileName(`aspi-feed-${keyword}`)}.pptx`;

          return new Response(buffer as ArrayBuffer, {
            headers: {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err).slice(0, 500) },
            { status: 500 },
          );
        }
      },
    },
  },
});
