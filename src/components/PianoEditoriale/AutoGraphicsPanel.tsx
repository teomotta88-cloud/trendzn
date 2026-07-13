import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Search, Wand2, Loader2, AlertTriangle, Upload } from "lucide-react";
import type { EditorialPost } from "@/lib/editorialPlan";
import {
  type GettyCandidate,
  type GraphicJob,
  type GraphicJobImage,
  type Rubrica,
  type TemplateConstraint,
  getJobForPost,
  listGettyCandidates,
  listGraphicJobImages,
  listRubriche,
  listTemplateConstraints,
  replaceGettyCandidates,
  selectGettyCandidate,
  setPostRubricaId,
  subscribeToJob,
  uploadJobImage,
  upsertGraphicJob,
} from "@/lib/autographics";

// SBAM AutoGraphics — pannello agganciato in fondo alla PostCard. Gestisce
// tutto il flusso lato copywriter: scelta rubrica strutturata, composizione
// del copy per layer con contatori live e blocco oltre max_chars, ricerca
// foto Getty per campo immagine (una rubrica può avere più campi #image,
// es. un carousel: ognuno ha una ricerca/selezione/upload indipendente),
// approvazione. Il rendering vero e proprio non avviene qui: un job
// approvato (ready_for_render) diventa esportabile in .xlsx per Canva Bulk
// Create dal pannello "Export Canva Bulk Create" in cima al Piano
// Editoriale (vedi CanvaExportPanel.tsx).

async function callHook<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/public/hooks/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Richiesta ${path} fallita (${res.status})`);
  }
  return json;
}

// Soglia visiva del contatore caratteri: verde < 80%, giallo < 100%, rosso ≥.
function counterColor(len: number, max: number | null): string {
  if (max == null) return "text-muted-foreground";
  const ratio = len / max;
  if (ratio >= 1) return "text-destructive";
  if (ratio >= 0.8) return "text-yellow-600";
  return "text-green-600";
}

const STATUS_LABEL: Record<string, string> = {
  pending_validation: "bozza",
  pending_image: "in attesa foto",
  ready_for_render: "pronto per l'export",
  rendering: "in rendering",
  done: "esportato in .xlsx",
  error: "errore",
};

// Ricerca Getty + upload manuale per un singolo campo #image. Ogni campo
// immagine della rubrica ha la propria ricerca e la propria selezione: non
// esiste più un'unica foto condivisa da tutto il job.
function ImageFieldPicker({
  jobId,
  layerName,
  obbligatorio,
  currentImage,
  getKeywordSeed,
  onImagesChange,
}: {
  jobId: string;
  layerName: string;
  obbligatorio: boolean;
  currentImage: GraphicJobImage | undefined;
  getKeywordSeed: () => string;
  onImagesChange: () => void;
}) {
  const [candidates, setCandidates] = useState<GettyCandidate[]>([]);
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listGettyCandidates(jobId, layerName)
      .then(setCandidates)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [jobId, layerName]);

  async function runSearch(kwList: string[]) {
    const result = await callHook<{
      candidates: Array<
        Omit<GettyCandidate, "id" | "job_id" | "layer_name" | "created_at" | "selected">
      >;
    }>("getty-search", { keywords: kwList });
    const saved = await replaceGettyCandidates(jobId, layerName, result.candidates);
    setCandidates(saved);
  }

  async function handleExtractAndSearch() {
    setBusy("keywords");
    setError(null);
    try {
      const copy = getKeywordSeed();
      if (!copy.trim()) throw new Error("Nessun testo disponibile per estrarre le keyword.");
      const kw = await callHook<{ keywords_en: string[]; keywords_it: string[] }>(
        "extract-keywords",
        { copy },
      );
      // Italiano prima, inglese come fallback (rubriche locali) — l'utente può
      // comunque modificare la stringa e rilanciare la ricerca a mano.
      const merged = [...kw.keywords_it, ...kw.keywords_en];
      setKeywords(merged.join(", "));
      await runSearch(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleManualSearch() {
    const kwList = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (kwList.length === 0) {
      setError("Inserisci almeno una keyword.");
      return;
    }
    setBusy("search");
    setError(null);
    try {
      await runSearch(kwList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectCandidate(candidateId: string) {
    setBusy("select");
    setError(null);
    try {
      await selectGettyCandidate(jobId, layerName, candidateId);
      setCandidates((prev) => prev.map((c) => ({ ...c, selected: c.id === candidateId })));
      onImagesChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      await uploadJobImage(jobId, layerName, file);
      onImagesChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-foreground">
        {layerName}
        {obbligatorio && <span className="text-destructive"> *</span>}
        <span className="ml-1 font-normal text-muted-foreground">(immagine)</span>
      </label>

      {currentImage ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/60 bg-background/60 p-1.5">
          <img src={currentImage.image_url} alt="" className="size-10 rounded object-cover" />
          <span className="text-[10px] text-muted-foreground">
            {currentImage.source === "upload"
              ? "caricata manualmente ✓"
              : "foto Getty selezionata ✓"}
          </span>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
          Nessuna immagine selezionata per questo campo.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExtractAndSearch}
          disabled={busy === "keywords"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-2.5 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
        >
          {busy === "keywords" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          Estrai keyword e cerca
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy === "upload"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy === "upload" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Upload className="size-3" />
          )}
          Carica manualmente
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="keyword separate da virgola…"
          className="flex-1 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleManualSearch}
          disabled={busy === "search"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy === "search" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Search className="size-3" />
          )}
          Cerca
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelectCandidate(c.id)}
              disabled={busy === "select"}
              className={`group relative overflow-hidden rounded-lg border-2 transition ${
                c.selected ? "border-primary" : "border-transparent hover:border-border"
              }`}
              title={c.title ?? c.asset_id}
            >
              <img
                src={c.preview_url}
                alt={c.title ?? ""}
                className="aspect-square w-full object-cover"
              />
              {c.selected && (
                <span className="absolute bottom-1 right-1 rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  selezionata
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

export function AutoGraphicsPanel({ post }: { post: EditorialPost }) {
  const [open, setOpen] = useState(false);
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [rubricaId, setRubricaId] = useState<string>("");
  const [constraints, setConstraints] = useState<TemplateConstraint[]>([]);
  const [copyPayload, setCopyPayload] = useState<Record<string, string>>({});
  const [job, setJob] = useState<GraphicJob | null>(null);
  const [jobImages, setJobImages] = useState<GraphicJobImage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const selectedRubrica = rubriche.find((r) => r.id === rubricaId) ?? null;

  const refreshJobState = useCallback(
    async (jobId: string) => {
      const imgs = await listGraphicJobImages(jobId);
      setJobImages(imgs);
      const fresh = await getJobForPost(post.id);
      if (fresh) setJob(fresh);
    },
    [post.id],
  );

  // Caricamento iniziale: rubriche attive + eventuale job già esistente.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [rubs, existing] = await Promise.all([listRubriche(true), getJobForPost(post.id)]);
        if (cancelled) return;
        setRubriche(rubs);
        if (existing) {
          setJob(existing);
          setRubricaId(existing.rubrica_id);
          setCopyPayload(existing.copy_payload ?? {});
          const [cons, imgs] = await Promise.all([
            listTemplateConstraints(existing.rubrica_id),
            listGraphicJobImages(existing.id),
          ]);
          if (cancelled) return;
          setConstraints(cons);
          setJobImages(imgs);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, post.id]);

  // Sottoscrizione Realtime allo stato del job quando ne esiste uno.
  useEffect(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (!job) return;
    const jobId = job.id;
    unsubRef.current = subscribeToJob(jobId, () => {
      refreshJobState(jobId).catch(() => undefined);
    });
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [job, refreshJobState]);

  async function handleSelectRubrica(id: string) {
    setError(null);
    setRubricaId(id);
    setCopyPayload({});
    setConstraints([]);
    if (!id) return;
    try {
      const cons = await listTemplateConstraints(id);
      setConstraints(cons);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Validazione lato UI: solo i layer di TESTO possono bloccare il
  // salvataggio (obbligatorio vuoto o oltre max_chars). I layer immagine si
  // riempiono dalla ricerca Getty o dall'upload manuale dopo il salvataggio,
  // quindi non entrano in questa validazione — altrimenti si crea un
  // cortocircuito.
  const validation = constraints.map((c) => {
    const value = copyPayload[c.layer_name] ?? "";
    const isImage = c.layer_type === "image";
    const overMax = !isImage && c.max_chars != null && value.length > c.max_chars;
    const requiredEmpty = !isImage && c.obbligatorio && !value.trim();
    return { constraint: c, isImage, overMax, requiredEmpty };
  });
  const canSave = rubricaId !== "" && validation.every((v) => !v.overMax && !v.requiredEmpty);

  // Raggruppa i campi per card (slide), nello stesso ordine con cui arrivano
  // da listTemplateConstraints (già ordinati per card_index): mantiene la
  // suddivisione in card definita nell'editor rubriche invece di una lista
  // piatta di layer.
  const cardGroups: Array<{ cardIndex: number; items: typeof validation }> = [];
  for (const v of validation) {
    const ci = v.constraint.card_index;
    const group = cardGroups.find((g) => g.cardIndex === ci);
    if (group) group.items.push(v);
    else cardGroups.push({ cardIndex: ci, items: [v] });
  }

  async function handleSaveDraft() {
    if (!canSave || !selectedRubrica) return;
    setBusy("save");
    setError(null);
    try {
      await setPostRubricaId(post.id, rubricaId);
      const saved = await upsertGraphicJob({
        post_id: post.id,
        rubrica_id: rubricaId,
        copy_payload: copyPayload,
      });
      setJob(saved);
      await refreshJobState(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Testo su cui basare l'estrazione keyword: il copy visual del post se c'è,
  // altrimenti la concatenazione dei soli layer di TESTO (i layer immagine
  // contengono URL, non testo utile). Condiviso da tutti i campi immagine
  // del job: ognuno può comunque modificare le keyword prima di cercare.
  function sourceCopyForKeywords(): string {
    if (post.copy_visual?.trim()) return post.copy_visual;
    const textValues = constraints
      .filter((c) => c.layer_type !== "image")
      .map((c) => copyPayload[c.layer_name])
      .filter((v): v is string => !!v && v.trim().length > 0);
    return textValues.join(". ");
  }

  async function handleApprove() {
    if (!job) return;
    setBusy("approve");
    setError(null);
    try {
      await callHook("approve-job", { job_id: job.id });
      await refreshJobState(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const imageConstraints = constraints.filter((c) => c.layer_type === "image");
  const allImagesReady = imageConstraints.every(
    (c) => !c.obbligatorio || jobImages.some((img) => img.layer_name === c.layer_name),
  );
  const readyToApprove = !!job && canSave && allImagesReady && job.status !== "rendering";

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"
      >
        <Sparkles className="size-3.5" />
        Grafica automatica{" "}
        {job && (
          <span className="text-muted-foreground">· {STATUS_LABEL[job.status] ?? job.status}</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-background/40 p-3">
          {/* Rubrica strutturata (tabella rubriche) */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rubrica (template Canva)
            </label>
            <select
              value={rubricaId}
              onChange={(e) => handleSelectRubrica(e.target.value)}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">— Seleziona una rubrica —</option>
              {rubriche.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} ({r.tipo_template})
                </option>
              ))}
            </select>
            {rubriche.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nessuna rubrica configurata. Creala da Piano Editoriale → Canali cliente → Rubriche
                AutoGraphics.
              </p>
            )}
          </div>

          {/* Composizione copy per layer con contatori live, raggruppata per card */}
          {constraints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Copy per layer
              </span>
              {cardGroups.map((group) => (
                <div
                  key={group.cardIndex}
                  className={
                    cardGroups.length > 1
                      ? "space-y-2 rounded-lg border border-border/60 p-2"
                      : "space-y-2"
                  }
                >
                  {cardGroups.length > 1 && (
                    <span className="block text-[10px] font-semibold text-muted-foreground">
                      Card {group.cardIndex}
                    </span>
                  )}
                  {group.items.map(({ constraint: c, isImage, overMax, requiredEmpty }) => {
                    const value = copyPayload[c.layer_name] ?? "";
                    // I layer immagine hanno una ricerca Getty + upload manuale
                    // indipendenti, disponibili solo dopo il salvataggio della
                    // bozza (serve un job_id a cui agganciare la selezione).
                    if (isImage) {
                      if (!job) {
                        return (
                          <div key={c.id} className="space-y-1">
                            <label className="text-[11px] font-medium text-foreground">
                              {c.layer_name}
                              {c.obbligatorio && <span className="text-destructive"> *</span>}
                              <span className="ml-1 font-normal text-muted-foreground">
                                (immagine)
                              </span>
                            </label>
                            <p className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
                              Salva la bozza per cercare o caricare un'immagine per questo campo.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <ImageFieldPicker
                          key={c.id}
                          jobId={job.id}
                          layerName={c.layer_name}
                          obbligatorio={c.obbligatorio}
                          currentImage={jobImages.find((img) => img.layer_name === c.layer_name)}
                          getKeywordSeed={sourceCopyForKeywords}
                          onImagesChange={() => refreshJobState(job.id)}
                        />
                      );
                    }
                    return (
                      <div key={c.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-medium text-foreground">
                            {c.layer_name}
                            {c.obbligatorio && <span className="text-destructive"> *</span>}
                          </label>
                          {c.max_chars != null && (
                            <span
                              className={`text-[10px] tabular-nums ${counterColor(value.length, c.max_chars)}`}
                            >
                              {value.length}/{c.max_chars}
                            </span>
                          )}
                        </div>
                        <textarea
                          value={value}
                          onChange={(e) =>
                            setCopyPayload((prev) => ({ ...prev, [c.layer_name]: e.target.value }))
                          }
                          className={`w-full rounded-lg border bg-background/60 px-3 py-2 text-[11px] leading-snug outline-none ${
                            overMax || requiredEmpty
                              ? "border-destructive"
                              : "border-border focus:border-primary"
                          } scrollbar-thin max-h-32 min-h-12 overflow-y-auto`}
                          placeholder={`Testo per ${c.layer_name}…`}
                        />
                        {overMax && (
                          <p className="text-[10px] text-destructive">
                            Supera il limite di {c.max_chars} caratteri: accorcia prima di salvare.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={!canSave || busy === "save"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "save" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                Salva bozza grafica
              </button>
              {imageConstraints.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Le anteprime Getty sono bozzetti con watermark. Nessun asset licenziato viene
                  scaricato in questa fase.
                </p>
              )}
            </div>
          )}

          {/* Approvazione + stato render in tempo reale */}
          {job && (
            <div className="space-y-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!readyToApprove || busy === "approve"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "approve" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Approva e genera
              </button>

              {job.status === "ready_for_render" && (
                <p className="text-[11px] text-muted-foreground">
                  Pronto: sarà incluso nel prossimo export .xlsx per questa rubrica (vedi "Export
                  Canva Bulk Create" in cima alla pagina).
                </p>
              )}
              {job.status === "done" && (
                <p className="text-[11px] text-muted-foreground">
                  Esportato in .xlsx. Carica il file in Canva Bulk Create per generare la grafica.
                </p>
              )}

              {job.status === "error" && job.error_detail && (
                <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {job.error_detail}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
