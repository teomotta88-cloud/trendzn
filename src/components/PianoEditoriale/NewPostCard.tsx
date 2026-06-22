import { useState } from "react";
import { X } from "lucide-react";
import { createPost, addMedia, CHANNELS } from "@/lib/editorialPlan";

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

export function NewPostCard({
  planId,
  defaultDate,
  onCreated,
  onCancel,
}: {
  planId: string;
  defaultDate: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(defaultDate);
  const [rubrica, setRubrica] = useState("");
  const [topic, setTopic] = useState("");
  const [canali, setCanali] = useState<string[]>([]);
  const [formato, setFormato] = useState("");
  const [channelCopies, setChannelCopies] = useState<Record<string, string>>({});
  const [copyVisual, setCopyVisual] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [obiettivo, setObiettivo] = useState("");
  const [budget, setBudget] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      const filteredCopies: Record<string, string> = {};
      for (const code of canali) {
        const value = channelCopies[code]?.trim();
        if (value) filteredCopies[code] = value;
      }
      const post = await createPost({
        plan_id: planId,
        post_date: date,
        rubrica: rubrica.trim() || null,
        topic: topic.trim() || null,
        canali,
        formato: formato.trim() || null,
        channel_copies: filteredCopies,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-primary/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Data *">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Rubrica">
            <input value={rubrica} onChange={(e) => setRubrica(e.target.value)} className={inputCls} placeholder="es. Edutainment" />
          </Field>
          <Field label="Formato">
            <input value={formato} onChange={(e) => setFormato(e.target.value)} className={inputCls} placeholder="es. Carousel" />
          </Field>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
          title="Annulla"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <Field label="Topic">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls} placeholder="es. HydraFit Zero" />
      </Field>

      <Field label="Canali">
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map((c) => {
            const active = canali.includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() =>
                  setCanali((prev) => (active ? prev.filter((x) => x !== c.code) : [...prev, c.code]))
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
                title={c.label}
              >
                {c.code}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Copy</span>
          {canali.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Seleziona almeno un canale per inserire il copy.</p>
          ) : (
            canali.map((code) => (
              <div key={code} className="space-y-1">
                <span className="text-[10px] font-semibold text-muted-foreground">Copy {code}</span>
                <textarea
                  value={channelCopies[code] ?? ""}
                  onChange={(e) =>
                    setChannelCopies((prev) => ({ ...prev, [code]: e.target.value }))
                  }
                  className={`${inputCls} scrollbar-thin max-h-40 min-h-16 overflow-y-auto text-[11px] leading-snug`}
                  placeholder={`Testo del post per ${code}…`}
                />
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Copy Visual</span>
          <textarea
            value={copyVisual}
            onChange={(e) => setCopyVisual(e.target.value)}
            className={`${inputCls} scrollbar-thin max-h-80 min-h-20 overflow-y-auto text-[11px] leading-snug`}
            placeholder="Testo presente nelle card / nel visual…"
          />
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Visual</span>
          <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
            Aggiungi file
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            />
          </label>
          {files.length > 0 && <p className="text-[11px] text-muted-foreground">{files.length} file selezionati</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <Field label="Obiettivo media">
          <input value={obiettivo} onChange={(e) => setObiettivo(e.target.value)} className={inputCls} placeholder="es. Traffico al sito" />
        </Field>
        <Field label="Budget media (€)">
          <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className={inputCls} placeholder="es. 800" />
        </Field>
        <Field label="Disclaimer">
          <input value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} className={inputCls} />
        </Field>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Salvo…" : "Crea post"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:border-destructive hover:text-destructive"
        >
          Annulla
        </button>
      </div>
    </form>
  );
}
