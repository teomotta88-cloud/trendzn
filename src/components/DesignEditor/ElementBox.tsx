import { forwardRef, useEffect, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import type { ElementTipo } from "@/lib/designElements";

// Un elemento nello stato dell'editor: stesse colonne di template_elements,
// ma x/y/width/height/style.fontSize sono in "px di visualizzazione"
// (scalati per stare comodi a schermo) — la conversione da/verso le unità
// reali del formato vive in DesignEditor.tsx (toDisplay/toExport).
export interface EditorElement {
  id: string;
  layer_name: string | null;
  tipo: ElementTipo;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  style: Record<string, unknown>;
}

interface ElementBoxProps {
  element: EditorElement;
  selected: boolean;
  onSelect: () => void;
  onChangeText: (value: string) => void;
}

// Rappresenta un elemento sul canvas dell'editor. Il render finale (vedi
// src/lib/design-capture.ts) cattura direttamente questo stesso DOM — non
// esiste una reimplementazione separata del layout: quello che si vede qui
// è, letteralmente, quello che esce dall'export.
export const ElementBox = forwardRef<HTMLDivElement, ElementBoxProps>(function ElementBox(
  { element, selected, onSelect, onChangeText },
  ref,
) {
  const [editingText, setEditingText] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingText) {
      setDraft(typeof element.style.text === "string" ? element.style.text : "");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    outline: selected ? "2px solid var(--primary, #6366f1)" : "1px dashed transparent",
    cursor: "move",
  };

  function stopEditing(commit: boolean) {
    if (commit) onChangeText(draft);
    setEditingText(false);
  }

  // style è un jsonb libero (le proprietà dipendono da element.tipo): un
  // singolo cast qui invece di propagare `any` nel tipo condiviso.
  const s = element.style as Record<string, any>;

  if (element.tipo === "text") {
    return (
      <div
        ref={ref}
        style={{
          ...baseStyle,
          display: "flex",
          fontFamily: s.fontFamily || "Inter",
          fontSize: s.fontSize ?? 24,
          fontWeight: s.fontWeight ?? 400,
          color: s.color || "#000000",
          lineHeight: s.lineHeight ?? 1.2,
          textAlign: s.align || "left",
          justifyContent:
            s.align === "center" ? "center" : s.align === "right" ? "flex-end" : "flex-start",
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
        onMouseDown={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditingText(true);
        }}
      >
        {editingText ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => stopEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") stopEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) stopEditing(true);
            }}
            style={{
              width: "100%",
              height: "100%",
              fontFamily: "inherit",
              fontSize: "inherit",
              fontWeight: "inherit",
              color: "inherit",
              textAlign: "inherit",
              lineHeight: "inherit",
              background: "rgba(255,255,255,0.85)",
              border: "1px solid #6366f1",
              resize: "none",
              outline: "none",
            }}
          />
        ) : element.layer_name ? (
          <span className="opacity-90">{element.layer_name}</span>
        ) : (
          (s.text as string) || <span className="opacity-50">Doppio click per scrivere…</span>
        )}
      </div>
    );
  }

  if (element.tipo === "image") {
    // Un campo immagine dinamico (layer_name impostato) non ha un valore
    // reale finché non esiste un job: previewSrc è solo per vedere/catturare
    // qualcosa di sensato nell'editor, sostituito dal valore vero in fase di
    // generazione bulk (Fase 5). src (fissa) e previewSrc non coesistono mai
    // realmente: src è per immagini fisse (logo), previewSrc per i campi
    // dinamici — se entrambe assenti, placeholder.
    const src =
      typeof s.src === "string" ? s.src : typeof s.previewSrc === "string" ? s.previewSrc : null;
    return (
      <div
        ref={ref}
        style={{
          ...baseStyle,
          borderRadius: s.borderRadius ?? 0,
          overflow: "hidden",
          background: "#e2e8f0",
        }}
        onMouseDown={onSelect}
      >
        {src ? (
          <img
            src={src}
            alt=""
            crossOrigin="anonymous"
            style={{
              width: "100%",
              height: "100%",
              objectFit: s.objectFit || "cover",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <LucideIcons.Image className="size-5 opacity-60" />
            {element.layer_name && <span>{element.layer_name}</span>}
          </div>
        )}
      </div>
    );
  }

  if (element.tipo === "icon") {
    const IconComponent = (LucideIcons as Record<string, any>)[s.name || "Circle"];
    return (
      <div
        ref={ref}
        style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center" }}
        onMouseDown={onSelect}
      >
        {IconComponent && (
          <IconComponent
            color={s.color || "#000000"}
            strokeWidth={s.strokeWidth ?? 2}
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>
    );
  }

  // shape
  return (
    <div
      ref={ref}
      style={{
        ...baseStyle,
        backgroundColor: s.fill || "#cccccc",
        borderRadius: s.borderRadius ?? 0,
      }}
      onMouseDown={onSelect}
    />
  );
});
