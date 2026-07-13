import { createFileRoute } from "@tanstack/react-router";
import ExcelJS from "exceljs";

// SBAM AutoGraphics: genera un .xlsx pronto per il caricamento in Canva
// Bulk Create, una riga per post. Le colonne "immagine" (foto Getty)
// contengono l'immagine VERA incorporata nella cella (ancorata via
// worksheet.addImage), non un URL testuale: Canva Bulk Create — come
// confermato dal flusso Google Sheets già in uso in agenzia — riconosce
// come immagine solo un'immagine incorporata nel file, non un link.
//
// Generato interamente server-side (non nel browser): scaricare le
// immagini Getty via fetch() dal browser rischierebbe di essere bloccato
// dal CORS del CDN Getty; una fetch server-to-server non ha questo limite.

const IMAGE_SIZE_PX = 140;

function extensionFromContentType(contentType: string | null): "jpeg" | "png" | "gif" {
  if (!contentType) return "jpeg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  return "jpeg";
}

interface ExportRow {
  values: Record<string, string>;
}

export const Route = createFileRoute("/api/public/hooks/export-xlsx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            sheetName?: string;
            columns?: string[];
            imageColumns?: string[];
            rows?: ExportRow[];
          };
          const sheetName = (body.sheetName?.trim() || "Export").slice(0, 31); // limite Excel
          const columns = body.columns ?? [];
          const imageColumns = new Set(body.imageColumns ?? []);
          const rows = body.rows ?? [];

          if (columns.length === 0 || rows.length === 0) {
            return Response.json(
              { ok: false, error: "columns e rows sono obbligatori" },
              { status: 400 },
            );
          }

          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet(sheetName);
          sheet.addRow(columns);
          sheet.columns = columns.map(() => ({ width: 22 }));

          const imageFetches: Array<{ rowIndex: number; colIndex: number; url: string }> = [];

          rows.forEach((row, i) => {
            const rowIndex = i + 2; // 1 = header
            const cellValues = columns.map((col) =>
              imageColumns.has(col) ? "" : (row.values[col] ?? ""),
            );
            sheet.addRow(cellValues);
            sheet.getRow(rowIndex).height = IMAGE_SIZE_PX * 0.75;
            columns.forEach((col, colIndex) => {
              if (!imageColumns.has(col)) return;
              const url = row.values[col];
              if (url && /^https?:\/\//i.test(url)) {
                imageFetches.push({ rowIndex, colIndex, url });
              }
            });
          });

          const fetchErrors: string[] = [];
          const fetched = await Promise.all(
            imageFetches.map(async (f) => {
              try {
                const res = await fetch(f.url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buffer = await res.arrayBuffer();
                const extension = extensionFromContentType(res.headers.get("content-type"));
                return { ...f, buffer, extension };
              } catch (err) {
                fetchErrors.push(`riga ${f.rowIndex}: ${String(err).slice(0, 100)}`);
                return null;
              }
            }),
          );

          for (const item of fetched) {
            if (!item) continue;
            const imageId = workbook.addImage({ buffer: item.buffer, extension: item.extension });
            sheet.addImage(imageId, {
              tl: { col: item.colIndex, row: item.rowIndex - 1 },
              ext: { width: IMAGE_SIZE_PX, height: IMAGE_SIZE_PX },
            });
          }

          const buffer = await workbook.xlsx.writeBuffer();

          return new Response(buffer as ArrayBuffer, {
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="${sheetName}.xlsx"`,
              ...(fetchErrors.length > 0
                ? { "X-Export-Warnings": fetchErrors.join(" | ").slice(0, 500) }
                : {}),
            },
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
