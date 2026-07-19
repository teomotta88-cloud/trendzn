/// <reference types="@figma/plugin-typings" />
import type { ExportedColor, ExportedEffect, ExportedFill, ExportedNode, PluginToUiMessage } from "./types";

// Plugin di sola lettura: legge la selezione corrente e la serializza in
// JSON, esportando localmente (node.exportAsync, nessuna rete) le immagini
// e i vettori — bypassa del tutto la REST API di Figma, e con essa il
// limite di richieste/mese dei file su un team con piano Starter/gratuito.
// Nessun accesso di rete dichiarato in manifest.json: tutto il lavoro
// avviene nel sandbox del plugin, l'utente copia/scarica il JSON e lo
// incolla a mano in trendzn.

figma.showUI(__html__, { width: 480, height: 460 });

// Stessa euristica di hasCompoundDescendant in figma-import.ts: un'istanza
// di componente con un discendente TEXT o un'immagine bitmap è quasi
// certamente un componente "composto" (bottone/badge/card) da attraversare
// come contenitore, non un'icona atomica da appiattire in un export
// singolo. Duplicata qui (non importabile da un modulo server) solo per
// decidere se PRE-esportare un'immagine per questo nodo: la decisione
// finale su come trattarlo la prende comunque il server, questa copia
// serve solo a non sprecare un export inutile.
function hasCompoundDescendant(node: SceneNode & ChildrenMixin): boolean {
  for (const child of node.children) {
    if (child.visible === false) continue;
    if (child.type === "TEXT") return true;
    if (
      (child.type === "RECTANGLE" || child.type === "ELLIPSE") &&
      "fills" in child &&
      Array.isArray(child.fills) &&
      child.fills.some((f) => f.type === "IMAGE" && f.visible !== false)
    ) {
      return true;
    }
    if ("children" in child && hasCompoundDescendant(child)) return true;
  }
  return false;
}

const ALWAYS_DESCEND_TYPES = new Set(["FRAME", "GROUP", "SECTION"]);
const ICON_LIKE_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);

// Mappa nome-stile Figma (famiglia+stile, es. "Inter"+"Bold") -> peso CSS
// numerico (la REST API restituisce direttamente un numero, la Plugin API
// no): euristica sui nomi più comuni, non garantita per font custom con
// nomi di stile insoliti — in quel caso ricade su 400 (Regular).
const WEIGHT_BY_STYLE_NAME: Record<string, number> = {
  Thin: 100,
  Hairline: 100,
  ExtraLight: 200,
  "Extra Light": 200,
  UltraLight: 200,
  Light: 300,
  Regular: 400,
  Normal: 400,
  Book: 400,
  Medium: 500,
  SemiBold: 600,
  "Semi Bold": 600,
  DemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  "Extra Bold": 800,
  UltraBold: 800,
  Black: 900,
  Heavy: 900,
};

function weightFromStyleName(styleName: string): number {
  const clean = styleName.replace(/italic/gi, "").trim();
  return WEIGHT_BY_STYLE_NAME[clean] ?? 400;
}

function serializeColor(color: RGB, opacity: number | undefined): ExportedColor {
  return { r: color.r, g: color.g, b: color.b, a: opacity ?? 1 };
}

function serializeFills(fills: readonly Paint[] | typeof figma.mixed | undefined): ExportedFill[] | undefined {
  if (!fills || fills === figma.mixed) return undefined;
  return fills.map((f): ExportedFill => {
    if (f.type === "SOLID") {
      return { type: f.type, visible: f.visible, color: serializeColor(f.color, f.opacity) };
    }
    if (
      f.type === "GRADIENT_LINEAR" ||
      f.type === "GRADIENT_RADIAL" ||
      f.type === "GRADIENT_ANGULAR" ||
      f.type === "GRADIENT_DIAMOND"
    ) {
      return {
        type: f.type,
        visible: f.visible,
        gradientStops: f.gradientStops.map((s) => ({ position: s.position, color: s.color })),
        gradientTransform: f.gradientTransform,
      };
    }
    return { type: f.type, visible: f.visible };
  });
}

function serializeEffects(effects: readonly Effect[] | undefined): ExportedEffect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  return effects.map((e): ExportedEffect => {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      return { type: e.type, visible: e.visible, color: e.color, offset: e.offset, radius: e.radius };
    }
    return { type: e.type, visible: e.visible };
  });
}

async function serializeNode(node: SceneNode): Promise<ExportedNode> {
  const box = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
  const out: ExportedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    absoluteBoundingBox: box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : undefined,
  };

  if ("rotation" in node) out.rotationDegrees = node.rotation;
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") out.cornerRadius = node.cornerRadius;
  if ("fills" in node) out.fills = serializeFills(node.fills as readonly Paint[] | typeof figma.mixed);
  if ("strokes" in node) {
    out.strokes = serializeFills(node.strokes);
    if ("strokeWeight" in node && typeof node.strokeWeight === "number") out.strokeWeight = node.strokeWeight;
    if ("dashPattern" in node && node.dashPattern.length > 0) out.strokeDashes = [...node.dashPattern];
  }
  if ("opacity" in node) out.opacity = node.opacity;
  if ("blendMode" in node) out.blendMode = node.blendMode;
  if ("effects" in node) out.effects = serializeEffects(node.effects);

  if (node.type === "TEXT") {
    out.characters = node.characters;
    const fontName = node.fontName;
    const fontSize = node.fontSize;
    const letterSpacing = node.letterSpacing;
    const lineHeight = node.lineHeight;
    out.style = {
      fontFamily: fontName !== figma.mixed ? fontName.family : "Inter",
      fontWeight: fontName !== figma.mixed ? weightFromStyleName(fontName.style) : 400,
      fontSize: fontSize !== figma.mixed ? fontSize : 24,
      textAlignHorizontal: node.textAlignHorizontal,
      letterSpacing:
        letterSpacing !== figma.mixed
          ? letterSpacing.unit === "PIXELS"
            ? letterSpacing.value
            : (letterSpacing.value / 100) * (fontSize !== figma.mixed ? fontSize : 24)
          : undefined,
      lineHeightPx:
        lineHeight !== figma.mixed && lineHeight.unit === "PIXELS" ? lineHeight.value : undefined,
      lineHeightPercentFontSize:
        lineHeight !== figma.mixed && lineHeight.unit === "PERCENT" ? lineHeight.value : undefined,
      textCase: node.textCase !== figma.mixed ? node.textCase : undefined,
      textDecoration: node.textDecoration !== figma.mixed ? node.textDecoration : undefined,
    };
  }

  if ("children" in node && node.children.length > 0) {
    const shouldDescend =
      ALWAYS_DESCEND_TYPES.has(node.type) ||
      (ICON_LIKE_TYPES.has(node.type) && hasCompoundDescendant(node));
    if (shouldDescend) {
      const visibleChildren = node.children.filter((c) => c.visible !== false);
      out.children = await Promise.all(visibleChildren.map(serializeNode));
      return out;
    }
  }

  // Nodo foglia "visivo": pre-esportiamo qui un'immagine/vettore, il
  // server deciderà se e come usarla (campo immagine dinamico, icona,
  // vettore) — stessa logica del percorso REST, solo senza rete.
  const hasImageFill =
    (node.type === "RECTANGLE" || node.type === "ELLIPSE") &&
    "fills" in node &&
    Array.isArray(node.fills) &&
    node.fills.some((f) => f.type === "IMAGE" && f.visible !== false);
  try {
    if (hasImageFill && "exportAsync" in node) {
      const bytes = await node.exportAsync({ format: "PNG" });
      out.pluginExportDataUrl = `data:image/png;base64,${figma.base64Encode(bytes)}`;
    } else if (node.type !== "TEXT" && node.type !== "RECTANGLE" && node.type !== "ELLIPSE" && "exportAsync" in node) {
      const bytes = await node.exportAsync({ format: "SVG" });
      out.pluginExportDataUrl = `data:image/svg+xml;base64,${figma.base64Encode(bytes)}`;
    }
  } catch {
    // Alcuni tipi di nodo (es. SLICE, BOOLEAN_OPERATION vuoto) non sono
    // esportabili: si ignora, il server tratterà il nodo senza immagine
    // invece di far fallire l'intero export.
  }

  return out;
}

function unionBoundingBox(nodes: readonly SceneNode[]) {
  const boxes = nodes
    .map((n) => ("absoluteBoundingBox" in n ? n.absoluteBoundingBox : null))
    .filter((b): b is Rect => b != null);
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

function countElements(node: ExportedNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countElements(c), 0);
}

async function run() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    const message: PluginToUiMessage = {
      type: "error",
      message:
        'Seleziona un frame (o più frame insieme, o una sezione che li contiene) prima di eseguire il plugin.',
    };
    figma.ui.postMessage(message);
    return;
  }

  let root: ExportedNode;
  if (selection.length === 1) {
    root = await serializeNode(selection[0]);
  } else {
    const children = await Promise.all(selection.map(serializeNode));
    root = {
      id: "trendzn-multi-selection",
      name: "Selezione multipla",
      type: "SECTION",
      visible: true,
      absoluteBoundingBox: unionBoundingBox(selection),
      children,
    };
  }

  const message: PluginToUiMessage = { type: "result", root, elementCount: countElements(root) };
  figma.ui.postMessage(message);
}

run().catch((err) => {
  const message: PluginToUiMessage = { type: "error", message: String(err) };
  figma.ui.postMessage(message);
});
