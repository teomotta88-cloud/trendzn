import * as LucideIcons from "lucide-react";
import type { EditorElement } from "./ElementBox";

// Pannello livelli: elenco di tutti gli elementi del frame corrente,
// ordinati per z_index dal primo piano (in cima) al fondo — stessa
// convenzione di lettura degli altri editor grafici (Figma, Canva...).
// Solo visualizzazione + selezione, niente drag-to-reorder: quello si fa
// già con i pulsanti "porta avanti/indietro/primo piano/fondo" nel pannello
// proprietà.

const TYPE_LABEL: Record<EditorElement["tipo"], string> = {
  text: "Testo",
  image: "Immagine",
  icon: "Icona",
  shape: "Forma",
};

function iconForType(tipo: EditorElement["tipo"]) {
  switch (tipo) {
    case "text":
      return LucideIcons.Type;
    case "image":
      return LucideIcons.Image;
    case "icon":
      return LucideIcons.Star;
    default:
      return LucideIcons.Square;
  }
}

function labelFor(el: EditorElement): string {
  if (el.layer_name) return el.layer_name;
  if (el.tipo === "text") {
    const text = (el.style as Record<string, unknown>).text;
    return typeof text === "string" && text.trim() ? text.trim().slice(0, 24) : "Testo";
  }
  if (el.tipo === "icon") {
    const name = (el.style as Record<string, unknown>).name;
    return typeof name === "string" ? name : "Icona";
  }
  return TYPE_LABEL[el.tipo];
}

export function LayersPanel({
  elements,
  selectedIds,
  onSelect,
}: {
  elements: EditorElement[];
  selectedIds: string[];
  onSelect: (id: string, e: { shiftKey: boolean }) => void;
}) {
  const sorted = [...elements].sort((a, b) => b.z_index - a.z_index);

  return (
    <div className="space-y-1 rounded-2xl border border-border bg-card/50 p-3">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Livelli
      </span>
      {sorted.length === 0 && (
        <p className="px-1 py-1 text-[11px] text-muted-foreground">Nessun elemento nel frame.</p>
      )}
      <div className="space-y-0.5">
        {sorted.map((el) => {
          const Icon = iconForType(el.tipo);
          return (
            <button
              key={el.id}
              type="button"
              onClick={(e) => onSelect(el.id, e)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                selectedIds.includes(el.id)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{labelFor(el)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
