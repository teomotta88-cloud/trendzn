import * as ort from "onnxruntime-web/wasm";

// Rimozione sfondo automatica (Fase 4), tutta lato client — nessuna chiamata
// server, nessun costo per immagine. Motore: U2NETP (variante "portable" di
// U^2-Net, Qin et al., https://github.com/xuebinqin/U-2-Net, licenza
// Apache-2.0) via onnxruntime-web (MIT). Il file .onnx (public/models/
// u2netp.onnx) è lo stesso export ufficiale ridistribuito dal progetto
// rembg (MIT, https://github.com/danielgatis/rembg) — scelto al posto di
// @imgly/background-removal perché quest'ultimo è licenziato AGPL-3.0,
// incompatibile con un uso in un prodotto proprietario senza licenza
// commerciale IMG.LY.
//
// Pre/post-processing replicano esattamente rembg/rembg/sessions/{base,u2net}.py
// (normalizzazione per max pixel, non fissa a 255; media/std ImageNet), così
// il risultato è fedele all'originale Python anche se qui reimplementato in
// JS puro con canvas invece di PIL/numpy.

ort.env.wasm.wasmPaths = "/ort/";
// Il .wasm copiato in public/ort/ è la build "threaded": forziamo un solo
// thread per evitare di dover configurare gli header COOP/COEP
// (cross-origin isolation) necessari per SharedArrayBuffer solo per questa
// feature — gira comunque, solo un po' più lento su immagini grandi.
ort.env.wasm.numThreads = 1;

const MODEL_URL = "/models/u2netp.onnx";
const MODEL_INPUT_NAME = "input.1";
const MODEL_OUTPUT_NAME = "1959";
const MODEL_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
  }
  return sessionPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Impossibile caricare l'immagine (CORS o URL non valido)"));
    img.src = src;
  });
}

// Ridimensiona a 320x320 (resize diretto, non preserva le proporzioni: stessa
// scelta di rembg) e normalizza in tensore CHW float32.
function preprocess(img: HTMLImageElement): ort.Tensor {
  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(img, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const { data } = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);

  // rembg normalizza per il massimo pixel effettivo dell'immagine, non per
  // una costante 255 fissa (im_ary / max(np.max(im_ary), 1e-6) in base.py).
  let max = 1e-6;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > max) max = data[i];
    if (data[i + 1] > max) max = data[i + 1];
    if (data[i + 2] > max) max = data[i + 2];
  }

  const plane = MODEL_SIZE * MODEL_SIZE;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    const o = p * 4;
    chw[p] = (data[o] / max - MEAN[0]) / STD[0];
    chw[plane + p] = (data[o + 1] / max - MEAN[1]) / STD[1];
    chw[plane * 2 + p] = (data[o + 2] / max - MEAN[2]) / STD[2];
  }

  return new ort.Tensor("float32", chw, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

// Normalizza la maschera min-max (stessa formula di rembg: (pred-min)/(max-min),
// clip 0-1) e la disegna come canvas in scala di grigi 320x320.
function maskToCanvas(maskData: Float32Array): HTMLCanvasElement {
  let min = Infinity;
  let max = -Infinity;
  for (const v of maskData) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1e-6;

  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  const imageData = ctx.createImageData(MODEL_SIZE, MODEL_SIZE);
  for (let p = 0; p < maskData.length; p++) {
    const gray = Math.round(Math.min(1, Math.max(0, (maskData[p] - min) / range)) * 255);
    imageData.data[p * 4] = gray;
    imageData.data[p * 4 + 1] = gray;
    imageData.data[p * 4 + 2] = gray;
    imageData.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Rimuove lo sfondo di un'immagine (URL) e ritorna un PNG con canale alpha.
// L'URL deve servire header CORS corretti (Supabase Storage pubblico li
// manda già; per Getty o altre fonti andrà verificato caso per caso).
export async function removeBackground(src: string): Promise<Blob> {
  const img = await loadImage(src);
  const inputTensor = preprocess(img);

  const session = await getSession();
  const outputs = await session.run({ [MODEL_INPUT_NAME]: inputTensor });
  const maskTensor = outputs[MODEL_OUTPUT_NAME];
  if (!maskTensor) throw new Error("Output del modello mancante");

  const maskCanvas = maskToCanvas(maskTensor.data as Float32Array);

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const resizedMaskCanvas = document.createElement("canvas");
  resizedMaskCanvas.width = width;
  resizedMaskCanvas.height = height;
  const resizedMaskCtx = resizedMaskCanvas.getContext("2d");
  if (!resizedMaskCtx) throw new Error("Canvas 2D non disponibile");
  resizedMaskCtx.drawImage(maskCanvas, 0, 0, width, height);
  const maskPixels = resizedMaskCtx.getImageData(0, 0, width, height).data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas 2D non disponibile");
  outCtx.drawImage(img, 0, 0, width, height);
  const outImageData = outCtx.getImageData(0, 0, width, height);
  for (let p = 0; p < width * height; p++) {
    outImageData.data[p * 4 + 3] = maskPixels[p * 4];
  }
  outCtx.putImageData(outImageData, 0, 0);

  return new Promise((resolve, reject) => {
    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Esportazione PNG fallita"));
    }, "image/png");
  });
}
