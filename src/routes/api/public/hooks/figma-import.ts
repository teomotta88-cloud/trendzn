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
// Cosa NON fa (limiti noti, documentati invece di finti al 100%):
// - I gruppi/frame annidati (nel caso single-frame) vengono attraversati ma
//   non riprodotti come gruppi nel nostro editor (serve un secondo passaggio
//   manuale con "Raggruppa" se si vuole lo stesso raggruppamento).
// - "Icona" vs "vettore" è una distinzione euristica: COMPONENT/INSTANCE
//   (spesso simboli icona in un design system) diventano "icon", il resto
//   dei nodi vettoriali (VECTOR/STAR/LINE/BOOLEAN_OPERATION/...) diventa
//   "vector" — in entrambi i casi il nostro editor non ha un tipo elemento
//   "vettore" nativo (path editabili), quindi vengono importati come
//   elemento immagine con un export SVG (nitido a qualunque dimensione,
//   diversamente da un PNG appiattito) e style.isVector = true.
// - La rotazione è convertita da radianti (Figma) a gradi CSS assumendo la
//   convenzione standard di Figma (radianti antiorari) — non verificato
//   contro un file reale in questo ambiente, ricontrollare gli elementi
//   ruotati dopo l'import.
// - Il controllo font (fatto lato client in FigmaImportPanel, che conosce i
//   font disponibili in trendzn) confronta solo il nome della famiglia,
//   non lo specifico peso/stile.

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
  cornerRadius?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: string;
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
const ICON_LIKE_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);
const VECTOR_LIKE_TYPES = new Set([
  "VECTOR",
  "STAR",
  "LINE",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
]);

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

  if (CONTAINER_TYPES.has(node.type) && node.children && node.children.length > 0) {
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

  if (node.type === "TEXT") {
    const layerName = explicit ? explicit.forced : nextAutoName(nameCounters, "title");
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
        color: node.fills?.find((f) => f.type === "SOLID" && f.visible !== false)?.color
          ? colorToHex(node.fills.find((f) => f.type === "SOLID")!.color!)
          : "#000000",
        align: (node.style?.textAlignHorizontal ?? "LEFT").toLowerCase(),
        ...shadowStyle,
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
        style: { objectFit: "cover", borderRadius: node.cornerRadius ?? 0, ...shadowStyle },
      });
      return;
    }
    // Forma piena (rettangolo/ellisse senza immagine): sempre fissa, mai
    // un campo dinamico, indipendentemente da "#"/"!" nel nome.
    const solidFill = node.fills?.find((f) => f.type === "SOLID" && f.visible !== false);
    out.push({
      ...base,
      layer_name: null,
      tipo: "shape",
      exportFormat: null,
      style: {
        fill: solidFill?.color ? colorToHex(solidFill.color) : "transparent",
        borderRadius: node.type === "ELLIPSE" ? 9999 : (node.cornerRadius ?? 0),
        ...shadowStyle,
      },
    });
    return;
  }

  // Icone (component/instance, tipicamente simboli di un design system) e
  // vettori generici (path, stelle, linee, booleani): esportati come SVG
  // (nitido a qualunque dimensione) invece che PNG appiattito. Il nostro
  // editor non ha un tipo "vettore" nativo: entrano come "image" con
  // style.isVector = true.
  const bucket: NamingBucket = ICON_LIKE_TYPES.has(node.type) ? "icon" : "vector";
  const layerName = explicit ? explicit.forced : nextAutoName(nameCounters, bucket);
  out.push({
    ...base,
    layer_name: layerName,
    tipo: "image",
    exportFormat: "svg",
    style: { objectFit: "contain", isVector: true, ...shadowStyle },
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

          const resultFrames = frames.map((frame) => ({
            name: frame.name,
            width: frame.width,
            height: frame.height,
            elements: frame.elements.map((m) => {
              const { figmaNodeId, exportFormat, ...rest } = m;
              if (exportFormat) {
                return { ...rest, style: { ...rest.style, src: imageUrls[figmaNodeId] ?? null } };
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
