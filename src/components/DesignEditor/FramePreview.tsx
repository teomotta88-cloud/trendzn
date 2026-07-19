import type { RubricaFormato } from "@/lib/autographics";
import type { TemplateElement } from "@/lib/designElements";
import { ElementBox } from "./ElementBox";
import { computeScale, toEditorElement } from "./DesignEditor";

// Anteprima di sola lettura di un frame (wizard, Fase 9): stesso motore di
// rendering dell'editor (ElementBox), niente Moveable/selezione — serve solo
// a mostrare come il frame si compila in tempo reale mentre l'utente scrive
// nei campi a destra, prima di passare all'editor completo per le rifiniture.
export function FramePreview({
  formato,
  elements,
}: {
  formato: RubricaFormato;
  elements: TemplateElement[];
}) {
  const scale = computeScale(formato.width_px, formato.height_px);
  const displayWidth = formato.width_px * scale;
  const displayHeight = formato.height_px * scale;
  const editorElements = elements.map((el) => toEditorElement(el, scale));

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-white shadow-sm"
      style={{ width: displayWidth, height: displayHeight }}
    >
      {[...editorElements]
        .sort((a, b) => a.z_index - b.z_index)
        .map((el) => (
          <ElementBox
            key={el.id}
            element={el}
            selected={false}
            onSelect={() => undefined}
            onChangeText={() => undefined}
          />
        ))}
    </div>
  );
}
