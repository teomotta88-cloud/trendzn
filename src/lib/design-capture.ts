import { toBlob } from "html-to-image";

// Motore di rendering dell'editor grafico interno (sostituisce il tentativo
// server-side con satori + resvg-wasm: bloccato su Cloudflare Workers,
// "Wasm code generation disallowed by embedder" verificato con `wrangler dev`
// reale, e il fallback a import statici produceva un bundle di deploy
// corrotto con l'attuale setup Vite/Nitro — vedi la discussione che ha
// portato a questo pivot).
//
// Qui si cattura direttamente il DOM che l'editor sta già mostrando (via
// html-to-image: serializza il nodo in un'immagine SVG con <foreignObject>,
// la disegna su un <canvas>, esporta PNG) invece di ricostruire il layout in
// un motore server separato. Vantaggi: (1) zero WASM, gira in qualunque
// browser, nessun problema di bundling Cloudflare; (2) fedeltà garantita per
// costruzione — quello che l'utente vede nell'editor è esattamente il nodo
// catturato, non una reimplementazione parallela del layout che potrebbe
// disallinearsi.
//
// Limite noto: le immagini remote (Getty, Supabase Storage) devono servire
// header CORS corretti perché il canvas non risulti "tainted" — vedi
// crossOrigin="anonymous" sugli <img> in ElementBox.tsx.
//
// imagePlaceholder è OBBLIGATORIO, non opzionale: se un'immagine fallisce il
// fetch (CORS, rete, 404, ...) e non c'è un placeholder valido, html-to-image
// assegna `src=""` all'elemento <img> clonato per generare l'export — in
// Chromium questo non genera mai né `load` né `error`, quindi la Promise
// interna resta appesa per sempre e la cattura si blocca a tempo
// indeterminato invece di fallire con un errore leggibile (verificato con un
// browser reale, non solo in teoria: senza questo placeholder l'intera UI
// resta bloccata sullo spinner "Genera anteprima" senza mai risolversi).
// Colore #e2e8f0 (grigio chiaro), stesso del placeholder mostrato in
// ElementBox.tsx quando un campo immagine non ha ancora un valore — un
// fallback trasparente qui apparirebbe come un riquadro nero pieno invece
// che come sfondo neutro (verificato: il compositing canvas non preserva la
// trasparenza in questo punto della pipeline di html-to-image).
const IMAGE_LOAD_FAILED_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN49OIDAAVqAru/zcVKAAAAAElFTkSuQmCC";

// Rete/CDN che non falliscono mai in modo pulito (timeout silenzioso invece
// di un errore) restano comunque possibili anche con imagePlaceholder: questo
// limite converte un'attesa indefinita in un errore esplicito dopo un tempo
// ragionevole, invece di uno spinner bloccato per sempre. In bulk (Fase 5),
// dove si chiama questa funzione una volta per job, evita anche che un solo
// asset lento blocchi l'intero export.
const CAPTURE_TIMEOUT_MS = 20_000;

export async function captureNodeToPngBlob(node: HTMLElement, pixelRatio: number): Promise<Blob> {
  const capture = toBlob(node, {
    pixelRatio,
    cacheBust: true,
    imagePlaceholder: IMAGE_LOAD_FAILED_PLACEHOLDER,
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Cattura del design scaduta (asset troppo lento a rispondere)")),
      CAPTURE_TIMEOUT_MS,
    );
  });
  const blob = await Promise.race([capture, timeout]);
  if (!blob) throw new Error("Cattura del design fallita (nodo vuoto o non renderizzabile)");
  return blob;
}
