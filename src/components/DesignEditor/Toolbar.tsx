import { Image, Shapes, Sparkles, Type } from "lucide-react";
import type { ElementTipo } from "@/lib/designElements";

interface ToolbarProps {
  onAdd: (tipo: ElementTipo) => void;
}

const ITEMS: Array<{ tipo: ElementTipo; label: string; icon: typeof Type }> = [
  { tipo: "text", label: "Testo", icon: Type },
  { tipo: "image", label: "Immagine", icon: Image },
  { tipo: "icon", label: "Icona", icon: Sparkles },
  { tipo: "shape", label: "Forma", icon: Shapes },
];

export function Toolbar({ onAdd }: ToolbarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ITEMS.map(({ tipo, label, icon: Icon }) => (
        <button
          key={tipo}
          type="button"
          onClick={() => onAdd(tipo)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Icon className="size-3.5" />
          Aggiungi {label}
        </button>
      ))}
    </div>
  );
}
