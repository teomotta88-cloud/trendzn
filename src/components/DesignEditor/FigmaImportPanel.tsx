import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { callHook } from "@/lib/hooks-client";
import { replaceTemplateElements, type TemplateElementInput } from "@/lib/designElements";
import type { RubricaFormato } from "@/lib/autographics";
import { TokenHealthAlert } from "@/components/TokenHealthAlert";

interface FigmaImportFrame {
  name: string;
  width: number;
  height: number;
  elements: TemplateElementInput[];
}

interface FigmaImportResult {
  frames: FigmaImportFrame[];
  elementsCount: number;
}

function fontsUsedIn(frames: FigmaImportFrame[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const frame of frames) {
    for (const el of frame.elements) {
      if (el.tipo !== "text") continue;
      const family = (el.style as Record<string, unknown>).fontFamily;
      if (typeof family === "string" && !seen.has(family)) {
        seen.add(family);
        out.push(family);
      }
    }
  }
  return out;
}

function applyFontReplacements(
  frames: FigmaImportFrame[],
  replacements: Record<string, string>,
): FigmaImportFrame[] {
  if (Object.keys(replacements).length === 0) return frames;
  return frames.map((frame) => ({
    ...frame,
    elements: frame.elements.map((el) => {
      if (el.tipo !== "text") return el;
      const style = el.style as Record<string, unknown>;
      const family = style.fontFamily;
      if (typeof family === "string" && replacements[family]) {
        return { ...el, style: { ...style, fontFamily: replacements[family] } };
      }
      return el;
    }),
  }));
}

// Import di uno o più frame Figma nel design della rubrica (vedi
// figma-import.ts per la logica di mappatura, il rilevamento multi-frame e i
// limiti noti). L'utente incolla il link "Copy link to selection" di un
// frame o di una sezione/gruppo con più frame (ognuno diventa una card del
// carousel). L'import SOSTITUISCE gli elementi delle card coinvolte, stesso
// comportamento di "Salva design" — non si somma al design esistente.
export function FigmaImportPanel({
  rubricaId,
  formato,
  cardIndex,
  fontOptions,
  onImported,
}: {
  rubricaId: string;
  formato: RubricaFormato;
  cardIndex: number;
  fontOptions: string[];
  onImported: () => void;
}) {
  const [link, setLink] = useState("");
  const [pastedJson, setPastedJson] = useState("");
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<FigmaImportResult | null>(null);
  const [fontReplacements, setFontReplacements] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingFonts = useMemo(() => {
    if (!result) return [];
    const available = new Set(fontOptions.map((f) => f.toLowerCase()));
    return fontsUsedIn(result.frames).filter((f) => !available.has(f.toLowerCase()));
  }, [result, fontOptions]);

  function applyResult(data: FigmaImportResult) {
    setResult(data);
    const defaults: Record<string, string> = {};
    const available = new Set(fontOptions.map((f) => f.toLowerCase()));
    for (const font of fontsUsedIn(data.frames)) {
      if (!available.has(font.toLowerCase())) defaults[font] = fontOptions[0] ?? "Inter";
    }
    setFontReplacements(defaults);
  }

  async function handleFetch() {
    if (!link.trim()) return;
    setFetching(true);
    setError(null);
    setResult(null);
    setFontReplacements({});
    try {
      const data = await callHook<FigmaImportResult>("figma-import", { link: link.trim() });
      applyResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  // Percorso alternativo al link, per quando il piano Figma del team che
  // possiede il file limita fortemente la REST API (vedi TokenHealthAlert
  // e il commento in cima a figma-import.ts): l'utente esegue il plugin
  // "trendzn - Esporta template" dentro Figma (figma-export-plugin/, gira
  // sulla Plugin API, nessun limite legato al piano) e incolla qui il JSON
  // che produce.
  async function handleFetchFromJson() {
    if (!pastedJson.trim()) return;
    setFetching(true);
    setError(null);
    setResult(null);
    setFontReplacements({});
    try {
      const nodeJson = JSON.parse(pastedJson);
      const data = await callHook<FigmaImportResult>("figma-import", { nodeJson });
      applyResult(data);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "JSON non valido: controlla di aver copiato tutto il testo dal plugin."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setFetching(false);
    }
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const frames = applyFontReplacements(result.frames, fontReplacements);
      if (frames.length === 1) {
        await replaceTemplateElements(rubricaId, formato.formato, cardIndex, frames[0].elements);
      } else {
        for (let i = 0; i < frames.length; i++) {
          await replaceTemplateElements(rubricaId, formato.formato, i + 1, frames[i].elements);
        }
      }
      setResult(null);
      setLink("");
      setPastedJson("");
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const mismatchedFrames = (result?.frames ?? []).filter(
    (f) => f.width !== formato.width_px || f.height !== formato.height_px,
  );

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Importa da Figma</p>
      <p className="text-[11px] text-muted-foreground">
        In Figma: tasto destro sul frame (o su una sezione con più frame) → "Copy link to
        selection", poi incolla qui. Un link con più frame crea/sostituisce le card del carousel in
        ordine; un link a un singolo frame sostituisce solo il frame {cardIndex} corrente.
      </p>
      <TokenHealthAlert tokenName="FIGMA_ACCESS_TOKEN" />
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

      <details className="rounded-lg border border-border p-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">
          Il piano Figma del file limita l'API? Incolla il JSON del plugin
        </summary>
        <div className="mt-2 space-y-1.5">
          <p>
            Esegui il plugin "trendzn - Esporta template" dentro Figma (gira sulla Plugin API, senza
            il limite di richieste/mese della REST API sui file di un team con piano
            Starter/gratuito — vedi <code>figma-export-plugin/README.md</code> nel repo per
            l'installazione), copia il JSON che produce e incollalo qui sotto.
          </p>
          <textarea
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
            placeholder='{"id": "...", "type": "FRAME", ...}'
            className="h-24 w-full rounded-lg border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[10px] outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleFetchFromJson}
            disabled={fetching || !pastedJson.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Leggi JSON
          </button>
        </div>
      </details>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <p className="text-[11px] text-foreground">
            {result.frames.length > 1
              ? `Trovati ${result.frames.length} frame (${result.elementsCount} elementi totali).`
              : `Trovati ${result.elementsCount} elementi nel frame (${result.frames[0].width}×${result.frames[0].height}).`}
          </p>
          {mismatchedFrames.length > 0 && (
            <p className="text-[11px] text-destructive">
              Attenzione: il formato attuale è {formato.width_px}×{formato.height_px}, diverso da{" "}
              {mismatchedFrames.map((f) => `"${f.name}" (${f.width}×${f.height})`).join(", ")}. Le
              posizioni verranno importate comunque in px assoluti.
            </p>
          )}

          {missingFonts.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-2">
              <p className="flex items-start gap-1.5 text-[11px] text-yellow-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {missingFonts.length === 1
                  ? "Un font usato in Figma non è disponibile in trendzn. Scegli con cosa sostituirlo:"
                  : "Alcuni font usati in Figma non sono disponibili in trendzn. Scegli con cosa sostituirli:"}
              </p>
              {missingFonts.map((font) => (
                <div key={font} className="flex items-center gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-foreground">{font}</span>
                  <span>→</span>
                  <select
                    value={fontReplacements[font] ?? fontOptions[0] ?? "Inter"}
                    onChange={(e) =>
                      setFontReplacements((prev) => ({ ...prev, [font]: e.target.value }))
                    }
                    className="rounded-lg border border-border bg-background/60 px-2 py-1 text-[11px] outline-none focus:border-primary"
                  >
                    {fontOptions.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {result.frames.length > 1
              ? `Importa ${result.frames.length} frame (crea/sostituisce le card 1-${result.frames.length})`
              : `Importa nel frame ${cardIndex} (sostituisce il design attuale)`}
          </button>
        </div>
      )}
    </div>
  );
}
