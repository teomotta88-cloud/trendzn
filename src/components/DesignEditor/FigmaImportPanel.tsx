import { useState } from "react";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { callHook } from "@/lib/hooks-client";
import { replaceTemplateElements, type TemplateElementInput } from "@/lib/designElements";
import type { RubricaFormato } from "@/lib/autographics";

interface FigmaImportResult {
  width: number;
  height: number;
  elementsCount: number;
  elements: TemplateElementInput[];
}

// Import di un frame Figma nel frame corrente dell'editor (vedi
// figma-import.ts per la logica di mappatura e i limiti noti). L'utente
// incolla il link "Copy link to selection" di un frame Figma; l'import
// SOSTITUISCE gli elementi del frame corrente, stesso comportamento di
// "Salva design" — non si somma al design esistente.
export function FigmaImportPanel({
  rubricaId,
  formato,
  cardIndex,
  onImported,
}: {
  rubricaId: string;
  formato: RubricaFormato;
  cardIndex: number;
  onImported: () => void;
}) {
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<FigmaImportResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    if (!link.trim()) return;
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const data = await callHook<FigmaImportResult>("figma-import", { link: link.trim() });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      await replaceTemplateElements(rubricaId, formato.formato, cardIndex, result.elements);
      setResult(null);
      setLink("");
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const dimensionsMismatch =
    result && (result.width !== formato.width_px || result.height !== formato.height_px);

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Importa un frame da Figma</p>
      <p className="text-[11px] text-muted-foreground">
        In Figma: tasto destro sul frame → "Copy link to selection", poi incolla qui. Sostituisce
        gli elementi del frame {cardIndex} corrente.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.figma.com/design/…?node-id=…"
          className="w-80 max-w-full rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetching || !link.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {fetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Leggi da Figma
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <p className="text-[11px] text-foreground">
            Trovati {result.elementsCount} elementi nel frame Figma ({result.width}×{result.height}
            ).
          </p>
          {dimensionsMismatch && (
            <p className="text-[11px] text-destructive">
              Attenzione: il formato attuale è {formato.width_px}×{formato.height_px}, diverso dal
              frame Figma. Le posizioni verranno importate comunque in px assoluti.
            </p>
          )}
          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Importa nel frame {cardIndex} (sostituisce il design attuale)
          </button>
        </div>
      )}
    </div>
  );
}
