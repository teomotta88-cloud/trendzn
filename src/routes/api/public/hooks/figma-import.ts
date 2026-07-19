import { createFileRoute } from "@tanstack/react-router";

// Import di uno o più frame Figma nell'editor grafico interno: usa la REST
// API pubblica di Figma (non lo scraping fatto per Getty, qui esiste
// un'API ufficiale) per leggere l'albero di nodi e mapparlo su
// template_elements. Richiede un Personal Access Token Figma (qualunque
// piano, anche gratuito, basta avere accesso in visualizzazione al file)
// configurato come FIGMA_ACCESS_TOKEN nell'ambiente dell'app — stesso
// pattern di OPENROUTER_API_KEY/GITHUB_TOKEN altrove in questo progetto.
//
// Rilevamento frame multipli (carousel): se il link incollato punta a un
// contenitore (pagina/sezione/gruppo) i cui figli diretti sono almeno due
// FRAME, ognuno di quei frame diventa una card separata (card_index 1..N,
// ordinate per il numero finale nel nome del frame, es. "..._01" prima di
// "..._02"). Se invece il link punta direttamente a un singolo frame "carta"
// (i cui figli sono i normali elementi del design, non altri frame), si
// importa quel solo frame — comportamento identico a prima. Per forzare
// l'import di un solo frame anche dentro una sezione con più frame, incolla
// il link al frame specifico invece che al contenitore.
//
// Campi dinamici automatici: ogni elemento di testo/immagine/icona/vettore
// diventa automaticamente un campo dinamico (layer_name), numerato per tipo
// e per frame (#title1, #image1, #icon1, #vector1, ...). Convenzioni:
// - un nome layer che inizia per "#" viene usato COSÌ COM'È (override
//   manuale, utile per dare un nome semantico specifico);
// - un nome layer che inizia per "!" resta invece un elemento FISSO (non
//   diventa un campo), utile per loghi/watermark che non devono cambiare
//   da post a post.
// Le forme (rettangoli/ellissi senza fill immagine) restano sempre fisse,
// non sono mai campi dinamici.
//
// Component/istanze: se un'istanza contiene testo o un'immagine (segno che è
// un componente "composto" tipo bottone/badge/card, non una singola icona),
// viene attraversata come un contenitore invece che appiattita in un'unica
// immagine — Figma restituisce già i valori con eventuali override
// applicati nell'albero di /v1/files/:key/nodes, quindi i figli entrano
// come elementi normali (testo/forma/immagine/icona) senza bisogno di una
// logica di override separata. Un'istanza puramente vettoriale (nessun
// figlio TEXT o immagine, es. un vero simbolo icona) resta invece
// appiattita come prima.
//
// Effetti ricevuti automaticamente da Figma per i campi dinamici immagine:
// - Ombra (DROP_SHADOW): letta dal nodo foglia stesso, come sempre — se in
//   Figma l'ombra è applicata a un gruppo/frame che contiene l'immagine
//   invece che all'immagine stessa, NON viene propagata ai figli (limite
//   noto, vedi sotto).
// - Rimozione sfondo: Figma non ha un "effetto" API per questo, ma se la
//   foto placeholder del campo è già stata ritagliata a mano dal designer
//   (il PNG esportato ha già una trasparenza reale, non solo bordi
//   anti-aliasati — vedi pngHasSignificantTransparency), lo interpretiamo
//   come segnale che anche le foto vere caricate per quel campo nel wizard
//   devono avere lo sfondo rimosso automaticamente, e impostiamo da soli
//   style.autoRemoveBackground. Richiede di scaricare il PNG esportato e
//   ispezionarne i byte (Cloudflare Workers non ha Canvas/Image): best
//   effort, un fallimento qui non fa fallire l'import.
//
// Riempimento, bordo, opacità, blend mode: i fill a gradiente (lineare,
// radiale) vengono convertiti in una funzione CSS equivalente; un fill
// angolare/a diamante o con più di 2 stop non ha un editor dedicato nel
// nostro pannello proprietà, ma viene comunque reso correttamente via
// style.fillCss (un override "grezzo": editabile solo sostituendolo con un
// gradiente semplice a 2 colori, non modificabile stop per stop). Lo
// stroke (bordo) supporta solo un colore singolo — un bordo a gradiente in
// Figma usa il colore del primo stop. Il blend mode usa direttamente i
// nomi CSS mix-blend-mode (stesso set di Figma, salvo PASS_THROUGH).
//
// Cosa NON fa (limiti noti, documentati invece di finti al 100%):
// - I gruppi/frame annidati (nel caso single-frame) vengono attraversati ma
//   non riprodotti come gruppi nel nostro editor (serve un secondo passaggio
//   manuale con "Raggruppa" se si vuole lo stesso raggruppamento) — e un
//   effetto (ombra) applicato al gruppo/frame invece che al singolo
//   elemento non viene propagato ai figli, solo letto dal nodo foglia.
// - "Icona" vs "vettore" è una distinzione euristica: COMPONENT/INSTANCE
//   atomici (spesso simboli icona in un design system) diventano "icon", il
//   resto dei nodi vettoriali (VECTOR/STAR/LINE/BOOLEAN_OPERATION/...)
//   diventa "vector" — in entrambi i casi il nostro editor non ha un tipo
//   elemento "vettore" nativo (path editabili), quindi vengono importati
//   come elemento immagine con un export SVG (nitido a qualunque
//   dimensione, diversamente da un PNG appiattito) e style.isVector = true.
// - La rotazione è convertita da radianti (Figma) a gradi CSS assumendo la
//   convenzione standard di Figma (radianti antiorari) — non verificato
//   contro un file reale in questo ambiente, ricontrollare gli elementi
//   ruotati dopo l'import.
// - Il controllo font (fatto lato client in FigmaImportPanel, che conosce i
//   font disponibili in trendzn) confronta solo il nome della famiglia,
//   non lo specifico peso/stile.
// - Testo multi-stile nello stesso blocco (override per intervallo di
//   caratteri in Figma) non è supportato: il nostro elemento testo è un
//   blocco unico con uno stile solo, prende lo stile del primo carattere.
// - Auto-layout, componenti/varianti come concetto riutilizzabile, boolean
//   operation come path editabile e prototipazione non hanno equivalente
//   nel nostro editor (che genera immagini statiche, non un layout
//   reattivo) e non vengono importati.

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FigmaFill {
  type: string;
  visible?: boolean;
  color?: FigmaColor;
  gradientHandlePositions?: { x: number; y: number }[];
  gradientStops?: { position: number; color: FigmaColor }[];
}

interface FigmaEffect {
  type: string;
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: FigmaFill[];
  strokes?: FigmaFill[];
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
  effects?: FigmaEffect[];
  children?: FigmaNode[];
  rotation?: number;
}

interface MappedElement {
  figmaNodeId: string;
  layer_name: string | null;
  tipo: "text" | "image" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  style: Record<string, unknown>;
  exportFormat: "png" | "svg" | null;
}

export interface MappedFrame {
  name: string;
  width: number;
  height: number;
  elements: MappedElement[];
}

// Estrae fileKey e node-id da un link Figma tipo
// https://www.figma.com/(file|design)/<fileKey>/<nome>?node-id=<nodeId>
// Il node-id nell'URL usa "-" al posto di ":" (es. "12-34" -> "12:34").
export function parseFigmaLink(link: string): { fileKey: string; nodeId: string } | null {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/\/(file|design)\/([^/]+)/);
    const nodeIdRaw = url.searchParams.get("node-id");
    if (!match || !nodeIdRaw) return null;
    return { fileKey: match[2], nodeId: nodeIdRaw.replace(/-/g, ":") };
  } catch {
    return null;
  }
}

function colorToHex(c: FigmaColor): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  const hex = (v: number) => to255(v).toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function shadowStyleFromEffects(effects: FigmaEffect[] | undefined): Record<string, unknown> {
  const shadow = effects?.find((e) => e.type === "DROP_SHADOW" && e.visible !== false);
  if (!shadow) return {};
  return {
    shadowColor: shadow.color ? colorToHex(shadow.color) : "#000000",
    shadowOpacity: shadow.color?.a ?? 0.5,
    shadowBlur: shadow.radius ?? 0,
    shadowOffsetX: shadow.offset?.x ?? 0,
    shadowOffsetY: shadow.offset?.y ?? 0,
  };
}

// Bucket di naming per il campo dinamico auto-generato: distinto dal
// "tipo" salvato (che per icon/vector resta "image", vedi sopra).
type NamingBucket = "title" | "image" | "icon" | "vector";

function nextAutoName(counters: Record<string, number>, bucket: NamingBucket): string {
  counters[bucket] = (counters[bucket] ?? 0) + 1;
  return `#${bucket}${counters[bucket]}`;
}

// Nome esplicito ("#..." override, "!..." fisso) o null se va deciso
// dall'auto-naming per tipo in flatten().
function explicitLayerName(name: string): { forced: string | null } | null {
  if (name.startsWith("#")) return { forced: name };
  if (name.startsWith("!")) return { forced: null };
  return null;
}

const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION", "CANVAS"]);
// COMPONENT/COMPONENT_SET/INSTANCE: bucket "icon" quando restano un nodo
// foglia (vedi hasCompoundDescendant più sotto per quando invece vengono
// attraversati come contenitore). Tutto il resto che non è TEXT/RECTANGLE/
// ELLIPSE (VECTOR, STAR, LINE, BOOLEAN_OPERATION, ma anche qualunque altro
// tipo di nodo Figma non gestito esplicitamente) cade nel bucket "vector"
// come fallback generico.
const ICON_LIKE_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);

// Un'istanza/componente con almeno un discendente TEXT o un'immagine
// bitmap è quasi certamente un componente "composto" (bottone, badge, card)
// dove ogni pezzo deve restare un campo modificabile separato — va quindi
// attraversata come contenitore, non appiattita in una singola icona SVG.
function hasCompoundDescendant(node: FigmaNode): boolean {
  for (const child of node.children ?? []) {
    if (child.visible === false) continue;
    if (child.type === "TEXT") return true;
    if (
      (child.type === "RECTANGLE" || child.type === "ELLIPSE") &&
      child.fills?.some((f) => f.type === "IMAGE" && f.visible !== false)
    ) {
      return true;
    }
    if (hasCompoundDescendant(child)) return true;
  }
  return false;
}

function pickVisiblePaintFill(fills: FigmaFill[] | undefined): FigmaFill | null {
  if (!fills) return null;
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (f.visible !== false && f.type !== "IMAGE") return f;
  }
  return null;
}

function gradientAngleFromHandles(handles: { x: number; y: number }[] | undefined): number {
  if (!handles || handles.length < 2) return 90;
  const dx = handles[1].x - handles[0].x;
  const dy = handles[1].y - handles[0].y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(deg < 0 ? deg + 360 : deg);
}

function stopsToCssList(stops: { position: number; color: FigmaColor }[]): string {
  return stops.map((s) => `${colorToHex(s.color)} ${Math.round(s.position * 100)}%`).join(", ");
}

// textMode true: usato per il colore del testo (niente fillType/fillCss,
// solo "color" — un testo con fill a gradiente non è supportato dal nostro
// editor, si usa il colore del primo stop come approssimazione).
// textMode false: usato per il riempimento di forme/immagini. Un gradiente
// a 2 stop lineare/radiale popola i campi strutturati editabili dal
// pannello proprietà; qualunque altro caso (>2 stop, angolare, a diamante)
// finisce in fillCss, un override CSS grezzo — reso correttamente ma
// modificabile solo sostituendolo con un gradiente semplice.
function fillStyleFromNode(
  fills: FigmaFill[] | undefined,
  textMode: boolean,
): Record<string, unknown> {
  const fill = pickVisiblePaintFill(fills);
  if (!fill) return {};
  if (fill.type === "SOLID") {
    const hex = fill.color ? colorToHex(fill.color) : "#000000";
    return textMode ? { color: hex } : { fillColor: hex };
  }
  const stops = fill.gradientStops ?? [];
  if (stops.length === 0) return {};
  if (fill.type === "GRADIENT_LINEAR") {
    if (stops.length === 2 && !textMode) {
      return {
        fillType: "linear",
        gradientFrom: colorToHex(stops[0].color),
        gradientTo: colorToHex(stops[1].color),
        gradientAngle: gradientAngleFromHandles(fill.gradientHandlePositions),
      };
    }
    const css = `linear-gradient(${gradientAngleFromHandles(fill.gradientHandlePositions)}deg, ${stopsToCssList(stops)})`;
    return textMode ? { color: colorToHex(stops[0].color) } : { fillCss: css };
  }
  if (fill.type === "GRADIENT_RADIAL") {
    if (stops.length === 2 && !textMode) {
      return {
        fillType: "radial",
        gradientFrom: colorToHex(stops[0].color),
        gradientTo: colorToHex(stops[1].color),
      };
    }
    const css = `radial-gradient(circle, ${stopsToCssList(stops)})`;
    return textMode ? { color: colorToHex(stops[0].color) } : { fillCss: css };
  }
  if (fill.type === "GRADIENT_ANGULAR") {
    const css = `conic-gradient(${stopsToCssList(stops)})`;
    return textMode ? { color: colorToHex(stops[0].color) } : { fillCss: css };
  }
  if (fill.type === "GRADIENT_DIAMOND") {
    // Nessun equivalente CSS per un gradiente a diamante: approssimato con
    // un gradiente lineare sugli stessi stop, non identico ma più fedele
    // di un singolo colore piatto.
    const css = `linear-gradient(90deg, ${stopsToCssList(stops)})`;
    return textMode ? { color: colorToHex(stops[0].color) } : { fillCss: css };
  }
  return {};
}

// Bordo CSS: solo colore singolo, un bordo a gradiente in Figma usa il
// colore del primo stop (border-image con un gradiente vero è possibile in
// CSS ma non vale la complessità per un caso limite).
function strokeStyleFromNode(node: FigmaNode): Record<string, unknown> {
  const stroke = pickVisiblePaintFill(node.strokes);
  const weight = node.strokeWeight;
  if (!stroke || !weight) return {};
  const color =
    stroke.type === "SOLID"
      ? stroke.color
        ? colorToHex(stroke.color)
        : "#000000"
      : stroke.gradientStops?.[0]?.color
        ? colorToHex(stroke.gradientStops[0].color)
        : "#000000";
  return {
    borderColor: color,
    borderWidth: weight,
    borderDashed: Array.isArray(node.strokeDashes) && node.strokeDashes.length > 0,
  };
}

// NORMAL/PASS_THROUGH sono il default di Figma (nessun blend mode
// applicato): omessi per non sporcare lo style con un valore ridondante.
function blendModeFromFigma(mode: string | undefined): string | undefined {
  if (!mode || mode === "NORMAL" || mode === "PASS_THROUGH") return undefined;
  return mode.toLowerCase().replace(/_/g, "-");
}

function opacityBlendStyle(node: FigmaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof node.opacity === "number" && node.opacity < 1) out.opacity = node.opacity;
  const blend = blendModeFromFigma(node.blendMode);
  if (blend) out.blendMode = blend;
  return out;
}

const TEXT_CASE_TRANSFORM: Record<string, string> = {
  UPPER: "uppercase",
  LOWER: "lowercase",
  TITLE: "capitalize",
};
const TEXT_CASE_VARIANT = new Set(["SMALL_CAPS", "SMALL_CAPS_FORCED"]);
const TEXT_DECORATION_MAP: Record<string, string> = {
  UNDERLINE: "underline",
  STRIKETHROUGH: "line-through",
};

// Testo multi-stile (override per intervallo di caratteri) non è
// supportato: legge solo lo stile "di base" del nodo TEXT, come per
// fontFamily/fontSize/fontWeight già prima di questa modifica.
function textAdvancedStyle(style: FigmaNode["style"]): Record<string, unknown> {
  if (!style) return {};
  const out: Record<string, unknown> = {};
  if (typeof style.letterSpacing === "number" && style.letterSpacing !== 0) {
    out.letterSpacing = style.letterSpacing;
  }
  if (typeof style.lineHeightPx === "number" && style.fontSize) {
    out.lineHeight = Number((style.lineHeightPx / style.fontSize).toFixed(2));
  } else if (typeof style.lineHeightPercentFontSize === "number") {
    out.lineHeight = Number((style.lineHeightPercentFontSize / 100).toFixed(2));
  }
  const textCase = style.textCase;
  if (textCase && TEXT_CASE_TRANSFORM[textCase]) out.textTransform = TEXT_CASE_TRANSFORM[textCase];
  if (textCase && TEXT_CASE_VARIANT.has(textCase)) out.fontVariant = "small-caps";
  if (style.textDecoration && TEXT_DECORATION_MAP[style.textDecoration]) {
    out.textDecoration = TEXT_DECORATION_MAP[style.textDecoration];
  }
  return out;
}

// Attraversamento in profondità di UN frame: i contenitori annidati
// (frame/gruppo/sezione) non diventano un elemento, si scende nei figli; i
// nodi "foglia" diventano un singolo template_element. z_index segue
// l'ordine dei figli in Figma (dal basso verso l'alto, stessa convenzione
// dei nostri z_index). counters è per-frame: ogni frame riparte da 1 per
// ogni bucket (#title1, #image1, ... in ogni card).
function flatten(
  node: FigmaNode,
  originX: number,
  originY: number,
  zCounter: { value: number },
  nameCounters: Record<string, number>,
  out: MappedElement[],
): void {
  if (node.visible === false) return;

  const isContainer = CONTAINER_TYPES.has(node.type);
  const isCompoundInstance =
    ICON_LIKE_TYPES.has(node.type) &&
    (node.children?.length ?? 0) > 0 &&
    hasCompoundDescendant(node);
  if ((isContainer || isCompoundInstance) && node.children && node.children.length > 0) {
    for (const child of node.children) {
      flatten(child, originX, originY, zCounter, nameCounters, out);
    }
    return;
  }

  const box = node.absoluteBoundingBox;
  if (!box) return;

  const explicit = explicitLayerName(node.name);
  const rotationDeg = node.rotation ? Math.round((-node.rotation * 180) / Math.PI) : 0;
  const base = {
    figmaNodeId: node.id,
    x: box.x - originX,
    y: box.y - originY,
    width: box.width,
    height: box.height,
    rotation: rotationDeg,
    z_index: zCounter.value++,
  };
  const shadowStyle = shadowStyleFromEffects(node.effects);

  const strokeStyle = strokeStyleFromNode(node);
  const appearanceStyle = opacityBlendStyle(node);

  if (node.type === "TEXT") {
    const layerName = explicit ? explicit.forced : nextAutoName(nameCounters, "title");
    const textFill = fillStyleFromNode(node.fills, true);
    out.push({
      ...base,
      layer_name: layerName,
      tipo: "text",
      exportFormat: null,
      style: {
        text: layerName ? undefined : node.characters,
        fontFamily: node.style?.fontFamily ?? "Inter",
        fontSize: node.style?.fontSize ?? 24,
        fontWeight: node.style?.fontWeight ?? 400,
        color: (textFill.color as string | undefined) ?? "#000000",
        align: (node.style?.textAlignHorizontal ?? "LEFT").toLowerCase(),
        ...shadowStyle,
        ...strokeStyle,
        ...appearanceStyle,
        ...textAdvancedStyle(node.style),
      },
    });
    return;
  }

  if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
    const imageFill = node.fills?.find((f) => f.type === "IMAGE" && f.visible !== false);
    if (imageFill) {
      const layerName = explicit ? explicit.forced : nextAutoName(nameCounters, "image");
      out.push({
        ...base,
        layer_name: layerName,
        tipo: "image",
        exportFormat: "png",
        style: {
          objectFit: "cover",
          borderRadius: node.cornerRadius ?? 0,
          ...shadowStyle,
          ...strokeStyle,
          ...appearanceStyle,
        },
      });
      return;
    }
    // Forma piena (rettangolo/ellisse senza immagine): sempre fissa, mai
    // un campo dinamico, indipendentemente da "#"/"!" nel nome.
    const paintStyle = fillStyleFromNode(node.fills, false);
    out.push({
      ...base,
      layer_name: null,
      tipo: "shape",
      exportFormat: null,
      style: {
        ...(Object.keys(paintStyle).length > 0 ? paintStyle : { fillColor: "transparent" }),
        borderRadius: node.type === "ELLIPSE" ? 9999 : (node.cornerRadius ?? 0),
        ...shadowStyle,
        ...strokeStyle,
        ...appearanceStyle,
      },
    });
    return;
  }

  // Icone (component/instance atomici, senza discendenti composti — vedi
  // hasCompoundDescendant) e vettori generici (path, stelle, linee,
  // booleani): esportati come SVG (nitido a qualunque dimensione) invece
  // che PNG appiattito. Il nostro editor non ha un tipo "vettore" nativo:
  // entrano come "image" con style.isVector = true.
  const bucket: NamingBucket = ICON_LIKE_TYPES.has(node.type) ? "icon" : "vector";
  const layerName = explicit ? explicit.forced : nextAutoName(nameCounters, bucket);
  out.push({
    ...base,
    layer_name: layerName,
    tipo: "image",
    exportFormat: "svg",
    style: {
      objectFit: "contain",
      isVector: true,
      ...shadowStyle,
      ...strokeStyle,
      ...appearanceStyle,
    },
  });
}

function extractTrailingNumber(name: string): number | null {
  const match = name.match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
}

// Funzione pura (nessuna chiamata di rete): dato l'albero già scaricato da
// Figma, decide se è un import multi-frame o singolo e produce le card
// mappate. Isolata dal resto per poter essere testata senza un vero account
// Figma (vedi script di verifica usato in fase di sviluppo).
export function mapFigmaTreeToFrames(root: FigmaNode): MappedFrame[] {
  const directChildren = (root.children ?? []).filter((c) => c.visible !== false);
  const childFrames = directChildren.filter((c) => c.type === "FRAME");

  if (childFrames.length >= 2) {
    const ordered = [...childFrames].sort((a, b) => {
      const na = extractTrailingNumber(a.name);
      const nb = extractTrailingNumber(b.name);
      if (na != null && nb != null) return na - nb;
      if (na != null) return -1;
      if (nb != null) return 1;
      return 0;
    });
    return ordered.map((frame) => {
      const box = frame.absoluteBoundingBox!;
      const elements: MappedElement[] = [];
      const zCounter = { value: 0 };
      const nameCounters: Record<string, number> = {};
      for (const child of frame.children ?? []) {
        flatten(child, box.x, box.y, zCounter, nameCounters, elements);
      }
      return {
        name: frame.name,
        width: Math.round(box.width),
        height: Math.round(box.height),
        elements,
      };
    });
  }

  const rootBox = root.absoluteBoundingBox!;
  const elements: MappedElement[] = [];
  const zCounter = { value: 0 };
  const nameCounters: Record<string, number> = {};
  for (const child of root.children ?? []) {
    flatten(child, rootBox.x, rootBox.y, zCounter, nameCounters, elements);
  }
  return [
    {
      name: root.name,
      width: Math.round(rootBox.width),
      height: Math.round(rootBox.height),
      elements,
    },
  ];
}

// Rileva se un PNG esportato da Figma ha già una trasparenza reale (non
// solo bordi anti-aliasati): se il designer ha già "ritagliato" la foto
// placeholder di un campo dinamico in Figma, è un segnale che anche le
// foto vere caricate per quel campo nel wizard dovrebbero avere lo sfondo
// rimosso automaticamente (style.autoRemoveBackground) — evita di dover
// impostarlo a mano ogni volta nell'editor. Implementato senza librerie
// (Cloudflare Workers non ha Canvas/Image): parse dei chunk PNG, inflate
// zlib dei chunk IDAT via DecompressionStream("deflate") (IDAT è
// zlib-wrapped, RFC 1950 — è il formato "deflate" delle Compression
// Streams, non "deflate-raw"), poi un un-filter degli scanline secondo la
// spec PNG (§ Filtering) e un campionamento del canale alpha.
// Limiti noti: solo bit depth 8 (il caso quasi universale per un export
// Figma); colorType 3 (palette) approssimato solo dalla presenza di un
// chunk tRNS, senza decodificare i pixel; qualunque errore di parsing
// ritorna false (nessun auto-flag) invece di far fallire l'import.
export async function pngHasSignificantTransparency(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  let hasTrns = false;
  const idatParts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (dataStart + len > bytes.length) break;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "IDAT") {
      idatParts.push(bytes.subarray(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + len + 4;
  }

  const hasAlphaChannel = colorType === 4 || colorType === 6;
  if (!hasAlphaChannel && !hasTrns) return false; // strutturalmente opaco
  if (colorType === 3) return hasTrns; // palette: approssimazione, vedi sopra
  if (!hasAlphaChannel || bitDepth !== 8 || width === 0 || height === 0 || idatParts.length === 0) {
    return false;
  }

  const compressed = new Uint8Array(idatParts.reduce((n, p) => n + p.length, 0));
  {
    let o = 0;
    for (const part of idatParts) {
      compressed.set(part, o);
      o += part.length;
    }
  }

  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  void writer.write(compressed);
  void writer.close();
  const raw = new Uint8Array(await new Response(ds.readable).arrayBuffer());

  const channels = colorType === 6 ? 4 : 2;
  const rowBytes = width * channels;
  let pos = 0;
  let prevRow = new Uint8Array(rowBytes);
  let transparentSamples = 0;
  let totalSamples = 0;
  for (let y = 0; y < height && pos < raw.length; y++) {
    const filterType = raw[pos];
    pos += 1;
    const row = raw.subarray(pos, pos + rowBytes);
    pos += rowBytes;
    const out = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prevRow[i];
      const c = i >= channels ? prevRow[i - channels] : 0;
      let pred = 0;
      switch (filterType) {
        case 1:
          pred = a;
          break;
        case 2:
          pred = b;
          break;
        case 3:
          pred = Math.floor((a + b) / 2);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          pred = 0;
      }
      out[i] = (row[i] + pred) & 0xff;
    }
    // Campiona una riga ogni 4 e un pixel ogni 2 per non decodificare per
    // intero immagini grandi solo per un controllo euristico.
    if (y % 4 === 0) {
      for (let x = 0; x < width; x += 2) {
        const alpha = out[x * channels + (channels - 1)];
        totalSamples += 1;
        if (alpha < 10) transparentSamples += 1;
      }
    }
    prevRow = out;
  }
  if (totalSamples === 0) return false;
  return transparentSamples / totalSamples > 0.05;
}

async function fetchFigmaJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ha risposto ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export const Route = createFileRoute("/api/public/hooks/figma-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { link?: string };
          const link = body.link?.trim();
          if (!link) {
            return Response.json({ ok: false, error: "link è obbligatorio" }, { status: 400 });
          }
          const parsed = parseFigmaLink(link);
          if (!parsed) {
            return Response.json(
              {
                ok: false,
                error:
                  'Link Figma non valido: serve un link con "node-id" (in Figma, tasto destro sul frame o sulla sezione -> "Copy link to selection").',
              },
              { status: 400 },
            );
          }

          const token = process.env.FIGMA_ACCESS_TOKEN;
          if (!token) {
            return Response.json(
              { ok: false, error: "FIGMA_ACCESS_TOKEN non configurato nell'ambiente dell'app" },
              { status: 500 },
            );
          }

          const { fileKey, nodeId } = parsed;
          const nodesData = await fetchFigmaJson<{
            nodes: Record<string, { document: FigmaNode } | undefined>;
          }>(
            `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
            token,
          );
          const entry = nodesData.nodes[nodeId];
          if (!entry) {
            return Response.json(
              { ok: false, error: "Nodo non trovato in questo file Figma." },
              { status: 404 },
            );
          }
          const root = entry.document;
          if (!CONTAINER_TYPES.has(root.type)) {
            return Response.json(
              {
                ok: false,
                error: `Seleziona un frame (o una sezione/gruppo con più frame), non un singolo elemento. Nodo selezionato: ${root.type}.`,
              },
              { status: 400 },
            );
          }
          if (!root.absoluteBoundingBox) {
            return Response.json(
              { ok: false, error: "Il nodo selezionato non ha dimensioni valide." },
              { status: 400 },
            );
          }

          const frames = mapFigmaTreeToFrames(root);

          const pngIds = new Set<string>();
          const svgIds = new Set<string>();
          for (const frame of frames) {
            for (const el of frame.elements) {
              if (el.exportFormat === "png") pngIds.add(el.figmaNodeId);
              if (el.exportFormat === "svg") svgIds.add(el.figmaNodeId);
            }
          }

          const imageUrls: Record<string, string> = {};
          async function exportBatch(ids: Set<string>, format: "png" | "svg") {
            if (ids.size === 0) return;
            const idsParam = [...ids].map(encodeURIComponent).join(",");
            const imagesData = await fetchFigmaJson<{
              err: string | null;
              images: Record<string, string | null>;
            }>(
              // token è già stato validato non-null più sopra in questa
              // stessa richiesta; la chiusura di exportBatch non conserva
              // quel narrowing agli occhi di TypeScript.
              `https://api.figma.com/v1/images/${fileKey}?ids=${idsParam}&format=${format}`,
              token!,
            );
            if (imagesData.err) {
              throw new Error(`Export ${format} Figma fallito: ${imagesData.err}`);
            }
            for (const [id, url] of Object.entries(imagesData.images)) {
              if (url) imageUrls[id] = url;
            }
          }
          await exportBatch(pngIds, "png");
          await exportBatch(svgIds, "svg");

          // Rimozione sfondo automatica ricevuta da Figma: se la foto
          // placeholder di un campo immagine dinamico è già trasparente
          // (il designer l'ha già ritagliata), imposta da sé
          // autoRemoveBackground per quel campo — best-effort, un
          // fallimento di fetch/parsing non deve far fallire l'import.
          const autoRemoveBgIds = new Set<string>();
          await Promise.all(
            frames.flatMap((frame) =>
              frame.elements
                .filter((m) => m.tipo === "image" && m.exportFormat === "png" && m.layer_name)
                .map(async (m) => {
                  const url = imageUrls[m.figmaNodeId];
                  if (!url) return;
                  try {
                    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                    if (!res.ok) return;
                    const bytes = new Uint8Array(await res.arrayBuffer());
                    if (await pngHasSignificantTransparency(bytes)) {
                      autoRemoveBgIds.add(m.figmaNodeId);
                    }
                  } catch {
                    // best-effort, vedi commento sopra
                  }
                }),
            ),
          );

          const resultFrames = frames.map((frame) => ({
            name: frame.name,
            width: frame.width,
            height: frame.height,
            elements: frame.elements.map((m) => {
              const { figmaNodeId, exportFormat, ...rest } = m;
              if (exportFormat) {
                const url = imageUrls[figmaNodeId] ?? null;
                const autoRemoveBg = autoRemoveBgIds.has(figmaNodeId)
                  ? { autoRemoveBackground: true }
                  : {};
                // Un campo dinamico (layer_name impostato) mostra la foto
                // di Figma solo come ANTEPRIMA (previewSrc) in attesa della
                // foto vera scelta post per post nel wizard — mai come src
                // "fissa": ImageActions/materializeElements scrivono la
                // sostituzione in previewSrc/src rispettivamente, ma
                // ElementBox legge sempre src PER PRIMO se presente, quindi
                // un src piazzato qui da Figma resterebbe bloccato per
                // sempre sopra qualunque nuova foto caricata per quel campo
                // (bug segnalato dall'utente). Solo gli elementi fissi
                // (layer_name null, es. un'immagine "!logo") usano src.
                return {
                  ...rest,
                  style: rest.layer_name
                    ? { ...rest.style, previewSrc: url, ...autoRemoveBg }
                    : { ...rest.style, src: url },
                };
              }
              return rest;
            }),
          }));

          return Response.json({
            ok: true,
            frames: resultFrames,
            elementsCount: resultFrames.reduce((sum, f) => sum + f.elements.length, 0),
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
