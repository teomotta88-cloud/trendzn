import { createFileRoute } from "@tanstack/react-router";

// Import di un frame Figma nell'editor grafico interno: usa la REST API
// pubblica di Figma (non lo scraping fatto per Getty, qui esiste
// un'API ufficiale) per leggere l'albero di nodi di un frame e mapparlo su
// template_elements. Richiede un Personal Access Token Figma (qualunque
// piano, anche gratuito, basta avere accesso in visualizzazione al file)
// configurato come FIGMA_ACCESS_TOKEN nell'ambiente dell'app — stesso
// pattern di OPENROUTER_API_KEY/GITHUB_TOKEN altrove in questo progetto.
//
// Cosa NON fa (limiti noti, documentati invece di finti al 100%):
// - I gruppi/frame annidati vengono attraversati ma non riprodotti come
//   gruppi nel nostro editor (serve un secondo passaggio manuale con
//   "Raggruppa" se si vuole lo stesso raggruppamento).
// - Vettori complessi, icone, componenti/istanze non mappano su un tipo
//   nostro (testo/immagine/icona lucide/forma): vengono esportati come PNG
//   piatto ed entrano come elemento "image" fisso, non editabile a livello
//   di singolo tratto.
// - La rotazione è convertita da radianti (Figma) a gradi CSS assumendo la
//   convenzione standard di Figma (radianti antiorari) — non verificato
//   contro un file reale in questo ambiente, ricontrollare gli elementi
//   ruotati dopo l'import.
// - I livelli con nome che inizia per "#" (es. "#title1", "#image1")
//   diventano automaticamente campi dinamici (layer_name) — stessa
//   convenzione già in uso in tutto il progetto per i campi del wizard.

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
  needsImageExport: boolean;
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

function layerNameFromFigmaName(name: string): string | null {
  return name.startsWith("#") ? name : null;
}

const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION"]);

// Attraversamento in profondità: i contenitori (frame/gruppo annidati) non
// diventano un elemento, si scende nei figli; i nodi "foglia" diventano un
// singolo template_element. z_index segue l'ordine dei figli in Figma
// (dal basso verso l'alto, stessa convenzione dei nostri z_index).
function flatten(
  node: FigmaNode,
  originX: number,
  originY: number,
  zCounter: { value: number },
  out: MappedElement[],
): void {
  if (node.visible === false) return;

  if (CONTAINER_TYPES.has(node.type) && node.children && node.children.length > 0) {
    for (const child of node.children) flatten(child, originX, originY, zCounter, out);
    return;
  }

  const box = node.absoluteBoundingBox;
  if (!box) return;

  const layerName = layerNameFromFigmaName(node.name);
  const rotationDeg = node.rotation ? Math.round((-node.rotation * 180) / Math.PI) : 0;
  const base = {
    figmaNodeId: node.id,
    layer_name: layerName,
    x: box.x - originX,
    y: box.y - originY,
    width: box.width,
    height: box.height,
    rotation: rotationDeg,
    z_index: zCounter.value++,
  };
  const shadowStyle = shadowStyleFromEffects(node.effects);

  if (node.type === "TEXT") {
    out.push({
      ...base,
      tipo: "text",
      needsImageExport: false,
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
      out.push({
        ...base,
        tipo: "image",
        needsImageExport: true,
        style: { objectFit: "cover", borderRadius: node.cornerRadius ?? 0, ...shadowStyle },
      });
      return;
    }
    const solidFill = node.fills?.find((f) => f.type === "SOLID" && f.visible !== false);
    out.push({
      ...base,
      tipo: "shape",
      needsImageExport: false,
      style: {
        fill: solidFill?.color ? colorToHex(solidFill.color) : "transparent",
        borderRadius: node.type === "ELLIPSE" ? 9999 : (node.cornerRadius ?? 0),
        ...shadowStyle,
      },
    });
    return;
  }

  // Fallback per tutto il resto (vettori, icone, componenti/istanze, forme
  // complesse): esportato come PNG piatto, non editabile a livello di
  // singolo tratto — vedi limiti noti in cima al file.
  out.push({
    ...base,
    tipo: "image",
    needsImageExport: true,
    style: { objectFit: "contain", ...shadowStyle },
  });
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
                  'Link Figma non valido: serve un link con "node-id" (in Figma, tasto destro sul frame -> "Copy link to selection").',
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
                error: `Seleziona un frame (o gruppo), non un singolo elemento. Nodo selezionato: ${root.type}.`,
              },
              { status: 400 },
            );
          }
          const rootBox = root.absoluteBoundingBox;
          if (!rootBox) {
            return Response.json(
              { ok: false, error: "Il frame selezionato non ha dimensioni valide." },
              { status: 400 },
            );
          }

          const mapped: MappedElement[] = [];
          const zCounter = { value: 0 };
          for (const child of root.children ?? []) {
            flatten(child, rootBox.x, rootBox.y, zCounter, mapped);
          }

          const toExport = mapped.filter((m) => m.needsImageExport).map((m) => m.figmaNodeId);
          const imageUrls: Record<string, string> = {};
          if (toExport.length > 0) {
            const imagesData = await fetchFigmaJson<{
              err: string | null;
              images: Record<string, string | null>;
            }>(
              `https://api.figma.com/v1/images/${fileKey}?ids=${toExport.map(encodeURIComponent).join(",")}&format=png`,
              token,
            );
            if (imagesData.err) {
              return Response.json(
                { ok: false, error: `Export immagini Figma fallito: ${imagesData.err}` },
                { status: 502 },
              );
            }
            for (const [id, url] of Object.entries(imagesData.images)) {
              if (url) imageUrls[id] = url;
            }
          }

          const elements = mapped.map((m) => {
            const { figmaNodeId, needsImageExport, ...rest } = m;
            if (needsImageExport) {
              return { ...rest, style: { ...rest.style, src: imageUrls[figmaNodeId] ?? null } };
            }
            return rest;
          });

          return Response.json({
            ok: true,
            width: Math.round(rootBox.width),
            height: Math.round(rootBox.height),
            elementsCount: elements.length,
            elements,
          });
        } catch (err) {
          return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
        }
      },
    },
  },
});
