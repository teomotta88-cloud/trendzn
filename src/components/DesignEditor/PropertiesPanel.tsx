import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Trash2 } from "lucide-react";
import { CURATED_ICONS } from "./constants";
import type { EditorElement } from "./ElementBox";

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
        </div>
      )}

      {element.tipo === "image" && (
        <div className="space-y-2 border-t border-border/70 pt-3">
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
            <select
              value={style.name || "Circle"}
              onChange={(e) => onChangeStyle({ name: e.target.value })}
              className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
            >
              {CURATED_ICONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Colore riempimento
            <input
              type="color"
              value={style.fill || "#cccccc"}
              onChange={(e) => onChangeStyle({ fill: e.target.value })}
              className="h-8 w-full rounded-lg border border-border bg-background/60"
            />
          </label>
          <NumberField
            label="Raggio bordo"
            value={style.borderRadius ?? 0}
            onChange={(v) => onChangeStyle({ borderRadius: v })}
          />
        </div>
      )}
    </div>
  );
}
