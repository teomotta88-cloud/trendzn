import type { ComponentType } from "react";
import * as LucideIcons from "lucide-react";

// Elenco completo delle icone lucide-react (oltre 1000), calcolato a runtime
// dagli export del pacchetto invece di mantenerne uno a mano: sostituisce il
// precedente set curato di ~24 nomi con una libreria interamente cercabile
// (vedi IconPicker.tsx). Esclude gli export che non sono singole icone
// (createLucideIcon, la mappa `icons`, i tipi solo-TS che comunque non
// esistono a runtime) filtrando sui veri componenti React (forwardRef).
const NON_ICON_EXPORTS = new Set(["createLucideIcon", "icons", "default"]);

function isIconComponent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const marker = (value as { $$typeof?: symbol }).$$typeof;
  return marker === Symbol.for("react.forward_ref");
}

export const ALL_ICON_NAMES: string[] = Object.keys(LucideIcons)
  .filter((name) => /^[A-Z]/.test(name) && !NON_ICON_EXPORTS.has(name))
  .filter((name) => isIconComponent((LucideIcons as Record<string, unknown>)[name]))
  .sort();

export function getLucideIcon(name: string): ComponentType<{ className?: string }> | undefined {
  return (LucideIcons as unknown as Record<string, ComponentType<{ className?: string }>>)[name];
}
