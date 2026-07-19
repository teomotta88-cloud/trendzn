// Forma dei dati che questo plugin invia a trendzn: ricalca il più
// possibile FigmaNode/FigmaFill/FigmaEffect in
// src/routes/api/public/hooks/figma-import.ts (lo stesso JSON che quel
// file riceve oggi dalla REST API di Figma), con due differenze dovute al
// fatto che qui i dati vengono letti dalla Plugin API invece che dalla
// REST API:
// - gradientTransform (matrice 2x3) invece di gradientHandlePositions —
//   la Plugin API non espone le handle position, solo la matrice di
//   trasformazione; il server converte l'una o l'altra nello stesso
//   angolo CSS.
// - rotationDegrees (gradi) invece di rotation (radianti) — la Plugin API
//   restituisce già i gradi, la REST API i radianti.
// - pluginExportDataUrl: l'immagine/vettore già esportato QUI (via
//   node.exportAsync, nessuna chiamata di rete) come data URL — il server
//   lo usa direttamente invece di scaricare l'export dalla REST API di
//   Figma, che è esattamente ciò che bypassa il limite del piano.

export interface ExportedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ExportedFill {
  type: string;
  visible?: boolean;
  color?: ExportedColor;
  gradientStops?: { position: number; color: ExportedColor }[];
  gradientTransform?: [[number, number, number], [number, number, number]];
}

export interface ExportedEffect {
  type: string;
  visible?: boolean;
  color?: ExportedColor;
  offset?: { x: number; y: number };
  radius?: number;
}

export interface ExportedNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: ExportedFill[];
  strokes?: ExportedFill[];
  strokeWeight?: number;
  strokeDashes?: number[];
  opacity?: number;
  blendMode?: string;
  cornerRadius?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: string;
    letterSpacing?: number;
    lineHeightPx?: number;
    lineHeightPercentFontSize?: number;
    textCase?: string;
    textDecoration?: string;
  };
  effects?: ExportedEffect[];
  children?: ExportedNode[];
  rotationDegrees?: number;
  pluginExportDataUrl?: string;
}

export type PluginToUiMessage =
  | { type: "result"; root: ExportedNode; elementCount: number }
  | { type: "error"; message: string };
