import type { TemplateElement } from "@/lib/designElements";

// Wizard di composizione post (Fase 9): "materializza" un frame del
// template sostituendo il segnaposto (layer_name) con il valore reale
// inserito dal social media manager. ElementBox mostra sempre layer_name
// quando è impostato (vedi ElementBox.tsx) — per far apparire il valore
// vero bisogna quindi azzerare layer_name sulla copia e scrivere il valore
// nello style (text per il testo, src per l'immagine). Finché il campo è
// vuoto si lascia l'elemento invariato, così continua a mostrare il nome
// del layer come guida.
export function materializeElements(
  elements: TemplateElement[],
  values: Record<string, string>,
): TemplateElement[] {
  return elements.map((el) => {
    if (!el.layer_name) return el;
    const value = values[el.layer_name];
    if (!value) return el;
    if (el.tipo === "text") {
      return { ...el, layer_name: null, style: { ...el.style, text: value } };
    }
    if (el.tipo === "image") {
      return { ...el, layer_name: null, style: { ...el.style, src: value } };
    }
    return el;
  });
}
