import { createFileRoute } from "@tanstack/react-router";
import {
  getGraphicJob,
  getRubrica,
  listGettyCandidates,
  listTemplateConstraints,
  updateGraphicJob,
} from "@/lib/autographics";

// SBAM AutoGraphics: transizione pending_validation/pending_image ->
// ready_for_render. Ultima validazione lato server prima che il job diventi
// esportabile in CSV per Canva Bulk Create (vedi CanvaExportPanel.tsx).

export const Route = createFileRoute("/api/public/hooks/approve-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { job_id?: string };
          const jobId = body.job_id?.trim();
          if (!jobId) {
            return Response.json({ ok: false, error: "job_id è obbligatorio" }, { status: 400 });
          }

          const job = await getGraphicJob(jobId);
          if (!job) {
            return Response.json({ ok: false, error: "Job non trovato" }, { status: 404 });
          }

          const rubrica = await getRubrica(job.rubrica_id);
          if (!rubrica) {
            await updateGraphicJob(jobId, {
              status: "error",
              error_detail: "Rubrica non trovata per questo job",
            });
            return Response.json({ ok: false, error: "Rubrica non trovata" }, { status: 422 });
          }

          const constraints = await listTemplateConstraints(job.rubrica_id);
          const violations: string[] = [];
          for (const c of constraints) {
            // I layer immagine non hanno testo nel copy_payload: la loro
            // "obbligatorietà" è coperta dal controllo sulla foto Getty
            // selezionata più sotto, non da questa validazione testuale.
            if (c.layer_type === "image") continue;
            const value = job.copy_payload[c.layer_name];
            if (c.obbligatorio && (!value || !value.trim())) {
              violations.push(`${c.layer_name} è obbligatorio`);
              continue;
            }
            if (value && c.max_chars != null && value.length > c.max_chars) {
              violations.push(
                `${c.layer_name} supera il limite di ${c.max_chars} caratteri (attuali: ${value.length})`,
              );
            }
          }
          if (violations.length > 0) {
            const detail = violations.join("; ");
            await updateGraphicJob(jobId, { status: "error", error_detail: detail });
            return Response.json({ ok: false, error: detail }, { status: 422 });
          }

          if (rubrica.tipo_template === "photo_card") {
            const candidates = await listGettyCandidates(jobId);
            const selected = candidates.find((c) => c.selected);
            if (!selected) {
              await updateGraphicJob(jobId, { status: "pending_image" });
              return Response.json(
                { ok: false, error: "Seleziona una foto Getty prima di approvare" },
                { status: 409 },
              );
            }
            await updateGraphicJob(jobId, {
              getty_asset_id: selected.asset_id,
              getty_image_url: selected.preview_url,
            });
          }

          await updateGraphicJob(jobId, { status: "ready_for_render", error_detail: null });
          const updated = await getGraphicJob(jobId);

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
