import { useEffect } from "react";
import { GOOGLE_FONTS_STYLESHEET_URL } from "./constants";

// Il wizard (Fase 9) vive dentro Piano Editoriale, una route che non carica
// già lo stylesheet dei font curati (lo fa solo /editor-grafico/$rubricaId
// tramite head()). Serve comunque qui per un'anteprima testuale fedele:
// iniettiamo il <link> a mano, idempotente (un solo tag condiviso, mai
// rimosso al cambio di componente — un font in più caricato non fa danno,
// mentre rimuoverlo mentre un altro editor è ancora montato romperebbe la
// sua anteprima).
const LINK_ID = "design-editor-google-fonts";

export function useGoogleFontsLink(): void {
  useEffect(() => {
    if (document.getElementById(LINK_ID)) return;
    const link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_STYLESHEET_URL;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }, []);
}
