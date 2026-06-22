import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createPost, addMedia } from "@/lib/editorialPlan";

const inputCls =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function NewPostDialog({
  planId,
  defaultDate,
  onCreated,
}: {
  planId: string;
  defaultDate: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(defaultDate);
  const [rubrica, setRubrica] = useState("");
  const [topic, setTopic] = useState("");
  const [canale, setCanale] = useState("");
  const [formato, setFormato] = useState("");
  const [copy, setCopy] = useState("");
  const [copyVisual, setCopyVisual] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [obiettivo, setObiettivo] = useState("");
  const [budget, setBudget] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  function reset() {
    setDate(defaultDate);
    setRubrica("");
    setTopic("");
    setCanale("");
    setFormato("");
    setCopy("");
    setCopyVisual("");
    setDisclaimer("");
    setObiettivo("");
    setBudget("");
    setFiles([]);
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await createPost({
        plan_id: planId,
        post_date: date,
        rubrica: rubrica.trim() || null,
        topic: topic.trim() || null,
        canale: canale.trim() || null,
        formato: formato.trim() || null,
        copy: copy.trim() || null,
        copy_visual: copyVisual.trim() || null,
        visual_url: null,
        visual_type: null,
        disclaimer: disclaimer.trim() || null,
        obiettivo_media: obiettivo.trim() || null,
        budget_media: budget ? Number(budget) : null,
      });
      for (const file of files) {
        await addMedia(post.id, file);
      }
      onCreated();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        <Plus className="size-4" />
        Nuovo post
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onClick={close}>
          <div
            className="my-8 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Nuovo post</h3>
              <button onClick={close} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <Field label="Data *">
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rubrica">
                  <input value={rubrica} onChange={(e) => setRubrica(e.target.value)} className={inputCls} placeholder="es. Edutainment" />
                </Field>
                <Field label="Canale">
                  <input value={canale} onChange={(e) => setCanale(e.target.value)} className={inputCls} placeholder="es. IG + FB" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Topic">
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls} placeholder="es. HydraFit Zero" />
                </Field>
                <Field label="Formato">
                  <input value={formato} onChange={(e) => setFormato(e.target.value)} className={inputCls} placeholder="es. Carousel" />
                </Field>
              </div>
              <Field label="Copy">
                <textarea value={copy} onChange={(e) => setCopy(e.target.value)} className={`${inputCls} min-h-20`} placeholder="Testo del post…" />
              </Field>
              <Field label="Copy Visual">
                <textarea
                  value={copyVisual}
                  onChange={(e) => setCopyVisual(e.target.value)}
                  className={`${inputCls} min-h-20`}
                  placeholder="Testo presente nelle card / nel visual…"
                />
              </Field>
              <Field label="Visual (jpeg, png, mp4… anche più file)">
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                  className="w-full text-sm"
                />
                {files.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{files.length} file selezionati</p>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Obiettivo media">
                  <input value={obiettivo} onChange={(e) => setObiettivo(e.target.value)} className={inputCls} placeholder="es. Traffico al sito" />
                </Field>
                <Field label="Budget media (€)">
                  <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className={inputCls} placeholder="es. 800" />
                </Field>
              </div>
              <Field label="Disclaimer">
                <input value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} className={inputCls} />
              </Field>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "Salvo…" : "Crea post"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
