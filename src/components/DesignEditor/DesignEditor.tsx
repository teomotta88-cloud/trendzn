import { useEffect, useMemo, useRef, useState } from "react";
import Moveable from "react-moveable";
import { Download, Loader2, Redo2, Save, Undo2 } from "lucide-react";
import {
  replaceTemplateElements,
  type TemplateElement,
  type TemplateElementInput,
} from "@/lib/designElements";
import { captureNodeToPngBlob } from "@/lib/design-capture";
import type { RubricaFormato } from "@/lib/autographics";
import { ElementBox, type EditorElement } from "./ElementBox";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar } from "./Toolbar";
import { useHistory } from "./useHistory";
import { MAX_EDITOR_CANVAS_PX } from "./constants";

// Le modifiche continue (digitazione in un campo numerico, trascinamento di
// un color picker) vengono raggruppate in un solo passo di undo se avvengono
// entro questa finestra dall'ultima — evita di dover premere Ctrl+Z una
// volta per ogni carattere digitato.
const HISTORY_DEBOUNCE_MS = 400;

// Aspetta il prossimo repaint effettivo del browser (due rAF innestati,
// pattern standard per "aspetta che React abbia committato E il browser
// abbia disegnato"): serve dopo aver deselezionato l'elemento prima di
// catturare il canvas, altrimenti il bordo di selezione finirebbe
// nell'immagine esportata.
function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

interface DesignEditorProps {
  rubricaId: string;
  formato: RubricaFormato;
  initialElements: TemplateElement[];
  layerNameSuggestions: string[];
  fontOptions: string[];
}

function newLocalId(): string {
  return `local-${crypto.randomUUID()}`;
}

// Converte tra le unità reali del formato (quelle salvate su DB e usate dal
// motore di rendering) e i px mostrati nell'editor: un solo fattore di scala
// uniforme, applicato anche a fontSize/strokeWidth, così quello che si vede
// a schermo corrisponde proporzionalmente a quello che esce dal render.
function computeScale(widthPx: number, heightPx: number) {
  return Math.min(MAX_EDITOR_CANVAS_PX / widthPx, MAX_EDITOR_CANVAS_PX / heightPx, 1);
}

function toEditorElement(el: TemplateElement, scale: number): EditorElement {
  const style = { ...el.style } as Record<string, unknown>;
  if (typeof style.fontSize === "number") style.fontSize = style.fontSize * scale;
  if (typeof style.strokeWidth === "number") style.strokeWidth = style.strokeWidth * scale;
  return {
    id: el.id,
    layer_name: el.layer_name,
    tipo: el.tipo,
    x: el.x * scale,
    y: el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    rotation: el.rotation,
    z_index: el.z_index,
    style,
  };
}

function toStoredElement(el: EditorElement, scale: number): TemplateElementInput {
  const style = { ...el.style } as Record<string, unknown>;
  if (typeof style.fontSize === "number") style.fontSize = style.fontSize / scale;
  if (typeof style.strokeWidth === "number") style.strokeWidth = style.strokeWidth / scale;
  return {
    layer_name: el.layer_name,
    tipo: el.tipo,
    x: el.x / scale,
    y: el.y / scale,
    width: el.width / scale,
    height: el.height / scale,
    rotation: el.rotation,
    z_index: el.z_index,
    style,
  };
}

function defaultStyleFor(tipo: EditorElement["tipo"]): Record<string, unknown> {
  switch (tipo) {
    case "text":
      return {
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: 700,
        color: "#000000",
        align: "left",
      };
    case "image":
      return { objectFit: "cover", borderRadius: 0 };
    case "icon":
      return { name: "Star", color: "#000000", strokeWidth: 2 };
    default:
      return { fill: "#cccccc", borderRadius: 0 };
  }
}

export function DesignEditor({
  rubricaId,
  formato,
  initialElements,
  layerNameSuggestions,
  fontOptions,
}: DesignEditorProps) {
  const scale = useMemo(
    () => computeScale(formato.width_px, formato.height_px),
    [formato.width_px, formato.height_px],
  );
  const displayWidth = formato.width_px * scale;
  const displayHeight = formato.height_px * scale;

  const history = useHistory<EditorElement[]>(
    initialElements.map((el) => toEditorElement(el, scale)),
  );
  const elements = history.state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const elementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const canvasRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);

  const selected = elements.find((el) => el.id === selectedId) ?? null;
  const targetEl = selectedId ? (elementRefs.current.get(selectedId) ?? null) : null;

  // debounce=true raggruppa modifiche ravvicinate (digitazione, drag di uno
  // slider) in un solo passo di undo — vedi useHistory.ts. Le azioni
  // discrete (fine drag/resize/rotate, upload, rimozione sfondo, aggiungi/
  // elimina) committano subito passando debounce=false (default).
  function updateElement(id: string, patch: Partial<EditorElement>, debounce = false) {
    const next = elements.map((el) => (el.id === id ? { ...el, ...patch } : el));
    history.commit(next, debounce ? { debounceMs: HISTORY_DEBOUNCE_MS } : undefined);
  }

  function updateSelectedStyle(patch: Record<string, unknown>, debounce = true) {
    if (!selectedId) return;
    const next = elements.map((el) =>
      el.id === selectedId ? { ...el, style: { ...el.style, ...patch } } : el,
    );
    history.commit(next, debounce ? { debounceMs: HISTORY_DEBOUNCE_MS } : undefined);
  }

  function addElement(tipo: EditorElement["tipo"]) {
    const id = newLocalId();
    const size = tipo === "text" ? { width: 240, height: 60 } : { width: 160, height: 160 };
    const maxZ = elements.reduce((max, el) => Math.max(max, el.z_index), 0);
    const next = [
      ...elements,
      {
        id,
        layer_name: null,
        tipo,
        x: displayWidth / 2 - size.width / 2,
        y: displayHeight / 2 - size.height / 2,
        width: size.width,
        height: size.height,
        rotation: 0,
        z_index: maxZ + 1,
        style: defaultStyleFor(tipo),
      },
    ];
    history.commit(next);
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    history.commit(elements.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }

  function reorderSelected(direction: "up" | "down" | "front" | "back") {
    if (!selectedId) return;
    const sorted = [...elements].sort((a, b) => a.z_index - b.z_index);
    const idx = sorted.findIndex((el) => el.id === selectedId);
    if (idx === -1) return;

    if (direction === "front") {
      const maxZ = Math.max(...sorted.map((el) => el.z_index));
      updateElement(selectedId, { z_index: maxZ + 1 });
      return;
    }
    if (direction === "back") {
      const minZ = Math.min(...sorted.map((el) => el.z_index));
      updateElement(selectedId, { z_index: minZ - 1 });
      return;
    }
    const swapIdx = direction === "up" ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    // Le due z_index vanno scambiate in un solo commit: due updateElement()
    // in sequenza calcolerebbero entrambi il "next" a partire dallo stesso
    // `elements` (chiusura non ancora aggiornata dal primo), perdendo il
    // primo cambiamento.
    const next = elements.map((el) => {
      if (el.id === a.id) return { ...el, z_index: b.z_index };
      if (el.id === b.id) return { ...el, z_index: a.z_index };
      return el;
    });
    history.commit(next);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await replaceTemplateElements(
        rubricaId,
        formato.formato,
        elements.map((el) => toStoredElement(el, scale)),
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setRendering(true);
    setRenderError(null);
    setPreviewUrl(null);
    setSelectedId(null);
    try {
      // Cattura il DOM del canvas com'è mostrato a schermo (Fase 2/3): i
      // campi testo dinamici mostrano il nome del layer come segnaposto, i
      // campi immagine dinamici mostrano previewSrc se impostato. La
      // generazione bulk reale (Fase 5) sostituirà questi valori con quelli
      // veri del job prima di catturare, stesso identico meccanismo.
      await waitForNextPaint();
      if (!canvasRef.current) throw new Error("Canvas non disponibile");
      const pixelRatio = 1 / scale;
      const blob = await captureNodeToPngBlob(canvasRef.current, pixelRatio);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  // Ctrl+Z / Ctrl+Y (e Cmd su Mac, Ctrl+Shift+Z come redo alternativo) —
  // globali sull'editor, non solo sui campi con focus: è un tool "a canvas"
  // come Figma/Canva, non un editor di documento, quindi Ctrl+Z deve
  // funzionare anche con focus su un input numerico del pannello proprietà.
  // Unica eccezione: mentre si sta scrivendo nel box di editing inline del
  // testo (l'unica <textarea> dell'editor), lasciamo fare all'undo nativo
  // del browser sul campo di testo.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      const isRedo =
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z");
      if (!isUndo && !isRedo) return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (isUndo) history.undo();
      else history.redo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Toolbar onAdd={addElement} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={history.undo}
              disabled={!history.canUndo}
              title="Annulla (Ctrl+Z)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <Undo2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Ripristina (Ctrl+Y)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <Redo2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={rendering}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {rendering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Genera anteprima
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              <Save className="size-3.5" />
              {saving ? "Salvo…" : "Salva design"}
            </button>
          </div>
        </div>

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <div
          ref={canvasRef}
          className="relative overflow-hidden rounded-xl border border-border bg-white shadow-sm"
          style={{ width: displayWidth, height: displayHeight }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          {[...elements]
            .sort((a, b) => a.z_index - b.z_index)
            .map((el) => (
              <ElementBox
                key={el.id}
                element={el}
                selected={el.id === selectedId}
                onSelect={() => setSelectedId(el.id)}
                onChangeText={(value) =>
                  updateElement(el.id, {
                    style: { ...el.style, text: value },
                  })
                }
                ref={(node) => {
                  if (node) elementRefs.current.set(el.id, node);
                  else elementRefs.current.delete(el.id);
                }}
              />
            ))}
        </div>

        {targetEl && (
          <Moveable
            target={targetEl}
            draggable
            resizable
            rotatable
            keepRatio={false}
            throttleDrag={0}
            throttleResize={0}
            throttleRotate={0}
            onDrag={({ target, left, top }) => {
              (target as HTMLElement).style.left = `${left}px`;
              (target as HTMLElement).style.top = `${top}px`;
            }}
            onDragEnd={({ target }) => {
              if (!selectedId) return;
              updateElement(selectedId, {
                x: parseFloat((target as HTMLElement).style.left) || 0,
                y: parseFloat((target as HTMLElement).style.top) || 0,
              });
            }}
            onResize={({ target, width, height, drag }) => {
              const t = target as HTMLElement;
              t.style.width = `${width}px`;
              t.style.height = `${height}px`;
              t.style.left = `${drag.left}px`;
              t.style.top = `${drag.top}px`;
            }}
            onResizeEnd={({ target }) => {
              if (!selectedId) return;
              const t = target as HTMLElement;
              updateElement(selectedId, {
                width: parseFloat(t.style.width) || 0,
                height: parseFloat(t.style.height) || 0,
                x: parseFloat(t.style.left) || 0,
                y: parseFloat(t.style.top) || 0,
              });
            }}
            onRotate={({ target, transform, rotation }) => {
              (target as HTMLElement).style.transform = transform;
              rotationRef.current = rotation;
            }}
            onRotateEnd={() => {
              if (!selectedId) return;
              updateElement(selectedId, { rotation: Math.round(rotationRef.current) });
            }}
          />
        )}

        {renderError && <p className="text-xs text-destructive">{renderError}</p>}

        {previewUrl && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Anteprima render (i campi dinamici mostrano il nome del layer come segnaposto):
            </p>
            <img
              src={previewUrl}
              alt="Anteprima render"
              className="max-w-full rounded-lg border border-border"
            />
          </div>
        )}
      </div>

      <PropertiesPanel
        element={selected}
        layerNameSuggestions={layerNameSuggestions}
        fontOptions={fontOptions}
        onChange={(patch) => selectedId && updateElement(selectedId, patch, true)}
        onChangeStyle={updateSelectedStyle}
        onDelete={deleteSelected}
        onReorder={reorderSelected}
      />
    </div>
  );
}
