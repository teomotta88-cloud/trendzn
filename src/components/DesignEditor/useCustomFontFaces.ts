import { useEffect } from "react";
import { getCustomFontPublicUrl, type CustomFont } from "@/lib/designElements";

function fontFormatFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "otf":
      return "opentype";
    default:
      return "truetype";
  }
}

const STYLE_TAG_ID = "design-editor-custom-fonts";

// Inietta un @font-face per ogni font custom caricato (Fase 3), così il
// browser li carica davvero: sia l'editor (a schermo) sia la cattura per
// l'export (src/lib/design-capture.ts, che legge i @font-face del documento
// per incorporarli nell'SVG) ne hanno bisogno, non solo il nome nel select.
export function useCustomFontFaces(fonts: CustomFont[]): void {
  useEffect(() => {
    if (fonts.length === 0) return;

    const css = fonts
      .map(
        (f) => `
@font-face {
  font-family: "${f.family_name}";
  font-weight: ${f.weight};
  font-style: ${f.style};
  src: url("${getCustomFontPublicUrl(f.storage_path)}") format("${fontFormatFromPath(f.storage_path)}");
  font-display: swap;
}`,
      )
      .join("\n");

    let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_TAG_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    return () => {
      styleEl?.remove();
    };
  }, [fonts]);
}
