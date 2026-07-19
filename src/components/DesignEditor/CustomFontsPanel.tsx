import { useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { uploadCustomFont, deleteCustomFont, type CustomFont } from "@/lib/designElements";

const WEIGHTS = [400, 500, 600, 700, 800];

interface CustomFontsPanelProps {
  fonts: CustomFont[];
  onChange: () => void;
}

// Upload di font custom (Fase 3): il file va nel bucket custom-fonts, la
// riga in custom_fonts. Formato libero (ttf/otf/woff/woff2) — qui, a
// differenza del vecchio motore server-side, non c'è alcuna limitazione su
// woff2 (era un limite di satori/opentype.js, non più rilevante da quando
// il render cattura il DOM del browser, che il woff2 lo carica nativamente).
export function CustomFontsPanel({ fonts, onChange }: CustomFontsPanelProps) {
  const [familyName, setFamilyName] = useState("");
  const [weight, setWeight] = useState(400);
  const [style, setStyle] = useState<"normal" | "italic">("normal");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (!familyName.trim() || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadCustomFont(familyName.trim(), weight, style, file);
      setFamilyName("");
      setFile(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(font: CustomFont) {
    try {
      await deleteCustomFont(font);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Font personalizzati
      </p>

      {fonts.length > 0 && (
        <ul className="space-y-1">
          {fonts.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-2 py-1 text-xs"
            >
              <span>
                {f.family_name}{" "}
                <span className="text-muted-foreground">
                  ({f.weight}
                  {f.style === "italic" ? " corsivo" : ""})
                </span>
              </span>
              <button
                type="button"
                onClick={() => handleDelete(f)}
                className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                title="Elimina font"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Nome font
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="Es. Brand Sans"
            className="w-40 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Peso
          <select
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Stile
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as "normal" | "italic")}
            className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="normal">Normale</option>
            <option value="italic">Corsivo</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          File (ttf/otf/woff/woff2)
          <input
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-56 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
          />
        </label>
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !familyName.trim() || !file}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          <Upload className="size-3.5" />
          {uploading ? "Carico…" : "Carica font"}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
