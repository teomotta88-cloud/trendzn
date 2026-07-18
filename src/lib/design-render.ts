import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import * as LucideIcons from "lucide-react";

// Motore di rendering dell'editor grafico interno: converte un design
// (albero di template_elements + valori risolti di un job) in un PNG finale,
// senza dipendere da Figma/Canva (vedi docs/sbam-autographics-canva.md per il
// percorso precedente). Deve girare su Cloudflare Workers (ambiente di
// deploy di produzione), quindi niente `sharp`/`node-canvas` (binari nativi):
// satori converte l'albero in SVG (puro JS + yoga-layout, che imbarca il suo
// wasm come base64 e non necessita di init manuale), @resvg/resvg-wasm
// rasterizza l'SVG in PNG.
//
// Il suo .wasm va invece inizializzato esplicitamente: non viene bundlato in
// modo affidabile da Vite/Nitro in questo progetto (stesso problema già
// documentato per @jsquash/* in export-feed-pptx.ts) — lo scarichiamo dalla
// CDN npm a runtime, stessa convenzione.
const RESVG_WASM_VERSION = "2.6.2";

async function fetchWasmModule(cdnPath: string): Promise<WebAssembly.Module> {
  const res = await fetch(`https://cdn.jsdelivr.net/npm/${cdnPath}`);
  if (!res.ok) throw new Error(`wasm_fetch_failed_${res.status}: ${cdnPath}`);
  const bytes = await res.arrayBuffer();
  return WebAssembly.compile(bytes);
}

// Init memoizzato: una sola fetch+compile per istanza del Worker.
let resvgReady: Promise<void> | null = null;
function ensureResvgReady(): Promise<void> {
  if (!resvgReady) {
    resvgReady = fetchWasmModule(`@resvg/resvg-wasm@${RESVG_WASM_VERSION}/index_bg.wasm`).then(
      (module) => initWasm(module),
    );
  }
  return resvgReady;
}

export type ElementTipo = "text" | "image" | "icon" | "shape";

// Rispecchia una riga di public.template_elements (vedi migration
// 20260718200000_inhouse_editor_templates.sql).
export interface DesignElement {
  layer_name: string | null;
  tipo: ElementTipo;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  style: Record<string, unknown>;
}

export interface DesignFont {
  name: string;
  data: ArrayBuffer;
  weight?: number;
  style?: "normal" | "italic";
}

export interface RenderDesignInput {
  width: number;
  height: number;
  elements: DesignElement[];
  // layer_name -> testo (elementi text) o URL immagine (elementi image),
  // stessa risoluzione già prodotta da listExportableJobs in autographics.ts.
  values: Record<string, string>;
  fonts: DesignFont[];
  backgroundColor?: string;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Renderizza un'icona lucide-react a markup SVG statico (nessun DOM
// necessario, funziona lato server) e la incapsula come data URI: satori
// supporta i nodi <img> con src data URI senza bisogno di alcun fetch.
function iconToDataUri(iconName: string, color: string, strokeWidth: number): string | null {
  const IconComponent = (LucideIcons as Record<string, unknown>)[iconName];
  if (typeof IconComponent !== "function" && typeof IconComponent !== "object") return null;

  const markup = renderToStaticMarkup(
    createElement(IconComponent as never, { color, strokeWidth, size: 24 }),
  );
  const base64 = Buffer.from(markup, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

// Costruisce l'albero "React-like" richiesto da satori (element.type/props,
// non serve renderizzare react vero: satori accetta qualunque oggetto con
// questa forma). Un div assoluto per elemento, ordinati per z_index.
function buildTree(input: RenderDesignInput) {
  const sorted = [...input.elements].sort((a, b) => a.z_index - b.z_index);

  const children = sorted.map((el) => {
    const boxStyle: Record<string, unknown> = {
      position: "absolute",
      left: el.x,
      top: el.y,
      width: el.width,
      height: el.height,
      display: "flex",
    };
    // satori tratta la sola presenza della chiave "transform" come CSS da
    // validare, anche se il valore è undefined: va aggiunta solo quando
    // serve davvero, non impostata a undefined.
    if (el.rotation) {
      boxStyle.transform = `rotate(${el.rotation}deg)`;
    }

    if (el.tipo === "text") {
      const value = el.layer_name ? (input.values[el.layer_name] ?? "") : str(el.style.text);
      return {
        type: "div",
        props: {
          style: {
            ...boxStyle,
            fontFamily: str(el.style.fontFamily, "Inter"),
            fontSize: num(el.style.fontSize, 24),
            fontWeight: num(el.style.fontWeight, 400),
            color: str(el.style.color, "#000000"),
            lineHeight: num(el.style.lineHeight, 1.2),
            justifyContent:
              el.style.align === "center"
                ? "center"
                : el.style.align === "right"
                  ? "flex-end"
                  : "flex-start",
            textAlign: str(el.style.align, "left"),
            whiteSpace: "pre-wrap",
          },
          children: value,
        },
      };
    }

    if (el.tipo === "image") {
      const src = el.layer_name ? input.values[el.layer_name] : undefined;
      if (!src) return null;
      return {
        type: "img",
        props: {
          src,
          width: el.width,
          height: el.height,
          style: {
            ...boxStyle,
            objectFit: str(el.style.objectFit, "cover"),
            borderRadius: num(el.style.borderRadius, 0),
          },
        },
      };
    }

    if (el.tipo === "icon") {
      const dataUri = iconToDataUri(
        str(el.style.name, "Circle"),
        str(el.style.color, "#000000"),
        num(el.style.strokeWidth, 2),
      );
      if (!dataUri) return null;
      return {
        type: "img",
        props: { src: dataUri, width: el.width, height: el.height, style: boxStyle },
      };
    }

    // shape
    return {
      type: "div",
      props: {
        style: {
          ...boxStyle,
          backgroundColor: str(el.style.fill, "#cccccc"),
          borderRadius: num(el.style.borderRadius, 0),
        },
      },
    };
  });

  return {
    type: "div",
    props: {
      style: {
        width: input.width,
        height: input.height,
        display: "flex",
        position: "relative",
        backgroundColor: input.backgroundColor ?? "#ffffff",
        overflow: "hidden",
      },
      children: children.filter(Boolean),
    },
  };
}

// Scarica un font da Google Fonts a runtime (stesso approccio usato dai
// generatori di OG image su edge runtime): niente font da auto-hostare per i
// test, il set curato "vero" (Fase 3) potrà comunque restare self-hostato in
// public/fonts per non dipendere da Google in produzione.
const googleFontCache = new Map<string, Promise<ArrayBuffer>>();

export async function fetchGoogleFontBytes(family: string, weight = 400): Promise<ArrayBuffer> {
  const cacheKey = `${family}:${weight}`;
  const cached = googleFontCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    // Niente User-Agent "browser moderno": satori/opentype.js non sa
    // decodificare woff2 (richiede il brotli decoder che non ha), solo
    // ttf/otf/woff. Senza uno User-Agent che dichiari supporto woff2, Google
    // Fonts serve direttamente un url .ttf nel css — non serve nessuna
    // conversione manuale.
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) throw new Error(`google_fonts_css_failed_${cssRes.status}: ${family}`);
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('truetype'\)/);
    if (!match) throw new Error(`google_fonts_no_ttf_url: ${family}`);
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) throw new Error(`google_fonts_file_failed_${fontRes.status}: ${family}`);
    return fontRes.arrayBuffer();
  })();

  googleFontCache.set(cacheKey, promise);
  return promise;
}

export async function renderDesignToPng(input: RenderDesignInput): Promise<Uint8Array> {
  const svg = await satori(buildTree(input) as never, {
    width: input.width,
    height: input.height,
    fonts: input.fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: (f.weight ?? 400) as never,
      style: f.style ?? "normal",
    })),
  });

  await ensureResvgReady();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: input.width } });
  const rendered = resvg.render();
  return rendered.asPng();
}
