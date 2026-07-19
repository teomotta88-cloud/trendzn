import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Loader2,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { uploadEditorImage } from "@/lib/designElements";
import { removeBackground } from "@/lib/background-removal";
import { IconPicker } from "./IconPicker";
import type { EditorElement } from "./ElementBox";
import { resolveFillCss, type FillType } from "./paint";

interface PropertiesPanelProps {
  element: EditorElement | null;
  layerNameSuggestions: string[];
  fontOptions: string[];
  onChange: (patch: Partial<EditorElement>) => void;
  onChangeStyle: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onReorder: (direction: "up" | "down" | "front" | "back") => void;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
      />
    </label>
  );
}

// Upload immagine libera + rimozione sfondo automatica (Fase 4). Componente
// a parte (non inline in PropertiesPanel) perché ha bisogno di stato locale
// (busy/error) — PropertiesPanel ritorna presto se non c'è un elemento
// selezionato, il che romperebbe le regole degli hook se li chiamasse lì.
function ImageActions({
  currentSrc,
  targetField,
  onChangeStyle,
}: {
  currentSrc: string;
  targetField: "src" | "previewSrc";
  onChangeStyle: (patch: Record<string, unknown>) => void;
}) {
  const [busy, setBusy] = useState<"upload" | "bg-removal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const url = await uploadEditorImage(file, file.name.split(".").pop() || "png");
      onChangeStyle({ [targetField]: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveBackground() {
    if (!currentSrc) return;
    setBusy("bg-removal");
    setError(null);
    try {
      const blob = await removeBackground(currentSrc);
      const url = await uploadEditorImage(blob, "png");
      onChangeStyle({ [targetField]: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
          {busy === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Carica immagine
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={handleRemoveBackground}
          disabled={busy !== null || !currentSrc}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          title={!currentSrc ? "Nessuna immagine da elaborare" : "Rimuovi sfondo automaticamente"}
        >
          {busy === "bg-removal" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Wand2 className="size-3.5" />
          )}
          Rimuovi sfondo
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function PropertiesPanel({
  element,
  layerNameSuggestions,
  fontOptions,
  onChange,
  onChangeStyle,
  onDelete,
  onReorder,
}: PropertiesPanelProps) {
  if (!element) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        Seleziona un elemento per modificarne le proprietà.
      </div>
    );
  }

  // style è un jsonb libero (le proprietà dipendono da element.tipo): un
  // singolo cast qui invece di propagare `any` nel tipo condiviso.
  const style = element.style as Record<string, any>;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {element.tipo}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            title="Porta avanti"
            onClick={() => onReorder("up")}
            className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="Porta indietro"
            onClick={() => onReorder("down")}
            className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ArrowDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Porta in primo piano"
            onClick={() => onReorder("front")}
            className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ChevronsUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="Porta in fondo"
            onClick={() => onReorder("back")}
            className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ChevronsDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Elimina"
            onClick={onDelete}
            className="rounded-md border border-border p-1 text-muted-foreground hover:border-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={element.x} onChange={(v) => onChange({ x: v })} />
        <NumberField label="Y" value={element.y} onChange={(v) => onChange({ y: v })} />
        <NumberField
          label="Larghezza"
          value={element.width}
          onChange={(v) => onChange({ width: v })}
        />
        <NumberField
          label="Altezza"
          value={element.height}
          onChange={(v) => onChange({ height: v })}
        />
        <NumberField
          label="Rotazione (°)"
          value={element.rotation}
          onChange={(v) => onChange({ rotation: v })}
        />
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Campo dinamico (layer_name) — vuoto = contenuto fisso
        <input
          list="layer-name-suggestions"
          value={element.layer_name ?? ""}
          onChange={(e) => onChange({ layer_name: e.target.value.trim() || null })}
          placeholder="es. #title1"
          className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
        />
        <datalist id="layer-name-suggestions">
          {layerNameSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>

      {element.tipo === "text" && (
        <div className="space-y-2 border-t border-border/70 pt-3">
          {!element.layer_name && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Testo fisso
              <textarea
                value={(style.text as string) || ""}
                onChange={(e) => onChangeStyle({ text: e.target.value })}
                className="min-h-16 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Font
            <select
              value={style.fontFamily || "Inter"}
              onChange={(e) => onChangeStyle({ fontFamily: e.target.value })}
              className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
            >
              {fontOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Dimensione"
              value={style.fontSize ?? 24}
              onChange={(v) => onChangeStyle({ fontSize: v })}
            />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Peso
              <select
                value={String(style.fontWeight ?? 400)}
                onChange={(e) => onChangeStyle({ fontWeight: Number(e.target.value) })}
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                {[400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Colore
              <input
                type="color"
                value={style.color || "#000000"}
                onChange={(e) => onChangeStyle({ color: e.target.value })}
                className="h-8 w-full rounded-lg border border-border bg-background/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Allineamento
              <select
                value={style.align || "left"}
                onChange={(e) => onChangeStyle({ align: e.target.value })}
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                <option value="left">Sinistra</option>
                <option value="center">Centro</option>
                <option value="right">Destra</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Spaziatura lettere (px)"
              value={style.letterSpacing ?? 0}
              onChange={(v) => onChangeStyle({ letterSpacing: v })}
            />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Interlinea
              <input
                type="number"
                step="0.1"
                value={style.lineHeight ?? 1.2}
                onChange={(e) => onChangeStyle({ lineHeight: Number(e.target.value) || 1.2 })}
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Maiuscole/minuscole
              <select
                value={style.textTransform || "none"}
                onChange={(e) =>
                  onChangeStyle({
                    textTransform: e.target.value === "none" ? undefined : e.target.value,
                  })
                }
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                <option value="none">Normale</option>
                <option value="uppercase">MAIUSCOLO</option>
                <option value="lowercase">minuscolo</option>
                <option value="capitalize">Ogni Parola</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Decorazione
              <select
                value={style.textDecoration || "none"}
                onChange={(e) =>
                  onChangeStyle({
                    textDecoration: e.target.value === "none" ? undefined : e.target.value,
                  })
                }
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                <option value="none">Nessuna</option>
                <option value="underline">Sottolineato</option>
                <option value="line-through">Barrato</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {element.tipo === "image" && (
        <div className="space-y-2 border-t border-border/70 pt-3">
          <ImageActions
            currentSrc={(style.src as string) || (style.previewSrc as string) || ""}
            targetField={element.layer_name ? "previewSrc" : "src"}
            onChangeStyle={onChangeStyle}
          />
          {!element.layer_name && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              URL immagine fissa (es. logo)
              <input
                value={(style.src as string) || ""}
                onChange={(e) => onChangeStyle({ src: e.target.value })}
                placeholder="https://…"
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            URL immagine di prova (solo per l'anteprima)
            <input
              value={(style.previewSrc as string) || ""}
              onChange={(e) => onChangeStyle({ previewSrc: e.target.value })}
              placeholder="https://…"
              className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
          </label>
          {element.layer_name && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={!!style.autoRemoveBackground}
                onChange={(e) => onChangeStyle({ autoRemoveBackground: e.target.checked })}
              />
              Rimuovi sfondo automaticamente quando questo campo viene compilato
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Adattamento
              <select
                value={style.objectFit || "cover"}
                onChange={(e) => onChangeStyle({ objectFit: e.target.value })}
                className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                <option value="cover">Riempi (cover)</option>
                <option value="contain">Contieni (contain)</option>
              </select>
            </label>
            <NumberField
              label="Raggio bordo"
              value={style.borderRadius ?? 0}
              onChange={(v) => onChangeStyle({ borderRadius: v })}
            />
          </div>
        </div>
      )}

      {element.tipo === "icon" && (
        <div className="space-y-2 border-t border-border/70 pt-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Icona
            <IconPicker
              value={style.name || "Circle"}
              onChange={(name) => onChangeStyle({ name })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Colore
              <input
                type="color"
                value={style.color || "#000000"}
                onChange={(e) => onChangeStyle({ color: e.target.value })}
                className="h-8 w-full rounded-lg border border-border bg-background/60"
              />
            </label>
            <NumberField
              label="Spessore tratto"
              value={style.strokeWidth ?? 2}
              onChange={(v) => onChangeStyle({ strokeWidth: v })}
            />
          </div>
        </div>
      )}

      {element.tipo === "shape" && (
        <div className="space-y-2 border-t border-border/70 pt-3">
          {/* Se fillCss è impostato (gradiente importato da Figma con >2
              stop o non lineare/radiale, non rappresentabile in questa UI
              semplificata) il tipo di default mostrato è "gradiente
              lineare": solo un'indicazione visiva, il rendering resta
              quello di fillCss finché l'utente non tocca un campo. */}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Tipo riempimento
            <select
              value={(style.fillType as FillType) || (style.fillCss ? "linear" : "solid")}
              onChange={(e) =>
                onChangeStyle({ fillType: e.target.value as FillType, fillCss: undefined })
              }
              className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
            >
              <option value="solid">Tinta unita</option>
              <option value="linear">Gradiente lineare</option>
              <option value="radial">Gradiente radiale</option>
            </select>
          </label>
          {(style.fillType || (style.fillCss ? "linear" : "solid")) === "solid" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Colore riempimento
              <input
                type="color"
                value={style.fillColor || style.fill || "#cccccc"}
                onChange={(e) =>
                  onChangeStyle({ fillColor: e.target.value, fill: undefined, fillCss: undefined })
                }
                className="h-8 w-full rounded-lg border border-border bg-background/60"
              />
            </label>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Da
                  <input
                    type="color"
                    value={style.gradientFrom || "#ffffff"}
                    onChange={(e) =>
                      onChangeStyle({ gradientFrom: e.target.value, fillCss: undefined })
                    }
                    className="h-8 w-full rounded-lg border border-border bg-background/60"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  A
                  <input
                    type="color"
                    value={style.gradientTo || "#000000"}
                    onChange={(e) =>
                      onChangeStyle({ gradientTo: e.target.value, fillCss: undefined })
                    }
                    className="h-8 w-full rounded-lg border border-border bg-background/60"
                  />
                </label>
              </div>
              {style.fillType === "linear" && (
                <NumberField
                  label="Angolo (°)"
                  value={style.gradientAngle ?? 90}
                  onChange={(v) => onChangeStyle({ gradientAngle: v, fillCss: undefined })}
                />
              )}
              <div
                className="h-8 w-full rounded-lg border border-border"
                style={{ background: resolveFillCss(style) }}
              />
            </>
          )}
          <NumberField
            label="Raggio bordo"
            value={style.borderRadius ?? 0}
            onChange={(v) => onChangeStyle({ borderRadius: v })}
          />
        </div>
      )}

      <div className="space-y-2 border-t border-border/70 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Bordo</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Colore
            <input
              type="color"
              value={style.borderColor || "#000000"}
              onChange={(e) => onChangeStyle({ borderColor: e.target.value })}
              className="h-8 w-full rounded-lg border border-border bg-background/60"
            />
          </label>
          <NumberField
            label="Spessore (0 = nessuno)"
            value={style.borderWidth ?? 0}
            onChange={(v) => onChangeStyle({ borderWidth: Math.max(0, v) })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={!!style.borderDashed}
            onChange={(e) => onChangeStyle({ borderDashed: e.target.checked })}
          />
          Tratteggiato
        </label>
      </div>

      <div className="space-y-2 border-t border-border/70 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Aspetto</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Opacità (0-100)"
            value={Math.round((style.opacity ?? 1) * 100)}
            onChange={(v) => onChangeStyle({ opacity: Math.min(100, Math.max(0, v)) / 100 })}
          />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Blend mode
            <select
              value={style.blendMode || "normal"}
              onChange={(e) =>
                onChangeStyle({
                  blendMode: e.target.value === "normal" ? undefined : e.target.value,
                })
              }
              className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
            >
              <option value="normal">Normale</option>
              <option value="multiply">Moltiplica</option>
              <option value="screen">Scherma</option>
              <option value="overlay">Overlay</option>
              <option value="darken">Scurisci</option>
              <option value="lighten">Schiarisci</option>
              <option value="color-dodge">Scherma colore</option>
              <option value="color-burn">Brucia colore</option>
              <option value="hard-light">Luce intensa</option>
              <option value="soft-light">Luce soffusa</option>
              <option value="difference">Differenza</option>
              <option value="exclusion">Esclusione</option>
              <option value="hue">Tonalità</option>
              <option value="saturation">Saturazione</option>
              <option value="color">Colore</option>
              <option value="luminosity">Luminosità</option>
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t border-border/70 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Ombra</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Colore
            <input
              type="color"
              value={style.shadowColor || "#000000"}
              onChange={(e) => onChangeStyle({ shadowColor: e.target.value })}
              className="h-8 w-full rounded-lg border border-border bg-background/60"
            />
          </label>
          <NumberField
            label="Opacità (0-100)"
            value={Math.round((style.shadowOpacity ?? 0.5) * 100)}
            onChange={(v) => onChangeStyle({ shadowOpacity: Math.min(100, Math.max(0, v)) / 100 })}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Sfocatura"
            value={style.shadowBlur ?? 0}
            onChange={(v) => onChangeStyle({ shadowBlur: Math.max(0, v) })}
          />
          <NumberField
            label="Offset X"
            value={style.shadowOffsetX ?? 0}
            onChange={(v) => onChangeStyle({ shadowOffsetX: v })}
          />
          <NumberField
            label="Offset Y"
            value={style.shadowOffsetY ?? 0}
            onChange={(v) => onChangeStyle({ shadowOffsetY: v })}
          />
        </div>
      </div>
    </div>
  );
}
