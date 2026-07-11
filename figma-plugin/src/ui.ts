import type { CodeToUiMessage, Credentials, JobBundle, TemplateConstraint, UiToCodeMessage } from "./types";

// SBAM AutoGraphics — thread UI (iframe). Unico posto del plugin con
// accesso alla rete: legge/scrive su Supabase (REST + Storage) e scarica
// le immagini Getty, poi passa i byte al thread sandbox (code.ts) via
// postMessage perché solo lì si può toccare il documento Figma.

function post(message: UiToCodeMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento UI mancante: #${id}`);
  return el;
}

function appendLog(level: "info" | "warn" | "error", message: string): void {
  const log = $("log");
  const line = document.createElement("div");
  line.className = `log-line log-${level}`;
  line.textContent = message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// --- Credenziali ------------------------------------------------------

let credentials: Credentials | null = null;

// Ritorna un binding locale (non la `let` di modulo) così il narrowing
// non-null regge per tutta la funzione chiamante, incluse le closure async.
function getCredentialsOrThrow(): Credentials {
  if (!credentials?.supabaseUrl || !credentials.supabaseAnonKey) {
    throw new Error("Configura URL e anon key di Supabase prima di continuare.");
  }
  return credentials;
}

function supabaseHeaders(): Record<string, string> {
  const creds = getCredentialsOrThrow();
  return {
    apikey: creds.supabaseAnonKey,
    Authorization: `Bearer ${creds.supabaseAnonKey}`,
  };
}

// --- Caricamento coda job -----------------------------------------------

interface JobsState {
  jobs: JobBundle[];
  // jobId -> { totale, completati, errori }
  progress: Map<string, { total: number; done: number; error: number }>;
}

const state: JobsState = { jobs: [], progress: new Map() };

async function fetchReadyJobs(): Promise<JobBundle[]> {
  const creds = getCredentialsOrThrow();
  const base = creds.supabaseUrl.replace(/\/$/, "");

  const jobsRes = await fetch(
    `${base}/rest/v1/graphic_jobs?status=eq.ready_for_render&select=*,rubriche(*),graphic_job_formats(*)`,
    { headers: supabaseHeaders() },
  );
  if (!jobsRes.ok) throw new Error(`Errore nel caricare i job (${jobsRes.status})`);
  const rawJobs = (await jobsRes.json()) as Array<
    Omit<JobBundle, "rubrica" | "formats" | "constraints"> & {
      rubriche: JobBundle["rubrica"];
      graphic_job_formats: JobBundle["formats"];
    }
  >;

  const rubricaIds = [...new Set(rawJobs.map((j) => j.rubrica_id))];
  const constraintsByRubrica = new Map<string, TemplateConstraint[]>();
  if (rubricaIds.length > 0) {
    const filter = rubricaIds.map((id) => `"${id}"`).join(",");
    const constraintsRes = await fetch(
      `${base}/rest/v1/template_constraints?rubrica_id=in.(${filter})&select=*`,
      { headers: supabaseHeaders() },
    );
    if (constraintsRes.ok) {
      const constraints = (await constraintsRes.json()) as TemplateConstraint[];
      for (const c of constraints) {
        const list = constraintsByRubrica.get(c.rubrica_id) ?? [];
        list.push(c);
        constraintsByRubrica.set(c.rubrica_id, list);
      }
    }
  }

  return rawJobs.map((j) => ({
    ...j,
    rubrica: j.rubriche,
    formats: j.graphic_job_formats,
    constraints: constraintsByRubrica.get(j.rubrica_id) ?? [],
  }));
}

function renderJobList(): void {
  const list = $("job-list");
  list.innerHTML = "";
  if (state.jobs.length === 0) {
    list.innerHTML = '<p class="empty">Nessun job in coda (status = ready_for_render).</p>';
    return;
  }

  const byRubrica = new Map<string, JobBundle[]>();
  for (const job of state.jobs) {
    const list2 = byRubrica.get(job.rubrica.nome) ?? [];
    list2.push(job);
    byRubrica.set(job.rubrica.nome, list2);
  }

  for (const [rubricaNome, jobs] of byRubrica) {
    const group = document.createElement("div");
    group.className = "rubrica-group";
    const heading = document.createElement("h3");
    heading.textContent = `${rubricaNome} (${jobs.length})`;
    group.appendChild(heading);

    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "job-row";
      row.id = `job-${job.id}`;
      row.innerHTML = `
        <div class="job-header">
          <span class="job-post">${job.post_id}</span>
          <span class="job-status" data-role="status">in coda</span>
        </div>
        <div class="job-thumbs" data-role="thumbs"></div>
        <div class="job-error" data-role="error"></div>
      `;
      group.appendChild(row);
    }
    list.appendChild(group);
  }
}

function setJobStatus(jobId: string, text: string, cls: string): void {
  const el = document.querySelector(`#job-${jobId} [data-role="status"]`);
  if (el) {
    el.textContent = text;
    el.className = `job-status ${cls}`;
  }
}

function setJobError(jobId: string, detail: string): void {
  const el = document.querySelector(`#job-${jobId} [data-role="error"]`);
  if (el) el.textContent = detail;
}

function addThumb(jobId: string, url: string, formato: string): void {
  const el = document.querySelector(`#job-${jobId} [data-role="thumbs"]`);
  if (!el) return;
  const img = document.createElement("img");
  img.src = url;
  img.title = formato;
  img.className = "thumb";
  el.appendChild(img);
}

// --- Upload storage + aggiornamento stato Supabase -----------------------

async function uploadExport(fileName: string, bytes: Uint8Array): Promise<string> {
  const base = getCredentialsOrThrow().supabaseUrl.replace(/\/$/, "");
  // Ricopia in un Uint8Array<ArrayBuffer> "puro": il Uint8Array che arriva da
  // figma.exportAsync() è tipato su ArrayBufferLike (può includere
  // SharedArrayBuffer), che i lib DOM più recenti non accettano come BlobPart.
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const res = await fetch(`${base}/storage/v1/object/graphics-output/${fileName}`, {
    method: "POST",
    headers: { ...supabaseHeaders(), "Content-Type": "image/png", "x-upsert": "true" },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Upload storage fallito (${res.status}): ${await res.text()}`);
  }
  return `${base}/storage/v1/object/public/graphics-output/${fileName}`;
}

async function patchGraphicJobFormat(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const base = getCredentialsOrThrow().supabaseUrl.replace(/\/$/, "");
  await fetch(`${base}/rest/v1/graphic_job_formats?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

async function patchGraphicJob(id: string, fields: Record<string, unknown>): Promise<void> {
  const base = getCredentialsOrThrow().supabaseUrl.replace(/\/$/, "");
  await fetch(`${base}/rest/v1/graphic_jobs?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

function ensureProgress(jobId: string): { total: number; done: number; error: number } {
  const job = state.jobs.find((j) => j.id === jobId);
  const existing = state.progress.get(jobId);
  if (existing) return existing;
  const created = { total: job?.formats.length ?? 0, done: 0, error: 0 };
  state.progress.set(jobId, created);
  return created;
}

async function finalizeJobIfComplete(jobId: string): Promise<void> {
  const progress = ensureProgress(jobId);
  if (progress.done + progress.error < progress.total) return;
  if (progress.error > 0) {
    setJobStatus(jobId, "errore", "error");
    await patchGraphicJob(jobId, {
      status: "error",
      error_detail: `${progress.error}/${progress.total} formati falliti`,
    });
  } else {
    setJobStatus(jobId, "completato", "done");
    await patchGraphicJob(jobId, { status: "done", error_detail: null });
  }
}

// --- Gestione messaggi dal thread sandbox --------------------------------

window.onmessage = async (event: MessageEvent) => {
  const msg = event.data.pluginMessage as CodeToUiMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "credentials-loaded": {
      credentials = msg.credentials;
      if (credentials) {
        (document.getElementById("supabase-url") as HTMLInputElement).value = credentials.supabaseUrl;
        (document.getElementById("supabase-key") as HTMLInputElement).value = credentials.supabaseAnonKey;
      }
      break;
    }
    case "log": {
      appendLog(msg.level, msg.message);
      break;
    }
    case "need-image": {
      try {
        const res = await fetch(msg.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        post({ type: "image-bytes", requestId: msg.requestId, bytes: buf });
      } catch (err) {
        post({ type: "image-bytes", requestId: msg.requestId, bytes: null, error: String(err) });
      }
      break;
    }
    case "job-format-error": {
      const progress = ensureProgress(msg.jobId);
      progress.error += 1;
      setJobError(msg.jobId, msg.detail);
      appendLog("error", `[${msg.jobId}] ${msg.detail}`);
      await patchGraphicJobFormat(msg.formatId, { status: "error", error_detail: msg.detail });
      await finalizeJobIfComplete(msg.jobId);
      break;
    }
    case "job-format-done": {
      const progress = ensureProgress(msg.jobId);
      try {
        const url = await uploadExport(msg.fileName, msg.bytes);
        await patchGraphicJobFormat(msg.formatId, { status: "done", output_url: url, error_detail: null });
        addThumb(msg.jobId, url, msg.formato);
        progress.done += 1;
      } catch (err) {
        progress.error += 1;
        const detail = String(err).slice(0, 300);
        setJobError(msg.jobId, detail);
        await patchGraphicJobFormat(msg.formatId, { status: "error", error_detail: detail });
      }
      await finalizeJobIfComplete(msg.jobId);
      break;
    }
    case "job-error": {
      setJobStatus(msg.jobId, "errore", "error");
      setJobError(msg.jobId, msg.detail);
      appendLog("error", `[${msg.jobId}] ${msg.detail}`);
      await patchGraphicJob(msg.jobId, { status: "error", error_detail: msg.detail });
      break;
    }
    case "job-done": {
      // Lo stato finale (done/error) dipende dall'esito dei singoli formati,
      // già gestito in finalizeJobIfComplete: qui ci limitiamo a segnare che
      // il rendering del job è terminato lato sandbox.
      appendLog("info", `Job ${msg.jobId}: rendering completato`);
      break;
    }
    case "processing-complete": {
      (document.getElementById("btn-generate") as HTMLButtonElement).disabled = false;
      appendLog("info", "Elaborazione coda terminata.");
      break;
    }
  }
};

// --- Event listener UI --------------------------------------------------

$("btn-save-credentials").addEventListener("click", () => {
  const url = (document.getElementById("supabase-url") as HTMLInputElement).value.trim();
  const key = (document.getElementById("supabase-key") as HTMLInputElement).value.trim();
  if (!url || !key) {
    appendLog("warn", "Inserisci sia URL che anon key prima di salvare.");
    return;
  }
  credentials = { supabaseUrl: url, supabaseAnonKey: key };
  post({ type: "save-credentials", credentials });
  appendLog("info", "Credenziali salvate.");
});

$("btn-load-jobs").addEventListener("click", async () => {
  try {
    appendLog("info", "Carico la coda job...");
    state.jobs = await fetchReadyJobs();
    state.progress.clear();
    renderJobList();
    (document.getElementById("btn-generate") as HTMLButtonElement).disabled = state.jobs.length === 0;
    appendLog("info", `Trovati ${state.jobs.length} job pronti per il render.`);
  } catch (err) {
    appendLog("error", String(err));
  }
});

$("btn-generate").addEventListener("click", () => {
  if (state.jobs.length === 0) return;
  (document.getElementById("btn-generate") as HTMLButtonElement).disabled = true;
  for (const job of state.jobs) {
    setJobStatus(job.id, "in generazione…", "rendering");
  }
  appendLog("info", `Avvio generazione di ${state.jobs.length} job...`);
  post({ type: "render-jobs", jobs: state.jobs });
});

// All'avvio, chiedi al sandbox le credenziali salvate.
post({ type: "load-credentials" });
