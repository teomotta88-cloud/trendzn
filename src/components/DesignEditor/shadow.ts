// Ombra elementi (Fase 7): stessi 4 campi (colore, blur, offset X/Y,
// opacità) per tutti i tipi di elemento, ma applicati con la proprietà CSS
// più adatta a ciascuno — box-shadow per forma/immagine (ombra rettangolare,
// look "card"), text-shadow per il testo (ombra sulle lettere, non sul box),
// drop-shadow per le icone (segue la sagoma reale dell'SVG/alpha, non il
// riquadro — un box-shadow su un'icona con sfondo trasparente sembrerebbe
// un rettangolo intorno all'icona invece che seguirne il contorno).

export interface ShadowStyle {
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0");
  const bigint = Number.parseInt(full, 16) || 0;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// null se non c'è nessuna ombra impostata (evita di aggiungere una
// proprietà CSS inutile quando blur/offset sono tutti a zero).
function shadowValue(s: Record<string, unknown>): string | null {
  const blur = typeof s.shadowBlur === "number" ? s.shadowBlur : 0;
  const offsetX = typeof s.shadowOffsetX === "number" ? s.shadowOffsetX : 0;
  const offsetY = typeof s.shadowOffsetY === "number" ? s.shadowOffsetY : 0;
  if (!blur && !offsetX && !offsetY) return null;
  const color = hexToRgba(
    typeof s.shadowColor === "string" ? s.shadowColor : "#000000",
    typeof s.shadowOpacity === "number" ? s.shadowOpacity : 0.5,
  );
  return `${offsetX}px ${offsetY}px ${blur}px ${color}`;
}

export function boxShadowCss(s: Record<string, unknown>): string | undefined {
  return shadowValue(s) ?? undefined;
}

export function textShadowCss(s: Record<string, unknown>): string | undefined {
  return shadowValue(s) ?? undefined;
}

export function dropShadowFilterCss(s: Record<string, unknown>): string | undefined {
  const value = shadowValue(s);
  return value ? `drop-shadow(${value})` : undefined;
}
