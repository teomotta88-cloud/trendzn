import { useState } from "react";
import { Plus, X } from "lucide-react";

type Section = "trend-real-time" | "trend-attuali" | "trend-evergreen" | "canali-inspo" | "linkedin" | "influencer";

type FieldConfig = {
  key: "industry" | "title";
  label: string;
  placeholder: string;
  required: boolean;
};

// Stessa mappatura semantica usata in poll-gmail.ts per ogni sezione:
// [tag1]=categoria (fissa), [tag2]=industry, [tag3]=title/descrizione
const SECTION_FIELDS: Record<Section, FieldConfig[]> = {
  "trend-real-time": [{ key: "industry", label: "Industry", placeholder: "es. Travel", required: false }],
  "trend-attuali": [{ key: "industry", label: "Industry", placeholder: "es. Beauty", required: false }],
  "trend-evergreen": [{ key: "industry", label: "Industry", placeholder: "es. Multi brand", required: false }],
  "canali-inspo": [{ key: "title", label: "Nome canale", placeholder: "es. Format interviste", required: false }],
  linkedin: [
    { key: "industry", label: "Catalogazione", placeholder: "es. Digital Agency", required: false },
    { key: "title", label: "Descrizione", placeholder: "es. Award", required: false },
  ],
  influencer: [
    { key: "industry", label: "Nome influencer", placeholder: "es. Chiara Ferragni", required: false },
    { key: "title", label: "Cliente", placeholder: "es. Bionorica", required: false },
  ],
};

// Per canali-inspo e influencer l'URL richiesto è quello del PROFILO, non di un post singolo
const PROFILE_BASED_SECTIONS: Section[] = ["canali-inspo", "influencer"];

type Status = "idle" | "loading" | "success" | "error";

export function ManualSubmitDialog({ section, onSuccess }: { section: Section; onSuccess?: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fields = SECTION_FIELDS[section];
  const isProfileBased = PROFILE_BASED_SECTIONS.includes(section);
  const urlLabel = isProfileBased ? "URL profilo *" : "URL post / profilo *";
  const urlPlaceholder = isProfileBased ? "https://www.instagram.com/nomeaccount/" : "https://...";

  function reset() {
    setUrl("");
    setIndustry("");
    setTitle("");
    setStatus("idle");
    setErrorMsg(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/public/hooks/submit-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          url: url.trim(),
          industry: industry.trim() || null,
          title: title.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Errore durante l'inserimento");
        setStatus("error");
        return;
      }

      setStatus("success");
      onSuccess?.();
      setTimeout(close, 900);
    } catch {
      setErrorMsg("Errore di rete, riprova");
      setStatus("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        <Plus className="size-4" />
        Aggiungi
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Aggiungi manualmente</h3>
              <button
                onClick={close}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{urlLabel}</label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={urlPlaceholder}
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>

              {fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {f.label}
                    {f.required ? " *" : ""}
                  </label>
                  <input
                    type="text"
                    required={f.required}
                    value={f.key === "industry" ? industry : title}
                    onChange={(e) => (f.key === "industry" ? setIndustry(e.target.value) : setTitle(e.target.value))}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
              ))}

              {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
              {status === "success" && <p className="text-xs text-green-600">✓ Aggiunto correttamente</p>}

              <button
                type="submit"
                disabled={status === "loading" || status === "success"}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {status === "loading" ? "Aggiungo…" : "Aggiungi"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
