// Riempimento, bordo, opacità e blend mode: proprietà mappate da Figma
// (fills con gradiente, strokes, node.opacity, node.blendMode) e anche
// editabili a mano dal PropertiesPanel. Vivono in un file a parte perché,
// a differenza dell'ombra (shadow.ts), il riempimento ha una rappresentazione
// "strutturata" (fillType/fillColor/gradientFrom/gradientTo/gradientAngle)
// separata dal CSS finale: la UI edita i campi strutturati, resolveFillCss
// calcola il valore CSS effettivo. fillCss è un override grezzo, usato solo
// dall'import Figma per i gradienti che la UI semplificata non sa
// rappresentare (più di 2 stop, angolari, a diamante): se presente ha
// sempre la precedenza, e la UI di modifica lo rimuove appena l'utente
// tocca un campo strutturato (a quel punto passa a un gradiente 2 colori).

export type FillType = "solid" | "linear" | "radial";

export function resolveFillCss(s: Record<string, unknown>): string {
  if (typeof s.fillCss === "string") return s.fillCss;
  const type = (s.fillType as FillType) || "solid";
  const from = typeof s.gradientFrom === "string" ? s.gradientFrom : "#ffffff";
  const to = typeof s.gradientTo === "string" ? s.gradientTo : "#000000";
  if (type === "linear") {
    const angle = typeof s.gradientAngle === "number" ? s.gradientAngle : 90;
    return `linear-gradient(${angle}deg, ${from}, ${to})`;
  }
  if (type === "radial") {
    return `radial-gradient(circle, ${from}, ${to})`;
  }
  // Solido: fillColor è il campo strutturato nuovo, fill quello legacy
  // (design salvati prima dell'introduzione del gradiente) — entrambi sono
  // semplicemente un colore CSS valido.
  return (
    (typeof s.fillColor === "string" && s.fillColor) ||
    (typeof s.fill === "string" && s.fill) ||
    "#cccccc"
  );
}

// Nomi "borderWidth/borderColor/borderDashed" e non "stroke*": gli elementi
// icona usano già style.strokeWidth/style.color per lo spessore/colore del
// tratto SVG interno della Lucide icon, un concetto diverso (e non
// sovrapponibile) dal bordo CSS del riquadro qui.
export function borderCss(s: Record<string, unknown>): string | undefined {
  const width = typeof s.borderWidth === "number" ? s.borderWidth : 0;
  if (!width) return undefined;
  const color = typeof s.borderColor === "string" ? s.borderColor : "#000000";
  return `${width}px ${s.borderDashed ? "dashed" : "solid"} ${color}`;
}

export function opacityValue(s: Record<string, unknown>): number | undefined {
  return typeof s.opacity === "number" ? Math.min(1, Math.max(0, s.opacity)) : undefined;
}

// Sottoinsieme dei blend mode CSS che ha un corrispettivo diretto nei
// blendMode di Figma (stessi nomi, kebab-case) — validato per non iniettare
// valori arbitrari nello style inline.
const BLEND_MODES = new Set([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

export function blendModeCss(s: Record<string, unknown>): string | undefined {
  return typeof s.blendMode === "string" && BLEND_MODES.has(s.blendMode) ? s.blendMode : undefined;
}
