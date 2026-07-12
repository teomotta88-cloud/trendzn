import type {
  CodeToUiMessage,
  Credentials,
  GraphicJobFormat,
  JobBundle,
  TemplateConstraint,
  UiToCodeMessage,
} from "./types";

// SBAM AutoGraphics — thread sandbox del plugin. Non ha accesso alla rete
// (per scelta architetturale: tutte le fetch — Supabase REST/Storage,
// download immagini Getty — passano dalla UI, vedi ui.ts). Qui si opera
// solo sul documento Figma: clonare i template, popolare i layer `#`,
// applicare il fit-to-box anti-overflow, esportare i PNG.

const OUTPUT_PAGE_NAME = "🤖 AutoGraphics Output";
const CLIENT_STORAGE_KEY = "sbam-autographics-credentials";

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

function postToUi(message: CodeToUiMessage): void {
  figma.ui.postMessage(message);
}

function log(level: "info" | "warn" | "error", message: string): void {
  postToUi({ type: "log", level, message });
}

// --- Credenziali (persistite in figma.clientStorage, mai nel codice) -------

async function loadCredentials(): Promise<Credentials | null> {
  const stored = await figma.clientStorage.getAsync(CLIENT_STORAGE_KEY);
  return (stored as Credentials | undefined) ?? null;
}

async function saveCredentials(credentials: Credentials): Promise<void> {
  await figma.clientStorage.setAsync(CLIENT_STORAGE_KEY, credentials);
}

// --- Richiesta immagine alla UI (unico canale con accesso alla rete) -------

let imageRequestCounter = 0;
const pendingImageRequests = new Map<
  string,
  { resolve: (bytes: Uint8Array | null) => void }
>();

function requestImageBytes(url: string): Promise<Uint8Array | null> {
  const requestId = `img-${++imageRequestCounter}`;
  return new Promise((resolve) => {
    pendingImageRequests.set(requestId, { resolve });
    postToUi({ type: "need-image", requestId, url });
  });
}

// --- Pagina di lavoro dedicata -----------------------------------------

async function getOrCreateOutputPage(): Promise<PageNode> {
  await figma.loadAllPagesAsync();
  const existing = figma.root.children.find((p) => p.name === OUTPUT_PAGE_NAME);
  if (existing) return existing as PageNode;
  const page = figma.createPage();
  page.name = OUTPUT_PAGE_NAME;
  return page;
}

// --- Clonazione del template ------------------------------------------

async function instantiateTemplate(componentId: string): Promise<InstanceNode | FrameNode | null> {
  const node = await figma.getNodeByIdAsync(componentId);
  if (!node) return null;
  if (node.type === "COMPONENT") {
    return (node as ComponentNode).createInstance();
  }
  if (node.type === "FRAME" || node.type === "COMPONENT_SET") {
    const clonable = node as FrameNode;
    if (typeof clonable.clone === "function") {
      const clone = clonable.clone();
      return clone as FrameNode;
    }
  }
  return null;
}

// --- Layer dinamici (#prefisso) -----------------------------------------

// Solo i layer con nome che inizia per "#" sono considerati dinamici: tutto
// il resto del template (logo, sfondi, elementi fissi) non va mai toccato.
function findDynamicLayers(root: SceneNode): SceneNode[] {
  if (!("findAll" in root)) return root.name.startsWith("#") ? [root] : [];
  const found = (root as FrameNode).findAll((n) => n.name.startsWith("#"));
  return root.name.startsWith("#") ? [root, ...found] : found;
}

function hasFills(node: SceneNode): node is SceneNode & { fills: readonly Paint[] | typeof figma.mixed } {
  return "fills" in node;
}

async function loadFontsForTextNode(node: TextNode): Promise<void> {
  const len = node.characters.length;
  const fonts = new Set<string>();
  const fontNames: FontName[] = [];
  for (let i = 0; i < len; i++) {
    const font = node.getRangeFontName(i, i + 1);
    if (font === figma.mixed) continue;
    const key = `${font.family}::${font.style}`;
    if (!fonts.has(key)) {
      fonts.add(key);
      fontNames.push(font);
    }
  }
  if (fontNames.length === 0) {
    fontNames.push(node.fontName as FontName);
  }
  await Promise.all(fontNames.map((f) => figma.loadFontAsync(f)));
}

// Stima approssimativa del numero di righe renderizzate: non esiste un'API
// diretta in Figma, quindi la deduciamo dall'altezza risultante con
// textAutoResize = "HEIGHT" divisa per l'interlinea effettiva.
function estimateLineCount(node: TextNode): number {
  const lineHeight = node.lineHeight;
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 16;
  const lineHeightPx =
    typeof lineHeight === "object" && lineHeight.unit === "PIXELS" ? lineHeight.value : fontSize * 1.25;
  return Math.max(1, Math.round(node.height / lineHeightPx));
}

interface FitResult {
  ok: boolean;
  fontSize: number;
  excessChars: number;
}

// Fit-to-box iterativo: parte da max_font_size, riduce di 1pt alla volta
// finché il testo (misurato su un clone temporaneo con textAutoResize =
// "HEIGHT" alla stessa larghezza) non entra nel box originale, rispettando
// anche max_lines. Se a min_font_size ancora non ci sta, NON tronca e NON
// deforma: segnala l'overflow al chiamante.
async function fitTextToBox(node: TextNode, constraint: TemplateConstraint): Promise<FitResult> {
  const originalHeight = node.height;
  const originalWidth = node.width;
  const maxFontSize = constraint.max_font_size ?? (typeof node.fontSize === "number" ? node.fontSize : 24);
  const minFontSize = constraint.min_font_size ?? maxFontSize;

  node.textAutoResize = "NONE";

  let fontSize = maxFontSize;
  let lastMeasuredHeight = originalHeight;
  while (fontSize >= minFontSize) {
    const clone = node.clone();
    clone.visible = false;
    try {
      await loadFontsForTextNode(clone);
      clone.resize(originalWidth, clone.height);
      clone.textAutoResize = "HEIGHT";
      clone.fontSize = fontSize;
      lastMeasuredHeight = clone.height;
      const lines = estimateLineCount(clone);
      const linesOk = constraint.max_lines == null || lines <= constraint.max_lines;
      if (lastMeasuredHeight <= originalHeight && linesOk) {
        node.fontSize = fontSize;
        node.resize(originalWidth, originalHeight);
        return { ok: true, fontSize, excessChars: 0 };
      }
    } finally {
      clone.remove();
    }
    fontSize -= 1;
  }

  // Overflow anche al font minimo: stima l'eccesso di caratteri in
  // proporzione all'altezza in eccesso, solo per dare un numero utile al
  // copywriter nel messaggio di errore (non è una misura esatta).
  node.fontSize = minFontSize;
  node.resize(originalWidth, originalHeight);
  const overflowRatio = lastMeasuredHeight / originalHeight;
  const excessChars = Math.max(1, Math.round(node.characters.length * (overflowRatio - 1)));
  return { ok: false, fontSize: minFontSize, excessChars };
}

async function applyImageFill(node: SceneNode, bytes: Uint8Array): Promise<void> {
  if (!hasFills(node)) return;
  const image = figma.createImage(bytes);
  const fill: ImagePaint = { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" };
  (node as GeometryMixin).fills = [fill];
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

interface PopulateResult {
  errors: string[];
}

// Risolve il valore di un layer dinamico. I layer #photo* prendono di
// default la foto Getty selezionata (salvata su graphic_jobs.getty_image_url,
// non in copy_payload); un eventuale valore esplicito in copy_payload ha
// comunque la precedenza, così si può forzare un'immagine diversa. Tutti gli
// altri layer leggono solo da copy_payload.
function resolveLayerValue(job: JobBundle, layerName: string): string | undefined {
  const fromPayload = job.copy_payload[layerName];
  if (fromPayload && fromPayload.trim()) return fromPayload;
  if (layerName.startsWith("#photo") && job.getty_image_url) return job.getty_image_url;
  return fromPayload;
}

async function populateDynamicLayers(
  instance: InstanceNode | FrameNode,
  job: JobBundle,
): Promise<PopulateResult> {
  const errors: string[] = [];
  const layers = findDynamicLayers(instance);

  for (const layer of layers) {
    const layerName = layer.name;
    const value = resolveLayerValue(job, layerName);
    const constraint = job.constraints.find((c) => c.layer_name === layerName);

    if (value == null || !value.trim()) {
      if (constraint?.obbligatorio) {
        errors.push(`${layerName} è obbligatorio ma manca nel copy_payload`);
      }
      continue;
    }

    if (layer.type === "TEXT") {
      const textNode = layer as TextNode;
      if (constraint?.max_chars != null && value.length > constraint.max_chars) {
        errors.push(
          `${layerName} supera il limite di ${constraint.max_chars} caratteri (attuali: ${value.length})`,
        );
        continue;
      }
      await loadFontsForTextNode(textNode);
      textNode.characters = value;
      if (constraint && (constraint.max_font_size != null || constraint.min_font_size != null)) {
        const fit = await fitTextToBox(textNode, constraint);
        if (!fit.ok) {
          errors.push(
            `copy troppo lungo per il layer ${layerName} (eccesso stimato: ${fit.excessChars} caratteri)`,
          );
        }
      }
      continue;
    }

    if (isUrl(value)) {
      const bytes = await requestImageBytes(value);
      if (!bytes) {
        errors.push(`impossibile scaricare l'immagine per ${layerName} (${value})`);
        continue;
      }
      await applyImageFill(layer, bytes);
      continue;
    }

    log("warn", `Layer ${layerName}: valore non gestito (né testo né URL immagine), ignorato`);
  }

  return { errors };
}

// --- Elaborazione di un singolo job -------------------------------------

async function processFormat(
  job: JobBundle,
  format: GraphicJobFormat,
  outputPage: PageNode,
): Promise<void> {
  const componentId = format.figma_component_id ?? job.rubrica.figma_component_id;
  const instance = await instantiateTemplate(componentId);
  if (!instance) {
    postToUi({
      type: "job-format-error",
      jobId: job.id,
      formatId: format.id,
      detail: `Component Figma non trovato (id: ${componentId})`,
    });
    return;
  }

  outputPage.appendChild(instance);
  instance.name = `${job.post_id}__${format.formato}`;

  const { errors } = await populateDynamicLayers(instance, job);
  if (errors.length > 0) {
    postToUi({
      type: "job-format-error",
      jobId: job.id,
      formatId: format.id,
      detail: errors.join("; "),
    });
    return;
  }

  const bytes = await instance.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: 2 },
  });

  const fileName = `${job.rubrica.nome}/${job.post_id}-${format.formato}.png`;
  postToUi({
    type: "job-format-done",
    jobId: job.id,
    formatId: format.id,
    formato: format.formato,
    fileName,
    bytes,
  });
}

async function processJob(job: JobBundle, outputPage: PageNode): Promise<void> {
  if (job.rubrica.figma_file_key && figma.fileKey && job.rubrica.figma_file_key !== figma.fileKey) {
    log(
      "warn",
      `Job ${job.post_id} (rubrica "${job.rubrica.nome}") richiede il file Figma ${job.rubrica.figma_file_key}: apri quel file e riprova. Job saltato in questa sessione.`,
    );
    return;
  }

  if (job.formats.length === 0) {
    postToUi({ type: "job-error", jobId: job.id, detail: "Nessun formato da renderizzare per questo job" });
    return;
  }

  for (const format of job.formats) {
    await processFormat(job, format, outputPage);
  }

  postToUi({ type: "job-done", jobId: job.id });
}

// --- Ingresso messaggi dalla UI --------------------------------------------

figma.ui.onmessage = async (msg: UiToCodeMessage) => {
  switch (msg.type) {
    case "load-credentials": {
      const credentials = await loadCredentials();
      postToUi({ type: "credentials-loaded", credentials });
      break;
    }
    case "save-credentials": {
      await saveCredentials(msg.credentials);
      break;
    }
    case "image-bytes": {
      const pending = pendingImageRequests.get(msg.requestId);
      if (pending) {
        pendingImageRequests.delete(msg.requestId);
        if (msg.error) log("warn", `Download immagine fallito: ${msg.error}`);
        pending.resolve(msg.bytes);
      }
      break;
    }
    case "render-jobs": {
      const outputPage = await getOrCreateOutputPage();
      for (const job of msg.jobs) {
        try {
          await processJob(job, outputPage);
        } catch (err) {
          postToUi({ type: "job-error", jobId: job.id, detail: String(err).slice(0, 300) });
        }
      }
      postToUi({ type: "processing-complete" });
      break;
    }
  }
};
